import { generateObject } from "ai";
import { z } from "zod";
import type { OfferRecord } from "@/lib/app/types";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/salary/parse
// Body: { rawOfferText: string }
// Returns: { offer: OfferRecord }
//
// Extracts structured offer components from free-form text. Does NOT analyse
// the offer — that's /api/salary/analyze.

export const runtime = "nodejs";
export const maxDuration = 30;

const offerSchema = z.object({
  baseSalary: z
    .number()
    .describe(
      "Base annual salary in the stated currency. Resolve abbreviations like 180k → 180000. If only a range is given, use the midpoint.",
    ),
  currency: z
    .string()
    .describe(
      "3-letter currency code, uppercase. Default to USD when unclear. £ → GBP, € → EUR, $ → USD.",
    ),
  equity: z
    .string()
    .optional()
    .describe(
      "Free-form equity description if mentioned (e.g. '0.25% vesting 4yr, 1yr cliff', '50k RSUs over 4yr'). Omit if not present.",
    ),
  bonus: z
    .string()
    .optional()
    .describe(
      "Free-form bonus description if mentioned (e.g. '15% target', '10-20% variable'). Omit if not present.",
    ),
  signOn: z
    .number()
    .optional()
    .describe("Sign-on bonus as a number in the same currency. Omit if absent."),
  ptoDays: z
    .number()
    .optional()
    .describe(
      "Paid time off in days per year, if explicitly stated. Ignore vague phrases like 'generous PTO'.",
    ),
  remote: z
    .enum(["remote", "hybrid", "on-site"])
    .optional()
    .describe("Work arrangement if stated."),
  benefits: z
    .string()
    .optional()
    .describe(
      "Short free-form summary of other benefits worth calling out (health, learning budget, 401k match). Omit if none.",
    ),
});

type Body = { rawOfferText?: string; settings?: Settings };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const raw = (body.rawOfferText ?? "").trim();
  if (!raw) {
    return json({ error: "Missing rawOfferText." }, 400);
  }
  if (raw.length > 8000) {
    return json({ error: "Offer text too long (>8000 chars)." }, 400);
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

  const system = `You parse job-offer text into structured fields. You never invent amounts the text doesn't state — if a number is missing, leave the field out.

Normalisation:
- "180k" / "$180K" / "180,000 USD" → baseSalary 180000, currency USD.
- "£95,000" → baseSalary 95000, currency GBP.
- Ranges: use the midpoint. Comment on range-only offers in equity/bonus if relevant.
- For bonus that's stated as a percent, keep as a string like "15% target".
- Do not confuse equity dollar values with base salary.`;

  const prompt = `Offer text:\n"""\n${raw}\n"""\n\nExtract the structured offer now.`;

  try {
    const { object, usage } = await generateObject({
      model: resolved.model,
      schema: offerSchema,
      schemaName: "OfferRecord",
      schemaDescription: "Structured extraction of a job offer's key components.",
      system,
      prompt,
    });

    const offer: OfferRecord = {
      ...object,
      currency: object.currency.toUpperCase(),
      rawOfferText: raw,
      receivedAt: Date.now(),
    };

    return jsonWithUsage(
      { offer },
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
