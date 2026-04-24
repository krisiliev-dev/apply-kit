import { generateObject } from "ai";
import { z } from "zod";
import type { ApplyFitCheck, ParsedJob } from "@/lib/app/types";
import type { CVContent, Profile } from "@/lib/types";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/apply-fit/check
// Body: { parsedJob: ParsedJob; baseCV: CVContent; profile: Profile }
// Returns: { fit: ApplyFitCheck }
//
// Surfaces weaknesses first. Tells the candidate the honest truth before they
// spend energy on a misaligned application. No encouragement for misaligned
// fits.

export const runtime = "nodejs";
export const maxDuration = 45;

const schema = z.object({
  overallFit: z
    .enum(["strong", "plausible", "stretch", "misaligned"])
    .describe(
      "strong = you should apply. plausible = decent chance. stretch = long shot but not impossible. misaligned = don't waste your energy.",
    ),
  strengths: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe(
      "Specific strengths from the CV that actually match the role. Never generic. Never padding.",
    ),
  weaknesses: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe(
      "Specific gaps. Say the hard thing. Missing years of experience, missing domain, missing specific tech stack, seniority mismatch. Never soft-pedal.",
    ),
  deltaQuestions: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe(
      "Questions the candidate should clarify BEFORE applying (e.g. 'Is the stack requirement firm or a preference?'). Actionable, specific.",
    ),
  effortEstimate: z
    .enum(["low", "mid", "high"])
    .describe(
      "How much tailoring is needed. low = CV is close as-is. mid = meaningful reframing. high = significant rewrite or domain shift.",
    ),
  honest: z
    .string()
    .describe(
      "ONE sentence — brutally honest take. No sugar. No encouragement phrases like 'you've got this'. Under 35 words.",
    ),
});

type Body = {
  parsedJob: ParsedJob;
  baseCV: CVContent;
  profile: Profile;
  settings?: Settings;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body?.parsedJob || !body?.baseCV || !body?.profile) {
    return json(
      { error: "Missing parsedJob, baseCV, or profile." },
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

  const system = `You are a brutally honest career friend. The candidate is deciding whether THIS application is worth their limited energy. Tell them the weaknesses plainly, not the strengths-wrapped version. Don't encourage applying if they're a misaligned fit.

HARD RULES:
- Weaknesses first in your mind. You can still list strengths, but weaknesses must be specific and uncomfortable to say.
- Never use generic phrases like "consider highlighting more", "you've got great potential", "tailor your CV". Always ground in THIS role vs. THIS candidate.
- overallFit is a verdict, not a diplomatic hedge. If it's misaligned, say misaligned.
- The \`honest\` field is one sentence. No sugar. If the candidate should skip it, say so plainly.
- effortEstimate is about tailoring cost. A fit you can't realistically reach is "high" effort AND usually "stretch" or "misaligned".`;

  const prompt = `Job posting:
${formatJob(body.parsedJob)}

---

Candidate profile:
- Name: ${body.profile.name}
- Title/self-description: ${body.profile.title ?? "(none)"}
- Summary: ${body.profile.summary ?? "(none)"}
- Location: ${body.profile.location ?? "(none)"}

---

Candidate's CV (definitive ground truth — nothing outside this is real):
${JSON.stringify(body.baseCV, null, 2)}

Produce the structured ApplyFitCheck now.`;

  try {
    const { object, usage } = await generateObject({
      model: resolved.model,
      schema,
      schemaName: "ApplyFitCheck",
      schemaDescription:
        "Honest pre-application fit assessment surfacing weaknesses first.",
      system,
      prompt,
    });

    const fit: ApplyFitCheck = {
      ...object,
      generatedAt: Date.now(),
    };

    return jsonWithUsage(
      { fit },
      { feature: resolved.feature, choice: resolved.choice, usage },
    );
  } catch (e) {
    return respondProviderError(e, {
      feature: resolved.feature,
      choice: resolved.choice,
    });
  }
}

function formatJob(job: ParsedJob): string {
  const parts: string[] = [`Title: ${job.title}`, `Company: ${job.company}`];
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
      `\nResponsibilities:\n${job.responsibilities.map((r) => `- ${r}`).join("\n")}`,
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

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
