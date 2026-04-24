import { generateText } from "ai";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/interview/research
// Light-touch "public signals" endpoint. Given a company name and any URLs / notes
// the user has pasted from their own reading, produce a short characterisation
// of the company's likely interview style, product focus, and stage/size.
//
// No scraping happens here. The model works from its pre-training plus the text
// the user supplies. If the user has nothing to paste, the model still returns
// a short general note but flags low confidence.
//
// TODO: swap to a real web-search tool (Valyu / similar) when one is wired in.

export const runtime = "nodejs";
export const maxDuration = 45;

const MAX_INPUT = 10000;

type Body = {
  company?: unknown;
  role?: unknown;
  notes?: unknown;
  settings?: Settings;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
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

  const company = typeof body.company === "string" ? body.company.trim() : "";
  const role = typeof body.role === "string" ? body.role.trim() : "";
  const notes =
    typeof body.notes === "string"
      ? body.notes.trim().slice(0, MAX_INPUT)
      : "";

  if (!company) {
    return json({ error: 'Field "company" is required.' }, 400);
  }

  const system = `You give candidates a short, honest read on a company's interview posture, drawing on your pre-training knowledge PLUS any URLs or notes the user pasted.

Rules:
- No invention. If you don't have a confident signal, say so. Flag low-confidence claims with "(unverified)".
- No marketing language about the company. Plain, descriptive, useful.
- No URLs unless the user provided them in the notes.
- Output PLAIN TEXT with two sections, separated by a blank line:

Overview
A 3–5 sentence paragraph: what the company does, stage / size, where its engineering reputation sits, anything concrete about interview style the candidate should expect.

Signals
A short bulleted list (3–6 bullets). Each bullet is a short statement prefixed by a source tag in square brackets, e.g. "[Glassdoor]" or "[user notes]" or "[pre-training]". Keep bullets tight — one line each.`;

  const promptParts: string[] = [];
  promptParts.push(`Company: ${company}`);
  if (role) promptParts.push(`Role the user is applying for: ${role}`);
  if (notes) {
    promptParts.push("");
    promptParts.push(
      "User-pasted notes (URLs, Glassdoor quotes, engineering-blog excerpts):",
    );
    promptParts.push(notes);
  } else {
    promptParts.push("");
    promptParts.push(
      "(No user notes supplied — work from pre-training only and mark claims 'unverified' as needed.)",
    );
  }

  try {
    const { text, usage } = await generateText({
      model: resolved.model,
      system,
      prompt: promptParts.join("\n"),
    });
    return jsonWithUsage(
      { research: text.trim() },
      { feature: resolved.feature, choice: resolved.choice, usage },
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
