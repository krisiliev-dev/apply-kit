import { streamText, type LanguageModelUsage } from "ai";
import type { CoverLetterTone, ParsedJob } from "@/lib/app/types";
import type { CVContent } from "@/lib/types";
import type { Settings } from "@/lib/settings/types";
import {
  resolveForRoute,
  respondProviderError,
  streamingUsageHeader,
  withStreamUsageSentinel,
} from "@/lib/ai/route";

// POST /api/cover-letter
// Streams a tailored cover letter built from the user's base CV and (optionally)
// a parsed job posting. The client pipes the streamed text straight into the
// UI via `useCompletion` and saves the final body to the application record
// once streaming finishes.

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  applicationId: string;
  parsedJob?: ParsedJob;
  baseCV: CVContent;
  tone?: CoverLetterTone;
  wordTarget?: number;
  settings?: Settings;
};

const TONE_GUIDANCE: Record<CoverLetterTone, string> = {
  direct:
    "Declarative, low-adjective prose. Short sentences are fine. Cut any hedging.",
  warm:
    "Personal but not syrupy. You may reference something specific about the company or role that genuinely resonates, without flattery.",
  witty:
    "Keep the body serious and grounded. You may include at most one light, subtle line — never a joke that undercuts the pitch.",
  neutral:
    "Baseline professional register. Clear, plain, no stylistic flourishes.",
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!body?.baseCV) {
    return new Response(
      JSON.stringify({ error: "Missing `baseCV` in body." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
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

  const tone: CoverLetterTone = body.tone ?? "direct";
  const wordTarget = clampWords(body.wordTarget ?? 220);

  const system = `You write cover letters that feel like they were written by the candidate, not a template.

Hard rules:
- NEVER invent experience, companies, titles, projects, or metrics that are not present in the user's base CV. If a requirement has no match in the CV, do not claim it.
- Output is PLAIN TEXT with blank lines between paragraphs. No greeting ("Dear…"), no sign-off ("Sincerely,"), no name, no address blocks. The detail page composes those wrappers around your output.
- No em-dash clichés like "I'm thrilled" or "I'm excited to apply". No "results-driven", "passionate", "dynamic".
- No filler like "please feel free to contact me at…" — the recipient has the contact details already.

Structure (exactly three paragraphs):
1. Open with a concrete hook: an observation about the company, the role, or the problem space — not about yourself. Then pivot to why you're a fit in one sentence.
2. Single strongest alignment between the candidate and the role, anchored in ONE concrete example from the CV. Numbers if the CV has numbers.
3. Forward-looking: what the candidate wants to do in this role, specifically. Close tightly — one sentence is enough.

Target length: around ${wordTarget} words (±15%). Do not exceed ${wordTarget + 50} words.

Tone: ${tone} — ${TONE_GUIDANCE[tone]}`;

  const jobBlock = body.parsedJob
    ? formatJob(body.parsedJob)
    : "(No parsed job provided — rely on the base CV and keep the letter role-agnostic but still concrete.)";

  const prompt = `Job posting:
${jobBlock}

———

Candidate's base CV (everything you can draw from — do not invent beyond this):
${JSON.stringify(body.baseCV, null, 2)}

Write the cover letter body now. Plain text, three paragraphs, blank line between each. No greeting or sign-off.`;

  let finalUsage: LanguageModelUsage | null = null;

  const result = streamText({
    model: resolved.model,
    system,
    prompt,
    onFinish({ usage }) {
      // Stash final usage so the stream wrapper can append an accurate
      // trailing sentinel once the producer resolves.
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

function clampWords(n: number): number {
  if (!Number.isFinite(n)) return 220;
  return Math.max(120, Math.min(400, Math.round(n)));
}

function formatJob(job: ParsedJob): string {
  const parts: string[] = [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
  ];
  if (job.location) parts.push(`Location: ${job.location}`);
  if (job.salary) parts.push(`Salary: ${job.salary}`);
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
  if (job.niceToHave?.length) {
    parts.push(
      `\nNice to have:\n${job.niceToHave.map((r) => `- ${r}`).join("\n")}`,
    );
  }
  if (job.keywords.length) {
    parts.push(`\nKeywords: ${job.keywords.join(", ")}`);
  }
  return parts.join("\n");
}
