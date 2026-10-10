import { streamText, type LanguageModelUsage } from "ai";
import type { ParsedJob, PreScreenTone } from "@/lib/app/types";
import type { CVContent } from "@/lib/types";
import type { Settings } from "@/lib/settings/types";
import {
  resolveForRoute,
  respondProviderError,
  streamingUsageHeader,
  withStreamUsageSentinel,
} from "@/lib/ai/route";

// POST /api/pre-screen/draft
// Drafts answers to the short-answer questions that commonly appear on job
// applications ("why us?", "describe a failure", "why this role?"). Streams
// plain text with a machine-readable delimiter between answers so the client
// can split drafts per prompt as they arrive.
//
// Delimiter format: a line containing exactly `--- QUESTION <n> ---` before
// each answer body, where <n> is the 1-based index of the prompt the body
// belongs to. The first delimiter is emitted before the first answer.
//
// Request:
//   {
//     applicationId: string,
//     questions: { prompt: string, wordLimit?: number }[],
//     baseCV: CVContent,
//     parsedJob?: ParsedJob,
//     tone?: "direct" | "warm" | "witty" | "neutral",
//   }

export const runtime = "nodejs";
export const maxDuration = 120;

const TONE_GUIDANCE: Record<PreScreenTone, string> = {
  direct:
    "Declarative, low-adjective. Short sentences fine. Cut hedges. Start with a concrete observation or moment.",
  warm:
    "Personal but not syrupy. You may reference something specific about the company or role that genuinely resonates, without flattery.",
  witty:
    "Body stays serious and grounded. At most one light line across all answers; never a joke that undercuts the pitch.",
  neutral:
    "Baseline professional register. Clear, plain, no stylistic flourishes.",
};

type Body = {
  applicationId: string;
  questions: { prompt: string; wordLimit?: number }[];
  baseCV: CVContent;
  parsedJob?: ParsedJob;
  tone?: PreScreenTone;
  settings?: Settings;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (!body?.baseCV) return jsonError("Missing `baseCV` in body.", 400);
  if (!Array.isArray(body.questions) || body.questions.length === 0) {
    return jsonError("Provide at least one question prompt.", 400);
  }

  let resolved;
  try {
    resolved = resolveForRoute("default", body);
  } catch (err) {
    return respondProviderError(err, {
      feature: "default",
      settings: body.settings,
    });
  }

  const tone: PreScreenTone = body.tone ?? "direct";
  const questions = body.questions
    .map((q) => ({
      prompt: typeof q.prompt === "string" ? q.prompt.trim() : "",
      wordLimit:
        typeof q.wordLimit === "number" && Number.isFinite(q.wordLimit)
          ? Math.max(20, Math.min(800, Math.round(q.wordLimit)))
          : undefined,
    }))
    .filter((q) => q.prompt.length > 0);

  if (!questions.length) {
    return jsonError("All question prompts were empty.", 400);
  }

  const system = `You draft short-answer responses for job applications — the "why us?", "describe a failure", "why this role?" fields that actually get read. You write them the way the candidate would if they had an hour, not the way a template would.

HARD RULES:
- NEVER invent experience, companies, titles, projects, or metrics that aren't in the user's base CV.
- Each answer stands alone. Don't reference other answers.
- Open with a concrete hook — an observation, a moment, a counter-intuitive framing. NEVER start with "I'm excited to apply" or "I have always been passionate about".
- No hedges: strike "I believe", "I think", "I feel". No passive voice. No buzzwords (results-driven, passionate, dynamic, synergy).
- No sign-off filler ("thanks for considering", "looking forward to…").
- Word limits are hard ceilings. Hit the ceiling or come in ~10% under. If no limit is given, target ~120 words.

STRUCTURE per answer:
- One concrete opener (1 sentence).
- One or two specific anchors from the CV (project, team, shipped thing).
- One forward-looking sentence specific to THIS role or company, if the question invites it.

DELIMITER PROTOCOL (critical — the client parses this):
- Before each answer body, emit EXACTLY one line that reads:
    --- QUESTION <n> ---
  where <n> is the 1-based index of the prompt you're answering.
- No blank line before or after the delimiter — just a newline.
- After the delimiter, write the answer body as plain text with blank lines between paragraphs if the answer has multiple paragraphs.
- Answer the questions in order. Do not skip. Do not combine.
- Do not include anything outside delimiters + answer bodies.

TONE: ${tone} — ${TONE_GUIDANCE[tone]}`;

  const userParts: string[] = [];

  if (body.parsedJob) {
    userParts.push("Job posting context:");
    userParts.push(formatJob(body.parsedJob));
  } else {
    userParts.push(
      "(No parsed job context — answer from the base CV alone, keep answers role-agnostic but still concrete.)",
    );
  }

  userParts.push("");
  userParts.push("———");
  userParts.push("");
  userParts.push("Candidate's base CV (the only experience pool you may draw from):");
  userParts.push(JSON.stringify(body.baseCV, null, 2));
  userParts.push("");
  userParts.push("———");
  userParts.push("");
  userParts.push(`Answer these ${questions.length} question(s), in order:`);
  questions.forEach((q, i) => {
    const cap = q.wordLimit ? ` (word limit: ${q.wordLimit})` : "";
    userParts.push(`${i + 1}. ${q.prompt}${cap}`);
  });
  userParts.push("");
  userParts.push(
    "Remember the delimiter format: `--- QUESTION <n> ---` on its own line before each answer body.",
  );

  let finalUsage: LanguageModelUsage | null = null;

  const result = streamText({
    model: resolved.model,
    system,
    prompt: userParts.join("\n"),
    onFinish({ usage }) {
      finalUsage = usage;
    },
  });

  const textStream = result.toTextStreamResponse({
    headers: streamingUsageHeader({
      feature: resolved.feature,
      choice: resolved.choice,
    }),
  });

  return withStreamUsageSentinel(textStream, {
    feature: resolved.feature,
    choice: resolved.choice,
    getUsage: () => finalUsage,
  });
}

function formatJob(job: ParsedJob): string {
  const parts: string[] = [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
  ];
  if (job.location) parts.push(`Location: ${job.location}`);
  if (job.description) parts.push(`\n${job.description}`);
  if (job.requirements.length) {
    parts.push(
      `\nRequirements:\n${job.requirements.map((r) => `- ${r}`).join("\n")}`,
    );
  }
  if (job.responsibilities.length) {
    parts.push(
      `\nResponsibilities:\n${job.responsibilities
        .map((r) => `- ${r}`)
        .join("\n")}`,
    );
  }
  if (job.keywords.length) parts.push(`\nKeywords: ${job.keywords.join(", ")}`);
  return parts.join("\n");
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
