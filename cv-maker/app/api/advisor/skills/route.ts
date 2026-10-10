import { generateObject } from "ai";
import { z } from "zod";
import type { SkillGapAnalysis } from "@/lib/advisor/types";
import type { CVContent } from "@/lib/types";
import { extractUserSkills } from "@/lib/advisor/profileSkills";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/advisor/skills
//
// Aggregates required skills across recent target-role postings, flags the
// ones the user's profile lacks, suggests concrete acquisition paths.
//
// Request:
//   {
//     profile: Profile,
//     cvVariants: CVContent[],
//     recentPostings: { title: string, company: string, description?: string, requirements?: string[], niceToHave?: string[], keywords?: string[] }[]
//   }
// Response:
//   { analysis: SkillGapAnalysis }
//
// Empty-state (no CVs or no postings): return a stub with a clear hint rather
// than call the model. Never 500 on missing data.

export const runtime = "nodejs";
export const maxDuration = 90;

const skillDemandSchema = z.object({
  skill: z
    .string()
    .describe(
      "The skill, technology, or competency — normalized casing (e.g. 'TypeScript', 'Systems thinking', 'Next.js App Router').",
    ),
  demandCount: z
    .number()
    .int()
    .min(1)
    .describe(
      "How many of the analyzed postings require or strongly imply this skill.",
    ),
  sampleCompanies: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe(
      "Companies from the analyzed postings that asked for this skill. Up to 5.",
    ),
  userHasIt: z
    .boolean()
    .describe("True iff the user already has this skill per their CV/profile."),
  adjacencyNote: z
    .string()
    .optional()
    .describe(
      "Only when userHasIt is false: note the closest skill the user DOES have. Example: 'You have Vue — React is adjacent; ~2 weeks to working fluency.' Omit if no meaningful adjacency.",
    ),
});

const acquisitionPathSchema = z.object({
  skill: z
    .string()
    .describe("The exact skill string from criticalGaps / niceToHaveGaps."),
  path: z
    .string()
    .describe(
      "Concrete acquisition path — specific course, side-project shape, or public writing topic. NOT 'take a course on X'. Example: 'Build a small CRDT in TypeScript end-to-end following Martin Kleppmann's lectures; ship it as a public repo with a README that explains the sync protocol you chose.'",
    ),
  effortWeeks: z
    .number()
    .int()
    .min(1)
    .max(52)
    .describe("Realistic calendar weeks of part-time effort to working fluency."),
});

const responseSchema = z.object({
  criticalGaps: z
    .array(skillDemandSchema)
    .describe(
      "Skills demanded by the MAJORITY of analyzed postings that the user lacks. Order by demandCount desc.",
    ),
  niceToHaveGaps: z
    .array(skillDemandSchema)
    .describe(
      "Skills demanded by a minority of postings that the user lacks. Order by demandCount desc.",
    ),
  acquisitionPaths: z
    .array(acquisitionPathSchema)
    .describe(
      "One concrete path per top-priority gap (aim for 3–6). Order by most critical first.",
    ),
});

type PostingInput = {
  title: string;
  company: string;
  description?: string;
  requirements?: string[];
  niceToHave?: string[];
  keywords?: string[];
};

