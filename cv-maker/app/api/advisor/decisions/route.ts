import { generateObject } from "ai";
import { z } from "zod";
import type {
  DecisionAnalysis,
  DecisionInput,
  DecisionKind,
} from "@/lib/advisor/types";
import type { CVContent } from "@/lib/types";
import type { Application } from "@/lib/app/types";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/advisor/decisions
//
// Three focused decision helpers, selected by `kind`:
// - "offer-evaluation": paste an offer, get an honest read
// - "stay-vs-go":       should I stay at the current job or take the new one
// - "pivot":            is pivoting from domain A to domain B a credible move
//
// Request:
//   {
//     kind: DecisionKind,
//     input: DecisionInput,
//     profile?: Profile,
//     cvVariants?: CVContent[],
//     application?: Application   // optional — ties to a logged application
//   }
// Response:
//   { decision: DecisionAnalysis }

export const runtime = "nodejs";
export const maxDuration = 60;

const decisionSchema = z.object({
  inputSummary: z
    .string()
    .describe(
      "2–3 sentences: what the user asked about, framed in their own terms. No editorial.",
    ),
  pros: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe(
      "Honest upsides grounded in the specifics. No generic 'good compensation' unless the specifics back that up.",
    ),
  cons: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe(
      "Honest downsides. Include the things the user is probably underweighting. No hedging.",
    ),
  questions: z
    .array(z.string())
    .min(3)
    .max(8)
    .describe(
      "Questions the user should probe before deciding. Specific, answerable. 'Ask for the pre-IPO cap table' not 'think about equity'.",
    ),
  recommendation: z
    .string()
    .describe(
      "ONE sentence. The honest one-liner. Start with a verb: 'Take it.', 'Pass.', 'Stay put for 6 more months.', 'Worth the pivot if you can bridge via X.'",
    ),
  confidence: z
    .enum(["low", "mid", "high"])
    .describe(
      "How confident the recommendation is given the information provided. Low if the input is thin; high only when the input is substantive.",
    ),
});

type Body = {
  kind: DecisionKind;
  input: DecisionInput;
  profile?: CVContent["profile"];
  cvVariants?: CVContent[];
  application?: Application;
  settings?: Settings;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body?.kind || !body?.input) {
    return json({ error: "Missing `kind` or `input` in body." }, 400);
  }

  if (body.input.kind !== body.kind) {
    return json(
      { error: "Body `kind` must match `input.kind`." },
      400,
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

  try {
    const { object, usage } = await generateObject({
      model: resolved.model,
      schema: decisionSchema,
      schemaName: "DecisionAnalysis",
      schemaDescription:
        "An honest, evidence-anchored written analysis of a career decision with a recommendation.",
      system: buildSystemPrompt(body.kind),
      prompt: buildUserPrompt(body),
    });

    const decision: DecisionAnalysis = {
      id: `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      kind: body.kind,
      inputSummary: object.inputSummary,
      pros: object.pros,
      cons: object.cons,
      questions: object.questions,
      recommendation: object.recommendation,
      confidence: object.confidence,
      generatedAt: Date.now(),
    };
    return jsonWithUsage(
      { decision },
      { feature: resolved.feature, choice: resolved.choice, usage },
    );
  } catch (e) {
    return respondProviderError(e, {
      feature: resolved.feature,
      choice: resolved.choice,
    });
  }
}

function buildSystemPrompt(kind: DecisionKind): string {
  const base = `You are a brutally honest career friend. Not a cheerleader, not a recruiter, not a coach selling more coaching. The user is asking you for a real read on a real decision.

HARD RULES:
- Be specific. "Take it, the comp is aggressive for the stage and the manager has shipped twice" not "sounds good".
- Include the uncomfortable angle. If the user is probably rationalising, say so gently but clearly.
- Do not invent facts not in the input. If the input is thin, your confidence must be "low" and your questions section must surface the missing info.
- Short, dense sentences. No throat-clearing ("I think…", "it depends…"). You're allowed to say "it depends" — but only when followed by the variables it depends on.
- The recommendation is ONE sentence starting with a verb.`;

  const kindBlock: Record<DecisionKind, string> = {
    "offer-evaluation": `Focus for offer evaluation:
- Compensation: base, equity, signing bonus. Read equity skeptically unless the company is late-stage.
- Manager: who is the direct manager? Have they shipped? Will they defend you in performance cycles?
- Role scope vs. title inflation: does the role match the title, or is the title doing work?
- Runway & trajectory: funding, burn, headcount trajectory. A "senior" title at a dying company is not a promotion.
- Opportunity cost: what does taking this close off?`,
    "stay-vs-go": `Focus for stay-vs-go:
- Career capital trajectory at the current place — is it still compounding, or flat?
- Manager change risk / project change risk at current place.
- The well-known pattern: people overweight the certainty of staying and underweight the drift risk of a stale role.
- Also underweight: the pain of onboarding into a new team and the time before they can actually do their best work again.
- Tenure matters — a sub-2-year exit is a signal; a 6-year tenure without growth is also a signal.`,
    pivot: `Focus for pivot consideration:
- Is there a credible bridge from current domain to target domain? Name it or call out that there isn't one.
- What's the salary delta and how long does it take to recover?
- Transferable skills — be specific, not "problem-solving".
- Age / life-stage realities if relevant — don't moralise, just note.
- Alternative: can the user do a "0.5 step" pivot (adjacent role) before committing to the full jump?`,
  };

  return `${base}\n\n${kindBlock[kind]}`;
}

function buildUserPrompt(body: Body): string {
  const lines: string[] = [];
  lines.push(`Decision kind: ${body.kind}`);
  lines.push("");
  lines.push("Structured input:");
  lines.push(JSON.stringify(body.input, null, 2));

  if (body.application) {
    lines.push("");
    lines.push("Related application on file:");
    lines.push(
      JSON.stringify(
        {
          id: body.application.id,
          company: body.application.company,
          role: body.application.role,
          status: body.application.status,
          notes: body.application.notes,
          jobData: body.application.jobData,
        },
        null,
        2,
      ),
    );
  }

  if (body.profile) {
    lines.push("");
    lines.push("User profile:");
    lines.push(JSON.stringify(body.profile, null, 2));
  }

  if (body.cvVariants?.length) {
    lines.push("");
    lines.push(
      `CV variants on file (${body.cvVariants.length}) — for context on tenure/seniority:`,
    );
    for (const cv of body.cvVariants) {
      lines.push(`--- /cv/${cv.slug} — target: ${cv.targetRole} ---`);
      lines.push(
        JSON.stringify(
          { experiences: cv.experiences, projects: cv.projects },
          null,
          2,
        ),
      );
    }
  }

  lines.push("");
  lines.push("Produce the decision analysis now. Be honest.");
  return lines.join("\n");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
