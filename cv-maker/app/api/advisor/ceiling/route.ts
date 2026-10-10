import { generateObject } from "ai";
import { z } from "zod";
import type { StrategicProfile } from "@/lib/advisor/types";
import type { CVContent } from "@/lib/types";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/advisor/ceiling
//
// Classifies target roles into below / in-range / stretch / aspirational
// using the candidate's actual history. Ends with a readiness verdict for
// stretching, and the gaps that would close it.
//
// Request:
//   {
//     profile: Profile,
//     cvVariants: CVContent[],
//     roles: { title: string, company?: string, sourceUrl?: string, description?: string }[]
//   }
// Response:
//   { strategic: StrategicProfile }

export const runtime = "nodejs";
export const maxDuration = 90;

const roleClassificationSchema = z.object({
  title: z.string().describe("Role title — copy exactly from the input."),
  company: z.string().optional().describe("Company if supplied."),
  tier: z
    .enum(["below", "in-range", "stretch", "aspirational"])
    .describe(
      "Tier vs. the candidate:\n- below: under their current level; wastes the application\n- in-range: matches current level; direct fit\n- stretch: 1 step up; credible reach; landing requires strong interview prep\n- aspirational: 2+ steps up or requires credentials they lack; long-term only",
    ),
  reasoning: z
    .string()
    .describe(
      "One paragraph tying the tier to SPECIFIC evidence from the candidate's CV. Cite role titles, years of experience, specific skills. No generic statements.",
    ),
  sourceUrl: z.string().optional().describe("Copy from input if supplied."),
});

const responseSchema = z.object({
  inRangeSignals: z
    .array(z.string())
    .describe(
      "2–4 short signals that make the candidate 'in-range' for their current-level target. Ground each one in their CV.",
    ),
  readyForStretch: z
    .boolean()
    .describe(
      "Honest call: if the user closed their current stretch gaps, could they credibly clear stretch-tier interviews right now? True only if the gaps are narrow.",
    ),
  stretchGapsToClose: z
    .array(z.string())
    .describe(
      "The specific capabilities, credentials, or experiences that currently block the user from routinely winning stretch-tier roles. Concrete, not vibes.",
    ),
  classifications: z.array(roleClassificationSchema),
});

type RoleInput = {
  title: string;
  company?: string;
  sourceUrl?: string;
  description?: string;
};

type Body = {
  profile: CVContent["profile"];
  cvVariants: CVContent[];
  roles: RoleInput[];
  settings?: Settings;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body?.profile || !Array.isArray(body?.cvVariants)) {
    return json({ error: "Missing `profile` or `cvVariants` in body." }, 400);
  }

  let resolved;
  try {
    resolved = resolveForRoute("narrative", body);
  } catch (err) {
    return respondProviderError(err, {
      feature: "narrative",
      settings: body.settings,
    });
  }

  const roles = Array.isArray(body.roles) ? body.roles.slice(0, 40) : [];
  const now = Date.now();

  // Empty-state: no roles to classify.
  if (roles.length === 0 || body.cvVariants.length === 0) {
    const stub: StrategicProfile = {
      inRangeSignals: [],
      readyForStretch: false,
      stretchGapsToClose: [],
      classifications: [],
      generatedAt: now,
    };
    return json({
      strategic: stub,
      hint:
        roles.length === 0
          ? "No roles to classify. Save roles to /discover or /applications first, then come back."
          : "No CV variants — we need source material to calibrate your level.",
    });
  }

  try {
    const { object, usage } = await generateObject({
      model: resolved.model,
      schema: responseSchema,
      schemaName: "StrategicProfile",
      schemaDescription:
        "Classifies target roles into below / in-range / stretch / aspirational, with reasoning anchored in the candidate's real history.",
      system: buildSystemPrompt(),
      prompt: buildUserPrompt(body),
    });

    const strategic: StrategicProfile = {
      inRangeSignals: object.inRangeSignals,
      readyForStretch: object.readyForStretch,
      stretchGapsToClose: object.stretchGapsToClose,
      classifications: object.classifications,
      generatedAt: now,
    };
    return jsonWithUsage(
      { strategic },
      { feature: resolved.feature, choice: resolved.choice, usage },
    );
  } catch (e) {
    return respondProviderError(e, {
      feature: resolved.feature,
      choice: resolved.choice,
    });
  }
}

function buildSystemPrompt(): string {
  return `You calibrate a candidate's strategic ceiling and floor: which roles are below their level (a waste), which are in-range (direct fits), which are stretches (credible reach), and which are aspirational (2+ levels up, long-term only).

HARD RULES.

1. Calibrate LEVEL from the CV — years of experience, seniority of titles held, scope (IC vs. lead vs. staff vs. director), domain depth. Do NOT use salary or location as a ceiling signal — those are noisy.
2. Every classification's reasoning must cite SPECIFIC evidence from the candidate's CV. "5 years as senior frontend at Quill & Compass" not "they seem experienced".
3. "Below" is important — call it out. Applying below-level is usually a mistake (under-paid, bored, signals desperation). Only label below if the posting is genuinely under the candidate's current scope.
4. "Stretch" means credible with strong prep — the candidate has most of the signals and the gap is small. Not "might get lucky".
5. "Aspirational" is 2+ levels up or requires credentials the candidate lacks (PhD for research roles, C-suite titles, etc.). Long-term target, not a now-application.
6. readyForStretch is a boolean — only TRUE if stretchGapsToClose are narrow (<=3 items, each realistically closable in a month or less). Most candidates are not ready; don't inflate.

7. inRangeSignals should be concrete signals — specific skills, metrics, or role experiences — that show the candidate is a direct fit for in-range roles. Not vague "strong communicator".

VOICE: brutally honest career friend, not cheerleader. The user needs this for actual decisions.`;
}

function buildUserPrompt(body: Body): string {
  const lines: string[] = [];
  lines.push("CANDIDATE — profile + history:");
  lines.push(JSON.stringify(body.profile, null, 2));
  lines.push("");
  for (const cv of body.cvVariants) {
    lines.push(`--- /cv/${cv.slug} — target: ${cv.targetRole} ---`);
    lines.push(JSON.stringify(cv, null, 2));
  }

  lines.push("");
  lines.push(`ROLES TO CLASSIFY (${body.roles.length}):`);
  for (const r of body.roles.slice(0, 40)) {
    const co = r.company ? ` @ ${r.company}` : "";
    lines.push(`- ${r.title}${co}`);
    if (r.sourceUrl) lines.push(`  url: ${r.sourceUrl}`);
    if (r.description) {
      const desc = r.description.replace(/\s+/g, " ").slice(0, 500);
      lines.push(`  desc: ${desc}`);
    }
  }

  lines.push("");
  lines.push("Produce the strategic profile now.");
  return lines.join("\n");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
