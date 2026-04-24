import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type {
  OfferRecord,
  ParsedJob,
  SalaryAnalysis,
} from "@/lib/app/types";
import type { CVContent } from "@/lib/types";

// POST /api/salary/analyze
// Body: { offer: OfferRecord; parsedJob?: ParsedJob; baseCV: CVContent; locationContext?: string }
// Returns: SalaryAnalysis
//
// Uses only pre-training knowledge for market ranges — NO external API calls.
// Every range is prefixed with an uncertainty note so the user never mistakes
// this for authoritative data.

export const runtime = "nodejs";
export const maxDuration = 60;

const UNCERTAINTY_PREFIX =
  "Approximate; verify on levels.fyi / glassdoor / friends before negotiating.";

const analysisSchema = z.object({
  marketContext: z.object({
    bandLow: z.number().optional(),
    bandMid: z.number().optional(),
    bandHigh: z.number().optional(),
    bandSource: z
      .string()
      .optional()
      .describe(
        "Short note on which signals the range is inferred from (e.g. 'levels.fyi-adjacent pre-training inference, approximate').",
      ),
    confidenceNote: z
      .string()
      .describe(
        `MUST begin with the phrase "${UNCERTAINTY_PREFIX}" — then add 1-2 sentences on what would change the assessment (role level, company stage, geography).`,
      ),
  }),
  leveragePoints: z
    .array(z.string())
    .min(2)
    .max(5)
    .describe(
      "Specific leverage points drawn from the candidate's CV and the job's requirements. Never invented — must map to something concrete in the CV.",
    ),
  risks: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe(
      "Things NOT to push on in this negotiation. Concrete, grounded in the offer or the market.",
    ),
  counterOfferDraft: z.object({
    headline: z
      .string()
      .describe("One line, e.g. 'Counter at $195k base + 0.35% equity'."),
    emailBody: z
      .string()
      .describe(
        "Professional email body, ~150 words (±30). Opens with specific gratitude, states the counter clearly, closes with openness to discuss. No subject line. No greeting/sign-off unless explicitly useful. Plain text, blank lines between paragraphs.",
      ),
    rationale: z
      .string()
      .describe(
        "2-3 sentences on why this specific counter — tied to leverage points and market context.",
      ),
  }),
});

type Body = {
  offer: OfferRecord;
  parsedJob?: ParsedJob;
  baseCV: CVContent;
  locationContext?: string;
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

  if (!body?.offer || !body?.baseCV) {
    return json({ error: "Missing offer or baseCV." }, 400);
  }

  const system = `You are a seasoned compensation coach. You help candidates evaluate an offer and draft a counter.

HARD RULES:
- You rely entirely on pre-training knowledge for market context. You do NOT have live data. Be explicit about that uncertainty.
- Every market range you cite must be framed as approximate. Start the \`confidenceNote\` with: "${UNCERTAINTY_PREFIX}"
- Leverage points must come from the candidate's CV. Do NOT invent strengths. If there isn't enough CV signal, prefer fewer leverage points over fabricated ones.
- Counter-offer: realistic delta. Base bump ≤15% of current offer. Sign-on and equity are usually softer asks; consider those first. NEVER propose an outlandish number.
- Email body: professional, neither aggressive nor sycophantic. Opens with a specific piece of gratitude (not generic). States the counter concretely. Closes with openness to discuss. ~150 words. No subject line.
- Risks are the things NOT to push on. Concrete; grounded in the offer or market.
- No filler, no "I'm excited to" openings. No em-dash clichés.`;

  const offerBlock = formatOffer(body.offer);
  const jobBlock = body.parsedJob
    ? formatJob(body.parsedJob)
    : "(No parsed job attached — role-agnostic analysis.)";

  const prompt = `Offer details:\n${offerBlock}\n\n---\n\nRole:\n${jobBlock}\n\n---\n\nLocation context (optional): ${body.locationContext ?? "(none provided)"}\n\n---\n\nCandidate's base CV (everything you can draw leverage from — do not invent beyond this):\n${JSON.stringify(body.baseCV, null, 2)}\n\nProduce the structured SalaryAnalysis now.`;

  try {
    const { object } = await generateObject({
      model: anthropic("claude-sonnet-4-6"),
      schema: analysisSchema,
      schemaName: "SalaryAnalysis",
      schemaDescription:
        "Structured analysis of a job offer with market context, leverage, risks, and a counter-offer draft.",
      system,
      prompt,
    });

    // Enforce the uncertainty prefix even if the model dropped it.
    const confidenceNote = object.marketContext.confidenceNote.startsWith(
      UNCERTAINTY_PREFIX,
    )
      ? object.marketContext.confidenceNote
      : `${UNCERTAINTY_PREFIX} ${object.marketContext.confidenceNote}`;

    const analysis: SalaryAnalysis = {
      marketContext: {
        ...object.marketContext,
        confidenceNote,
      },
      leveragePoints: object.leveragePoints,
      risks: object.risks,
      counterOfferDraft: object.counterOfferDraft,
      generatedAt: Date.now(),
    };

    return json({ analysis });
  } catch (e) {
    return json(
      {
        error:
          e instanceof Error ? e.message : "Model failed to analyse the offer.",
      },
      500,
    );
  }
}

function formatOffer(o: OfferRecord): string {
  const parts: string[] = [
    `Base: ${o.currency} ${o.baseSalary.toLocaleString()}`,
  ];
  if (o.equity) parts.push(`Equity: ${o.equity}`);
  if (o.bonus) parts.push(`Bonus: ${o.bonus}`);
  if (typeof o.signOn === "number") {
    parts.push(`Sign-on: ${o.currency} ${o.signOn.toLocaleString()}`);
  }
  if (typeof o.ptoDays === "number") parts.push(`PTO: ${o.ptoDays} days`);
  if (o.remote) parts.push(`Work mode: ${o.remote}`);
  if (o.benefits) parts.push(`Benefits: ${o.benefits}`);
  if (o.rawOfferText) {
    parts.push(`\nRaw offer text (for reference):\n${o.rawOfferText}`);
  }
  return parts.join("\n");
}

function formatJob(job: ParsedJob): string {
  const parts: string[] = [`Title: ${job.title}`, `Company: ${job.company}`];
  if (job.location) parts.push(`Location: ${job.location}`);
  if (job.salary) parts.push(`Listed comp: ${job.salary}`);
  if (job.requirements.length) {
    parts.push(
      `Requirements:\n${job.requirements.slice(0, 10).map((r) => `- ${r}`).join("\n")}`,
    );
  }
  if (job.responsibilities.length) {
    parts.push(
      `Responsibilities:\n${job.responsibilities.slice(0, 8).map((r) => `- ${r}`).join("\n")}`,
    );
  }
  if (job.keywords.length) {
    parts.push(`Keywords: ${job.keywords.slice(0, 15).join(", ")}`);
  }
  return parts.join("\n");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
