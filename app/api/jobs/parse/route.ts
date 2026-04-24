import { generateObject } from "ai";
import { z } from "zod";
import { fetchJobFromUrl } from "@/lib/jobs/fetch";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/jobs/parse
// Body: { url?: string; text?: string }
// Returns a ParsedJob (or an error) extracted via Anthropic structured output.

export const runtime = "nodejs";
export const maxDuration = 60;

const parsedJobSchema = z.object({
  title: z.string().describe("The role title."),
  company: z.string().describe("The hiring company name."),
  location: z.string().optional().describe("Primary location; remote/hybrid if stated."),
  salary: z.string().optional().describe("Any compensation info verbatim."),
  description: z.string().optional().describe("A 2–3 sentence summary of the role."),
  requirements: z.array(z.string()).describe("Must-have qualifications, short phrases."),
  responsibilities: z.array(z.string()).describe("What the hire will do day-to-day."),
  niceToHave: z.array(z.string()).optional().describe("Nice-to-have qualifications."),
  keywords: z
    .array(z.string())
    .describe("Technical keywords/skills a CV should echo (5–15 items)."),
});

export async function POST(req: Request) {
  let body: { url?: string; text?: string; settings?: Settings };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
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

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!url && !text) {
    return json({ error: "Provide a URL or pasted job description text." }, 400);
  }

  let sourceText = text;
  let sourceUrl: string | undefined = url || undefined;

  if (url && !text) {
    const fetched = await fetchJobFromUrl(url);
    if (!fetched.ok) {
      return json({ error: fetched.message, reason: fetched.reason }, 400);
    }
    sourceText = fetched.text;
    sourceUrl = fetched.url;
  }

  if (sourceText.length < 40) {
    return json({ error: "Not enough text to parse." }, 400);
  }

  try {
    const { object, usage } = await generateObject({
      model: resolved.model,
      schema: parsedJobSchema,
      schemaName: "ParsedJob",
      schemaDescription: "Structured extraction of a job posting.",
      system:
        "You extract structured data from job postings. Be faithful to the source — don't invent salary, location, or requirements. Trim bullets to tight phrases; drop fluff. Keywords should be concrete skills, tools, or domains a CV should echo.",
      prompt: `Extract the job posting below.\n\n---\n${sourceText}\n---`,
    });

    return jsonWithUsage(
      { job: { ...object, sourceUrl } },
      {
        feature: resolved.feature,
        choice: resolved.choice,
        usage,
      },
    );
  } catch (e) {
    return respondProviderError(e, {
      feature: resolved.feature,
      choice: resolved.choice,
    });
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
