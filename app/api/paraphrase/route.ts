import { generateText } from "ai";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";
import { USAGE_HEADER } from "@/lib/ai/tokenTracker";

// POST /api/paraphrase
// Body: { text: string, context?: string }
// Returns: { text: string }
//
// Used by the browser extension to paraphrase a field while keeping meaning
// and tone. Small, focused, non-streaming — the extension is stuffing the
// output into an input box and wants the whole string at once.

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_INPUT = 6000;

type Body = { text?: unknown; context?: unknown; settings?: Settings };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  let resolved;
  try {
    resolved = resolveForRoute("paraphrase", body);
  } catch (err) {
    return respondProviderError(err, {
      feature: "paraphrase",
      settings: body.settings,
    });
  }

  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (!raw) return json({ error: 'Field "text" is required.' }, 400);
  if (raw.length > MAX_INPUT)
    return json(
      { error: `Field "text" exceeds ${MAX_INPUT} characters.` },
      400,
    );

  const context =
    typeof body.context === "string" && body.context.trim()
      ? body.context.trim().slice(0, 2000)
      : undefined;

  try {
    const { text, usage } = await generateText({
      model: resolved.model,
      system:
        "Paraphrase the input preserving meaning and tone, adapting slightly to the context. Output plain text only — no preamble, no quotes, no markdown.",
      prompt: context
        ? `Context:\n${context}\n\nParaphrase this:\n${raw}`
        : `Paraphrase this:\n${raw}`,
    });
    return jsonWithUsage(
      { text: text.trim() },
      {
        feature: resolved.feature,
        choice: resolved.choice,
        usage,
        extraHeaders: { "access-control-allow-origin": "*", "access-control-expose-headers": USAGE_HEADER },
      },
    );
  } catch (e) {
    return respondProviderError(e, {
      feature: resolved.feature,
      choice: resolved.choice,
    });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}
