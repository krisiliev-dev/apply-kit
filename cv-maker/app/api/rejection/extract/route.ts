import { generateObject } from "ai";
import { z } from "zod";
import type { Application, RejectionReasonKind } from "@/lib/app/types";
import { REJECTION_REASON_KINDS } from "@/lib/app/types";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/rejection/extract
// Body: { applicationId: string; application: Application; rawText?: string; kind: RejectionReasonKind }
// Returns: { extractedSignals, aiSummary, lessonsForFuture }

export const runtime = "nodejs";
export const maxDuration = 60;

const signalsSchema = z.object({
  citedReasons: z
    .array(z.string())
    .describe(
      "Exact phrases visible in the rejection text that state a reason. Empty array if nothing is explicitly cited.",
    ),
  inferredReasons: z
    .array(z.string())
    .describe(
      "Specific reasons inferred from tone, timing, or application context. Not generic — must be grounded in this case.",
    ),
  politeness: z
    .enum(["curt", "standard", "warm", "template"])
    .describe(
      "Tone of the rejection. 'template' means obvious boilerplate; 'warm' means human and personalised.",
    ),
  seniorityFeedback: z
    .enum(["under", "over", "fit"])
    .optional()
    .describe("Only set if the rejection or context clearly hints at seniority mismatch."),
  salaryMismatch: z
    .boolean()
    .optional()
    .describe("True only if compensation expectations were cited or strongly implied as the blocker."),
  compensationHint: z
    .string()
    .optional()
    .describe("Any compensation-related phrase the rejection mentions (e.g. 'outside our band')."),
  stageLost: z
    .enum(["resume", "screen", "interview", "final", "offer"])
    .describe("Which stage the candidate was on when the outcome landed."),
});

const extractionSchema = z.object({
  extractedSignals: signalsSchema,
  aiSummary: z
    .string()
    .describe(
      "One sentence, under 30 words, summarising what actually happened in this outcome.",
    ),
  lessonsForFuture: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe(
      "1-3 concrete lessons SPECIFIC to this rejection. Never generic ('tailor your CV', 'practice more'). Each lesson must be actionable and reference something about THIS role, company, stage, or feedback.",
    ),
});

type Body = {
  applicationId: string;
  application: Application;
  rawText?: string;
  kind: RejectionReasonKind;
  settings?: Settings;
};

function isValidKind(k: unknown): k is RejectionReasonKind {
  return typeof k === "string" && (REJECTION_REASON_KINDS as string[]).includes(k);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body?.applicationId || !body?.application) {
    return json({ error: "Missing applicationId or application." }, 400);
  }
  if (!isValidKind(body.kind)) {
    return json({ error: "Invalid rejection kind." }, 400);
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

  const rawText =
    typeof body.rawText === "string" ? body.rawText.trim() : "";

  const app = body.application;

  const context = [
    `Company: ${app.company}`,
    `Role: ${app.role}`,
    app.cvSlug ? `CV variant used: ${app.cvSlug}` : undefined,
    app.url ? `Posting URL: ${app.url}` : undefined,
    app.jobData?.salary ? `Salary info: ${app.jobData.salary}` : undefined,
    app.jobData?.location ? `Location: ${app.jobData.location}` : undefined,
    app.jobData?.requirements?.length
      ? `Key requirements: ${app.jobData.requirements.slice(0, 6).join("; ")}`
      : undefined,
    `Status pipeline: ${statusTrail(app)}`,
    `Outcome kind flagged by user: ${body.kind}`,
    app.notes ? `Candidate notes: ${app.notes.slice(0, 400)}` : undefined,
    app.coverLetter?.tone
      ? `Cover letter tone: ${app.coverLetter.tone}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const rejectionBlock = rawText
    ? `Rejection message (verbatim, do not quote back more than a short phrase):\n---\n${rawText}\n---`
    : `(No message was pasted — the user flagged this as "${body.kind}". Infer what you can from the context and the kind; do not fabricate cited reasons.)`;

  const system = `You analyse job-application rejections and ghostings. You produce structured signal that helps the candidate learn.

Hard rules:
- If no text was pasted, \`citedReasons\` MUST be an empty array. Do not invent quotes.
- \`inferredReasons\` must reference specifics of THIS application (stage, seniority, salary, variant, timing). No generic career advice.
- \`lessonsForFuture\` must be concrete and SPECIFIC to this rejection. Never write anything that could apply to any applicant. Examples of BAD lessons: "tailor your CV", "network more", "practice behavioural questions". Examples of GOOD lessons: "For post-screen losses at early-stage startups, lead the intro with the shipping-speed story; this rejection cited pace".
- If the rejection is clearly a form letter, say so in the summary and keep inferred reasons cautious.
- politeness is about tone of the written message, not the outcome. If no message, classify as "template".
- stageLost should reflect the furthest stage the candidate reached, using the status pipeline.
- Keep aiSummary to one sentence.`;

  const prompt = `Application context:
${context}

${rejectionBlock}

Produce the structured extraction now.`;

  try {
    const { object, usage } = await generateObject({
      model: resolved.model,
      schema: extractionSchema,
      schemaName: "RejectionExtraction",
      schemaDescription:
        "Structured extraction of signal from a job-application rejection or unfavourable outcome.",
      system,
      prompt,
    });

    return jsonWithUsage(object, {
      feature: resolved.feature,
      choice: resolved.choice,
      usage,
    });
  } catch (e) {
    return respondProviderError(e, {
      feature: resolved.feature,
      choice: resolved.choice,
    });
  }
}

function statusTrail(app: Application): string {
  const events = (app.events ?? [])
    .filter((e) => e.kind === "status-change")
    .slice()
    .sort((a, b) => a.at - b.at);
  if (events.length === 0) return app.status;
  const stages: string[] = events.map((e) => (e.to ? e.to : "?"));
  const last = events[events.length - 1]?.to;
  if (app.status !== last) stages.push(app.status);
  return stages.join(" → ");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
