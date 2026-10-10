import { generateObject } from "ai";
import { z } from "zod";
import type { CareerNarrative } from "@/lib/advisor/types";
import type { CVContent } from "@/lib/types";
import type { Application } from "@/lib/app/types";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/advisor/narrative
//
// Reads the user's profile, all CV variants, and a window of recent
// applications — infers the story the CV is (probably unintentionally)
// telling, then proposes 2–3 alternative framings.
//
// Request:
//   { profile: Profile, cvVariants: CVContent[], recentApplications?: Application[] }
// Response:
//   { narrative: CareerNarrative }
//
// Empty-state: zero CV variants and zero applications still returns a valid
// CareerNarrative with a friendly stub — never 500s.

export const runtime = "nodejs";
export const maxDuration = 60;

const framingSchema = z.object({
  title: z
    .string()
    .describe(
      "Short, punchy framing label — 2–4 words. Examples: 'The operator', 'The polymath', 'The specialist', 'The connector'.",
    ),
  summary: z
    .string()
    .describe(
      "2–3 sentences describing this framing of the candidate. Concrete, specific to THIS person's history — not a generic archetype description.",
    ),
  evidenceFromHistory: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe(
      "Specific experiences, projects, or bullets from the candidate's real history that support this framing. Each item cites the source (role title, company, or project name).",
    ),
  risks: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe(
      "What this framing undersells or leaves out. Honest — this is the user's tool, not a pitch deck.",
    ),
});

const responseSchema = z.object({
  currentStoryDetected: z
    .string()
    .describe(
      "What the user's CV (across all variants) is currently saying about them, probably unintentionally. One paragraph. Lead with the most salient signal — the one a hiring manager would pick up in 6 seconds. Be honest: if the CV is scattered, say so.",
    ),
  framings: z
    .array(framingSchema)
    .min(2)
    .max(3)
    .describe(
      "2 or 3 alternative framings the candidate could credibly lean into. Must be truly different from each other AND different from currentStoryDetected.",
    ),
});

type Body = {
  profile: CVContent["profile"];
  cvVariants: CVContent[];
  recentApplications?: Application[];
  settings?: Settings;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body?.profile || !Array.isArray(body.cvVariants)) {
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

  // Empty-state: if we have essentially nothing to go on, don't call the
  // model — return a friendly stub. The UI will show this with a nudge to
  // fill in CV content first.
  if (body.cvVariants.length === 0) {
    const stub: CareerNarrative = {
      currentStoryDetected:
        "Nothing to analyze yet — add a CV variant with real experiences and come back. Narrative work needs source material.",
      generatedAt: Date.now(),
      framings: [],
    };
    return json({ narrative: stub });
  }

  try {
    const { object, usage } = await generateObject({
      model: resolved.model,
      schema: responseSchema,
      schemaName: "CareerNarrative",
      schemaDescription:
        "The story the candidate's CV is currently telling, plus 2–3 honest alternative framings supported by their actual history.",
      system: buildSystemPrompt(),
      prompt: buildUserPrompt(body),
    });

    const narrative: CareerNarrative = {
      currentStoryDetected: object.currentStoryDetected,
      framings: object.framings.map((f, i) => ({
        id: `fr_${Date.now().toString(36)}_${i.toString(36)}`,
        title: f.title,
        summary: f.summary,
        evidenceFromHistory: f.evidenceFromHistory,
        risks: f.risks,
      })),
      generatedAt: Date.now(),
    };
    return jsonWithUsage(
      { narrative },
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
  return `You are a career narrative analyst. Your job is two-part:

1. Read the candidate's full history (profile summary, all CV variants, recent applied roles) and infer the story the CV is currently telling — including the story it's telling unintentionally. The user has probably not designed their positioning deliberately. Name it anyway.

2. Propose 2–3 alternative framings the candidate could credibly lean into — DIFFERENT from the current story, NOT upgrades of it. Each framing must be supported by evidence already in their history. You are reframing, not inventing.

HARD RULES — violations are a failed generation.

- NO fabrication. Never invent experiences, companies, skills, or outcomes. Every evidence item must cite a real source from the user's CV (role title + company, or project name).
- Each framing needs at least 2 concrete pieces of evidence. If you can't find 2, the framing isn't credible — pick a different one or produce only 2 framings instead of 3.
- Framings must be truly different from each other. "The operator" and "The builder who ships" are the same framing. Pick one.
- Risks are required. Every framing has blind spots. Name them honestly.
- The currentStoryDetected block is not a compliment sandwich. If the CV is scattered or muddy, say so. If it screams one thing louder than intended, say so. The user needs the honest read.
- No generic archetype descriptions. Anchor every sentence in specifics from THIS candidate's history.

VOICE: Honest career advisor who has actually read the CV. Not a recruiter, not a coach pitching for business. Concise. Avoid filler ("overall", "it seems that", "one could argue").`;
}

function buildUserPrompt(body: Body): string {
  const lines: string[] = [];
  lines.push("Candidate profile (stable identity):");
  lines.push(JSON.stringify(body.profile, null, 2));

  lines.push("");
  lines.push(`CV variants (${body.cvVariants.length} on file):`);
  for (const cv of body.cvVariants) {
    lines.push("");
    lines.push(`--- /cv/${cv.slug} — target: ${cv.targetRole} ---`);
    lines.push(JSON.stringify(cv, null, 2));
  }

  const recent = (body.recentApplications ?? []).slice(0, 40);
  if (recent.length > 0) {
    lines.push("");
    lines.push(
      `Recently applied roles (${recent.length}, newest first) — reveals where the candidate thinks they fit:`,
    );
    for (const a of recent) {
      const variant = a.cvSlug ? ` using /cv/${a.cvSlug}` : "";
      const loc = a.jobData?.location ? ` — ${a.jobData.location}` : "";
      lines.push(`- ${a.company}: ${a.role}${loc}${variant}`);
    }
  } else {
    lines.push("");
    lines.push(
      "No recent applications on file — base the analysis entirely on the CV history.",
    );
  }

  lines.push("");
  lines.push("Produce the narrative analysis now.");
  return lines.join("\n");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