type Body = {
  profile: CVContent["profile"];
  cvVariants: CVContent[];
  recentPostings: PostingInput[];
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
    resolved = resolveForRoute("default", body);
  } catch (err) {
    return respondProviderError(err, {
      feature: "default",
      settings: body.settings,
    });
  }

  const postings = Array.isArray(body.recentPostings) ? body.recentPostings : [];
  const userSkills = extractUserSkills(body.cvVariants);
  const now = Date.now();

  // Empty-state: with no postings we can't do gap analysis. Return a stub.
  if (postings.length === 0 || body.cvVariants.length === 0) {
    const stub: SkillGapAnalysis = {
      analyzedPostingCount: postings.length,
      window: { from: now, to: now },
      userHas: userSkills,
      criticalGaps: [],
      niceToHaveGaps: [],
      acquisitionPaths: [],
      generatedAt: now,
    };
    return json({
      analysis: stub,
      hint:
        postings.length === 0
          ? "No target-role postings on file. Save or apply to a few roles via /discover or /jobs and come back."
          : "No CV variants on file — add one so we know what you bring to the table.",
    });
  }

  try {
    const { object, usage } = await generateObject({
      model: resolved.model,
      schema: responseSchema,
      schemaName: "SkillGapAnalysis",
      schemaDescription:
        "Aggregated required-skill demand across target postings, cross-referenced with the user's skills to flag gaps and propose concrete acquisition paths.",
      system: buildSystemPrompt(),
      prompt: buildUserPrompt(body, userSkills),
    });

    const analysis: SkillGapAnalysis = {
      analyzedPostingCount: postings.length,
      window: { from: oldestPostingTs(postings, now), to: now },
      userHas: userSkills,
      criticalGaps: object.criticalGaps,
      niceToHaveGaps: object.niceToHaveGaps,
      acquisitionPaths: object.acquisitionPaths,
      generatedAt: now,
    };
    return jsonWithUsage(
      { analysis },
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
  return `You perform skill-gap analysis for a specific candidate against a specific set of target-role postings they are actually considering.

METHOD:
1. Union all required/nice-to-have/keyword signals across the postings. Normalize casing ("typescript" -> "TypeScript").
2. Count demand per skill (how many postings mention it).
3. Cross-reference against the user's known skills (explicit skill list + tech tags on experiences/projects).
4. Emit gaps in two tiers:
   - criticalGaps: skills demanded by MORE THAN HALF of postings, user lacks.
   - niceToHaveGaps: skills demanded by at least 2 postings but less than half, user lacks.
5. For top-priority gaps, propose ONE concrete acquisition path each.

HARD RULES on acquisition paths — this is where generic tools fail users:
- NEVER say "take a course on X" or "read a book about X". Those are non-actions.
- Name a SPECIFIC course, project shape, or public artifact. Examples:
  - "Build a small type-safe database query builder in TypeScript end-to-end; ship it as a public repo; 6 weeks."
  - "Complete the 'Crafting Interpreters' book and publish a tree-walking interpreter in Go; 10 weeks."
  - "Write 3 public teardowns of open-source RFCs in the area and publish them on your site; 4 weeks."
- Effort in calendar weeks of part-time (5–10 hrs/week) effort. Be realistic — do not say "learn Rust in 2 weeks".

HARD RULES on gaps:
- Do not invent demand. A skill is only demanded if it's traceable to posting signals the user provided.
- A skill is only a "gap" if the user truly lacks it. Check skill lists, experience tags, project stacks. Use adjacencyNote when the user has a close-enough skill ("you have Vue — React is adjacent").
- If the user's CV has "Next.js" and postings ask for "Next.js App Router", that's NOT a gap unless postings specifically distinguish. Err on the side of not flagging trivially adjacent skills.

VOICE: precise, non-alarmist. This is an informational gap map, not a panic button.`;
}

function buildUserPrompt(body: Body, userSkills: string[]): string {
  const lines: string[] = [];
  lines.push("USER — profile + skills union:");
  lines.push(JSON.stringify(body.profile, null, 2));
  lines.push("");
  lines.push(`Skills extracted from CV variants (${userSkills.length}):`);
  lines.push(userSkills.join(", "));
  lines.push("");
  lines.push(
    `CV variants (${body.cvVariants.length}) — for context on the user's depth:`,
  );
  for (const cv of body.cvVariants) {
    lines.push(`--- /cv/${cv.slug} — target: ${cv.targetRole} ---`);
    lines.push(
      JSON.stringify(
        {
          experiences: cv.experiences,
          projects: cv.projects,
          skills: cv.skills,
        },
        null,
        2,
      ),
    );
  }

  lines.push("");
  lines.push(
    `POSTINGS — target-role postings to aggregate demand from (${body.recentPostings.length}):`,
  );
  for (const p of body.recentPostings.slice(0, 40)) {
    lines.push(`- ${p.company} — ${p.title}`);
    if (p.requirements?.length) {
      lines.push(`  requirements: ${p.requirements.join(" | ")}`);
    }
    if (p.niceToHave?.length) {
      lines.push(`  nice-to-have: ${p.niceToHave.join(" | ")}`);
    }
    if (p.keywords?.length) {
      lines.push(`  keywords: ${p.keywords.join(", ")}`);
    }
    if (p.description) {
      const desc = p.description.replace(/\s+/g, " ").slice(0, 400);
      lines.push(`  description: ${desc}`);
    }
  }

  lines.push("");
  lines.push("Produce the skill-gap analysis now.");
  return lines.join("\n");
}

function oldestPostingTs(postings: PostingInput[], fallback: number): number {
  // Postings don't carry their own timestamps in the Body shape; callers
  // typically pass recent ones, so we use `now - 30d` as a conservative
  // window floor. This just populates the `window` metadata for the UI.
  if (postings.length === 0) return fallback;
  return fallback - 30 * 24 * 60 * 60 * 1000;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
