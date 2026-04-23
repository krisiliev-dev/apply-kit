import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { fetchJobFromUrl } from "@/lib/jobs/fetch";

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(
      {
        error:
          "ANTHROPIC_API_KEY missing. Add it to .env.local and restart the dev server.",
      },
      400,
    );
  }

  let body: { url?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
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
    const { object } = await generateObject({
      model: anthropic("claude-sonnet-4-6"),
      schema: parsedJobSchema,
      schemaName: "ParsedJob",
      schemaDescription: "Structured extraction of a job posting.",
      system:
        "You extract structured data from job postings. Be faithful to the source — don't invent salary, location, or requirements. Trim bullets to tight phrases; drop fluff. Keywords should be concrete skills, tools, or domains a CV should echo.",
      prompt: `Extract the job posting below.\n\n---\n${sourceText}\n---`,
    });

    return json({ job: { ...object, sourceUrl } });
  } catch (e) {
    return json(
      {
        error:
          e instanceof Error ? e.message : "Model failed to return a parsed job.",
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
