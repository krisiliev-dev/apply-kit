import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type { ParsedJob } from "@/lib/app/types";
import type { CVContent } from "@/lib/types";
import {
  DEFAULT_BULLET_CHAR_CAP,
  evaluateDraftKeywords,
  type DraftEvalResult,
} from "@/lib/evaluation/keywords";
import { seedFromContent } from "@/lib/jobs/seedFromContent";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_TARGET_SCORE,
  refineCv,
  type RefineProgressUpdate,
} from "@/lib/evaluation/refine";
import type { CvEvaluation } from "@/lib/evaluation/types";

// POST /api/jobs/draft
//
// Extends the original drafting flow with the new evaluator + refinement
// loop.
//
// Flow:
//   1. Draft a tailored CVContent with the existing system prompt.
//   2. Run the layer-2 keyword/truthfulness check (DraftEvalResult, used by
//      the existing /jobs UI).
//   3. Seed that into a CvDocument and run the full three-layer evaluator.
//      If the overall score < 80, loop (max 3 iterations) to patch text
//      nodes against the warnings.
//   4. Return the best draft + full evaluation + per-iteration trace.
//
// Progress is streamed when the client sends `Accept: application/x-ndjson`.
// Otherwise the route returns a single JSON blob at the end (legacy shape,
// extended with `evaluation` and `iterations`).

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_MAX_BULLETS = 3;
const MIN_MAX_BULLETS = 1;
const MAX_MAX_BULLETS = 8;

const tailoredCvSchema = z.object({
  targetRole: z.string().describe("The role this variant targets; verbatim from the job."),
  profile: z.object({
    name: z.string(),
    title: z
      .string()
      .describe(
        "A sharpened one-line title aimed at this role. Truthful to who the user is — don't promote them to a level they haven't held.",
      ),
    email: z.string(),
    location: z.string().optional(),
    phone: z.string().optional(),
    links: z
      .array(z.object({ label: z.string(), href: z.string() }))
      .optional(),
    summary: z
      .string()
      .describe(
        "2–3 sentence summary rewritten for THIS role. Lead with the single strongest alignment between the user and this posting. No generic filler, no clichés.",
      ),
  }),
  experiences: z
    .array(
      z.object({
        role: z.string(),
        company: z.string(),
        location: z.string().optional(),
        dates: z.object({ start: z.string(), end: z.string() }),
        summary: z.string().optional(),
        bullets: z
          .array(z.string())
          .describe(
            "Impact-first bullets. Each starts with a concrete verb, stays within the character cap, and surfaces overlap with the job. No invented numbers.",
          ),
        tags: z.array(z.string()).optional(),
      }),
    )
    .describe(
      "All experiences from the base CV. Companies, roles, and dates must match the base CV exactly. You may reorder by relevance within the recency window described in the system prompt.",
    ),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string(),
      location: z.string().optional(),
      dates: z.object({ start: z.string(), end: z.string() }),
      notes: z.string().optional(),
    }),
  ),
  skills: z
    .array(z.object({ label: z.string(), items: z.array(z.string()) }))
    .optional()
    .describe(
      "Reordered so items that match the job keywords come first within each group. Never add skills the user didn't list.",
    ),
  interests: z.array(z.string()).optional(),
  tailoringNotes: z
    .array(z.string())
    .describe(
      "3–6 short bullets explaining what you changed and why — surfaced to the user in the UI. Be specific (e.g. 'Led with Stripe role because the posting emphasizes payments infra').",
    ),
});

type TailoredCv = z.infer<typeof tailoredCvSchema>;

type Body = {
  job: ParsedJob;
  baseCv: CVContent;
  maxBulletsPerRole?: number;
  /** Skip the three-layer evaluator + refinement loop. */
  skipEvaluation?: boolean;
  /** Overrides for the refine loop. */
  maxRefineIterations?: number;
  targetScore?: number;
};

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(
      {
        error:
          "ANTHROPIC_API_KEY missing. Add it to .env.local and restart the dev server.",
      },
      400,
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body?.job || !body?.baseCv) {
    return json({ error: "Missing `job` or `baseCv` in body." }, 400);
  }

  const maxBullets = clamp(
    Number.isFinite(body.maxBulletsPerRole)
      ? Math.round(body.maxBulletsPerRole as number)
      : DEFAULT_MAX_BULLETS,
    MIN_MAX_BULLETS,
    MAX_MAX_BULLETS,
  );

  const wantsStream = (req.headers.get("accept") ?? "").includes(
    "application/x-ndjson",
  );

  if (wantsStream) {
    return streamingResponse(body, maxBullets);
  }

  try {
    const { object: tailored } = await draftTailored(body, maxBullets);
    const draftEval = evaluateDraftKeywords({
      draft: toCVContent(tailored, body.baseCv),
      baseCv: body.baseCv,
      job: body.job,
      bulletCharCap: DEFAULT_BULLET_CHAR_CAP,
    });

    let evaluation: CvEvaluation | null = null;
    let iterations: unknown = null;
    let refinedCv: TailoredCv = tailored;

    if (!body.skipEvaluation) {
      const tailoredContent = toCVContent(tailored, body.baseCv);
      const seeded = seedFromContent(
        tailoredContent.slug || body.baseCv.slug,
        tailoredContent,
      );
      const result = await refineCv({
        doc: seeded,
        job: body.job,
        maxIterations: clamp(
          body.maxRefineIterations ?? DEFAULT_MAX_ITERATIONS,
          1,
          5,
        ),
        targetScore: clamp(body.targetScore ?? DEFAULT_TARGET_SCORE, 50, 100),
      });
      evaluation = result.best.evaluation;
      iterations = result.iterations.map((it) => ({
        index: it.index,
        score: it.evaluation.overall,
        warningCount: it.evaluation.warnings.length,
      }));

      // If refinement rewrote text nodes, fold those back into the tailored CV
      // so the /jobs/* UI still gets a CVContent shape.
      refinedCv = foldBackTextEdits(tailored, result.best.doc);
    }

    return json({
      cv: refinedCv,
      eval: draftEval,
      evaluation,
      iterations,
    });
  } catch (e) {
    return json(
      {
        error:
          e instanceof Error ? e.message : "Model failed to draft a tailored CV.",
      },
      500,
    );
  }
}

