import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type { ParsedJob } from "@/lib/app/types";
import type { CVContent } from "@/lib/types";

// POST /api/jobs/draft
// Takes a ParsedJob + the user's base CV content and produces a tailored
// variant of the CVContent (reworded bullets, reordered emphasis, sharper
// summary). The client then pipes that through `seedFromContent` to make a
// CvDocument, saves it under a new slug, and redirects into the editor.

export const runtime = "nodejs";
export const maxDuration = 60;

const tailoredCvSchema = z.object({
  targetRole: z.string().describe("The role this variant targets; verbatim from the job."),
  profile: z.object({
    name: z.string(),
    title: z.string().describe("A sharpened one-line title aimed at this role."),
    email: z.string(),
    location: z.string().optional(),
    phone: z.string().optional(),
    links: z
      .array(z.object({ label: z.string(), href: z.string() }))
      .optional(),
    summary: z
      .string()
      .describe(
        "A 2–3 sentence summary rewritten to speak directly to this role. Concrete, no clichés.",
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
            "Tighter, impact-first bullets that surface anything overlapping the job's requirements. Keep truthful to the original experience.",
          ),
        tags: z.array(z.string()).optional(),
      }),
    )
    .describe(
      "All experiences from the base CV, kept in chronological order. Never invent roles or companies.",
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
      "Reordered so items that match the job keywords come first within each group.",
    ),
  interests: z.array(z.string()).optional(),
  tailoringNotes: z
    .array(z.string())
    .describe(
      "3–6 short bullets explaining what you changed and why — surfaced to the user in the UI.",
    ),
});

type Body = {
  job: ParsedJob;
  baseCv: CVContent;
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

  try {
    const { object } = await generateObject({
      model: anthropic("claude-sonnet-4-6"),
      schema: tailoredCvSchema,
      schemaName: "TailoredCV",
      schemaDescription: "A tailored CV variant for a specific job posting.",
      system: `You tailor CVs for specific roles. You NEVER invent experience, companies, titles, dates, schools, or metrics. You reword and reorder what the user has already done so their real work speaks most clearly to this specific posting.

Rules:
- Keep all experiences and education exactly as the user provided them — same companies, same roles, same dates. You may rewrite bullets and summaries.
- Rewrite bullets to lead with the impact or skill that overlaps with the job. Cut filler. Keep numbers the user provided.
- Rewrite profile.summary to speak to this role in 2–3 sentences. Voice should stay human — no "results-driven professional".
- Reorder skill groups so the most relevant items come first; never add skills the user didn't list.
- Always return tailoringNotes explaining what you changed and why.`,
      prompt: `Job posting:
Title: ${body.job.title}
Company: ${body.job.company}
${body.job.location ? `Location: ${body.job.location}\n` : ""}${body.job.salary ? `Salary: ${body.job.salary}\n` : ""}
Requirements:
${body.job.requirements.map((r) => `- ${r}`).join("\n")}

Responsibilities:
${body.job.responsibilities.map((r) => `- ${r}`).join("\n")}

${body.job.niceToHave?.length ? `Nice to have:\n${body.job.niceToHave.map((r) => `- ${r}`).join("\n")}\n` : ""}
Keywords to echo where truthful: ${body.job.keywords.join(", ")}

———

User's base CV (do not invent beyond this):
${JSON.stringify(body.baseCv, null, 2)}`,
    });

    return json({ cv: object });
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

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