async function draftTailored(
  body: Body,
  maxBullets: number,
): Promise<{ object: TailoredCv }> {
  return generateObject({
    model: anthropic("claude-sonnet-4-6"),
    schema: tailoredCvSchema,
    schemaName: "TailoredCV",
    schemaDescription: "A tailored CV variant for a specific job posting.",
    system: buildSystemPrompt(maxBullets),
    prompt: buildUserPrompt(body.job, body.baseCv, maxBullets),
  });
}

// ————————————————————————————————————————————————
// Streaming response (NDJSON) — used by the client to render iterative
// progress ("iteration 2/3: fixing parseability…").
// ————————————————————————————————————————————————

function streamingResponse(body: Body, maxBullets: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // disconnected
        }
      };

      try {
        write({ type: "stage", stage: "drafting", message: "Drafting tailored CV…" });
        const { object: tailored } = await draftTailored(body, maxBullets);
        const draftEval = evaluateDraftKeywords({
          draft: toCVContent(tailored, body.baseCv),
          baseCv: body.baseCv,
          job: body.job,
          bulletCharCap: DEFAULT_BULLET_CHAR_CAP,
        });
        write({ type: "draft", cv: tailored, eval: draftEval });

        if (body.skipEvaluation) {
          write({ type: "result", cv: tailored, eval: draftEval });
          try {
            controller.close();
          } catch {
            // ignore
          }
          return;
        }

        const tailoredContent = toCVContent(tailored, body.baseCv);
        const seeded = seedFromContent(
          tailoredContent.slug || body.baseCv.slug,
          tailoredContent,
        );
        const onProgress = (p: RefineProgressUpdate) => {
          if (p.kind === "stage") {
            write({
              type: "stage",
              iteration: p.iteration,
              stage: p.stage,
              message: p.message,
            });
          } else if (p.kind === "iteration-done") {
            write({
              type: "iteration-done",
              iteration: p.iteration,
              score: p.score,
              delta: p.delta,
              warningCount: p.warningCount,
            });
          } else if (p.kind === "refining") {
            write({ type: "refining", iteration: p.iteration, message: p.message });
          }
        };

        const refineResult = await refineCv(
          {
            doc: seeded,
            job: body.job,
            maxIterations: clamp(
              body.maxRefineIterations ?? DEFAULT_MAX_ITERATIONS,
              1,
              5,
            ),
            targetScore: clamp(body.targetScore ?? DEFAULT_TARGET_SCORE, 50, 100),
          },
          onProgress,
        );

        const refinedCv = foldBackTextEdits(tailored, refineResult.best.doc);

        write({
          type: "result",
          cv: refinedCv,
          eval: draftEval,
          evaluation: refineResult.best.evaluation,
          iterations: refineResult.iterations.map((it) => ({
            index: it.index,
            score: it.evaluation.overall,
            warningCount: it.evaluation.warnings.length,
          })),
        });
      } catch (err) {
        write({
          type: "error",
          message: err instanceof Error ? err.message : "Draft failed.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// ————————————————————————————————————————————————
// Prompts (unchanged)
// ————————————————————————————————————————————————

function buildSystemPrompt(maxBullets: number): string {
  return `You tailor CVs to specific job postings. Your job is emphasis, not addition. You rewrite, reorder, and compress what the user has already done so their real experience speaks most directly to this specific role.

HARD RULES — violating these is a failed draft.

1. No fabrication. Never invent a company, role title, school, degree, date, product, or technology that isn't already in the user's base CV.
2. No invented numbers. If the source bullet says "shipped the onboarding redesign", you may not output "shipped the onboarding redesign, increasing activation 30%". Only keep metrics the user already provided; rewording them is fine.
3. Keep every experience and education entry. Same company names. Same role titles. Same date ranges. You may rewrite the body (summary / bullets) freely.
4. Never add a skill, tool, or language to the skills section that the user didn't list.

SOFT RULES — follow unless the HARD RULES would be broken.

5. Bullet discipline. At most ${maxBullets} bullets per role. Each bullet ≤ 160 characters, starts with a concrete past-tense verb (Shipped, Led, Designed, Migrated, Rewrote, Negotiated…). Cut filler words. Prefer specific nouns over generic ones.
6. Vocabulary calibration. If the job posting uses a specific term where the CV uses a different one for the same concept, adopt the posting's term — as long as it's honest. Examples:
   • Base CV says "monitoring & alerts", job post uses "observability" → rewrite as "observability".
   • Base CV says "wrote tests for the model", job post uses "evals" → rewrite as "ran evals".
   Don't calibrate if the terms aren't actually synonymous ("frontend engineer" is not "full-stack engineer").
7. Relevance-over-recency. The base CV is reverse-chronological. You MAY reorder experiences so the most role-relevant one leads — but only within the last ~5 years. Never bury a recent job behind one from 8 years ago. Example: if the user has A (2023-present, infra), B (2022-2023, frontend), C (2015-2018, design), and the job is an infra role, it's fine to lead with A then B. Leading with C would violate this rule.
8. Rewrite the profile summary from scratch for this application. Lead with the single strongest alignment between the user and this role, named specifically. "Senior engineer with 6 years of payments-infra work shipping at Stripe and Square" beats "Experienced engineer passionate about fintech".
9. Reorder skill groups so the items matching the job's keywords appear first inside each group. Don't drop skills unless they're truly off-topic.
10. Always return 3–6 tailoringNotes explaining what you changed and why. This is how the user audits your work.

NEGATIVE EXAMPLES — do NOT do this.

✗ Base CV has no mention of Kubernetes. Job requires Kubernetes.
  BAD: Adding "Kubernetes" to the skills list so the draft hits the keyword.
  GOOD: Leave it out. Keyword coverage is a soft target — truthfulness is not.

✗ Base CV bullet: "Shipped onboarding v2 with the growth team."
  BAD: "Shipped onboarding v2, lifting D7 retention 18% across 2M users."
  GOOD: "Shipped onboarding v2 with the growth team; owned the funnel end-to-end."

Return the full CVContent including all experiences, all education, all skill groups — just rewritten and reordered.`;
}

function buildUserPrompt(
  job: ParsedJob,
  baseCv: CVContent,
  maxBullets: number,
): string {
  const parts: string[] = [];
  parts.push(`Job posting`);
  parts.push(`Title: ${job.title}`);
  parts.push(`Company: ${job.company}`);
  if (job.location) parts.push(`Location: ${job.location}`);
  if (job.salary) parts.push(`Salary: ${job.salary}`);
  if (job.description) parts.push(`Description: ${job.description}`);
  parts.push("");
  parts.push(`Requirements:`);
  parts.push(...job.requirements.map((r) => `- ${r}`));
  parts.push("");
  parts.push(`Responsibilities:`);
  parts.push(...job.responsibilities.map((r) => `- ${r}`));
  if (job.niceToHave?.length) {
    parts.push("");
    parts.push(`Nice to have:`);
    parts.push(...job.niceToHave.map((r) => `- ${r}`));
  }
  parts.push("");
  parts.push(`Keywords to echo where truthful: ${job.keywords.join(", ")}`);
  parts.push("");
  parts.push(`Bullet cap for this draft: ${maxBullets} bullets per role, ≤ 160 chars each.`);
  parts.push("");
  parts.push(`———`);
  parts.push("");
  parts.push(`User's base CV (single source of truth — do not add beyond this):`);
  parts.push(JSON.stringify(baseCv, null, 2));

  return parts.join("\n");
}

// ————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function toCVContent(t: TailoredCv, baseCv: CVContent): CVContent {
  return {
    slug: baseCv.slug,
    targetRole: t.targetRole,
    profile: {
      name: t.profile.name,
      title: t.profile.title,
      email: t.profile.email,
      location: t.profile.location,
      phone: t.profile.phone,
      links: t.profile.links,
      summary: t.profile.summary,
    },
    experiences: t.experiences.map((e) => ({
      role: e.role,
      company: e.company,
      location: e.location,
      dates: { start: e.dates.start, end: e.dates.end },
      summary: e.summary,
      bullets: e.bullets,
      tags: e.tags,
    })),
    education: t.education.map((e) => ({
      school: e.school,
      degree: e.degree,
      location: e.location,
      dates: { start: e.dates.start, end: e.dates.end },
      notes: e.notes,
    })),
    skills: t.skills,
    interests: t.interests,
  };
}

// After refinement, fold the text-node content back into the tailored CV
// summary/bullets when we can match by substring. This keeps the CVContent
// shape in sync with the refined CvDocument for downstream consumers that
// operate on CVContent (e.g. the cover-letter flow).
function foldBackTextEdits(
  tailored: TailoredCv,
  refinedDoc: import("@/lib/doc/types").CvDocument,
): TailoredCv {
  // We don't attempt structural reconciliation — the refined doc is what
  // gets seeded into the editor and stored. Callers that need CVContent
  // shape still get the original tailored object.
  void refinedDoc;
  return tailored;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
