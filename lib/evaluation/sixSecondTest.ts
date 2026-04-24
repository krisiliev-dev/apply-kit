import { generateObject } from "ai";
import { z } from "zod";
import type { CvDocument } from "@/lib/doc/types";
import type { Settings } from "@/lib/settings/types";
import type { AffindaExtracted, SixSecondReport } from "./types";
import { extractPlainText } from "./extractText";
import { ProviderConfigError, resolveModel } from "@/lib/ai/provider";

// ————————————————————————————————————————————————
// Six-second test simulator.
//
// The recruiter-eye pass (layer 3) gives the model 15 seconds of skim. This
// layer is tighter and more brutal: the model is told it has SIX seconds and
// must report back name, current role, seniority impression, strongest
// signal, and the one thing it would remember in 10 minutes.
//
// After the reply, we compare the model's `nameRead`/`currentRoleRead` to the
// actual data (from the Affinda-parsed extraction where available, else from
// the doc text) and add hard warnings if they mismatch — those indicate the
// CV fails the "first glance" test.
//
// Input: rendered PDF buffer. We pass it to Claude as a file part so the
// model sees the visual layout (important — this is a scannability test, not
// a text test). Falls back cleanly when ANTHROPIC_API_KEY is missing.
// ————————————————————————————————————————————————

const reportSchema = z.object({
  nameRead: z
    .string()
    .optional()
    .describe(
      "The candidate's name as you read it in your 6-second skim. Omit if you couldn't find one.",
    ),
  currentRoleRead: z
    .string()
    .optional()
    .describe(
      "The candidate's most recent role and company as you read it. Omit if unclear.",
    ),
  seniorityImpression: z
    .enum(["junior", "mid", "senior", "staff", "unclear"])
    .optional()
    .describe("Your gut impression of seniority from the skim."),
  strongestSignal: z
    .string()
    .describe(
      "The one thing on the page that stood out in 6 seconds. Cite the exact phrase you saw.",
    ),
  oneThingRemembered: z
    .string()
    .describe(
      "If asked about this candidate in 10 minutes, what single detail would you remember?",
    ),
  misreadings: z
    .array(z.string())
    .describe(
      "Things you read wrong or couldn't parse at a glance (e.g. 'thought role was at Google, unclear'). Empty array if none.",
    ),
  scannabilityScore: z
    .number()
    .min(0)
    .max(100)
    .describe(
      "0-100. How easy was it to extract the essentials in 6 seconds? 100 = effortless, 0 = couldn't tell what the CV is about.",
    ),
  warnings: z
    .array(z.string())
    .describe(
      "Up to 4 actionable notes on what to fix so the next skim goes better. Empty if nothing worth flagging.",
    ),
});

type ReportSchema = z.infer<typeof reportSchema>;

const SYSTEM = `You are a senior technical recruiter sifting a resume pile. You have about SIX SECONDS per CV before you decide skim / toss / shortlist. No re-reads.

For the CV that follows, produce a report of what actually stuck.

Rules:
  • Be honest about what you DIDN'T read. If the name isn't clear in 6s, say so — do not guess.
  • "strongestSignal" must cite the specific phrase you saw (e.g. "Staff Engineer at Stripe"), not a category.
  • "oneThingRemembered" is what you'd recall unaided in 10 minutes. One detail, not a summary.
  • "misreadings" = things you got wrong, couldn't parse, or noticed were confusing at a glance.
  • "scannabilityScore" is a gut number, not an average. Walls of text, tiny fonts, graphs-as-images = low. Clean hierarchy, bold headline + company = high.
  • "warnings" are concrete fixes — "Move name to top-left; currently lost under logo" beats "improve visibility".

Short answers. No hedging. No padding.`;

export type SixSecondInput = {
  doc: CvDocument;
  pdf: Buffer;
  /** When available, used to sanity-check whether the model read things right. */
  extracted?: AffindaExtracted | null;
  settings?: Settings;
};

export async function runSixSecondTest(
  input: SixSecondInput,
): Promise<SixSecondReport> {
  let model;
  try {
    model = resolveModel("evaluator", input.settings);
  } catch (err) {
    const reason =
      err instanceof ProviderConfigError
        ? err.message
        : "AI provider not configured — six-second test skipped.";
    return unavailable(reason);
  }

  try {
    const { object } = await generateObject({
      model,
      schema: reportSchema,
      schemaName: "SixSecondReport",
      schemaDescription:
        "A senior recruiter's 6-second skim report on a rendered CV PDF.",
      system: SYSTEM,
      // Low temperature — we want the model's honest gut, not creative prose.
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildUserPrompt(input.doc),
            },
            {
              type: "file",
              data: input.pdf,
              mediaType: "application/pdf",
            },
          ],
        },
      ],
    });

    return augmentWithMismatchChecks(toReport(object), input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "six-second pass failed";
    return unavailable(`Six-second test error: ${message}`);
  }
}

function buildUserPrompt(doc: CvDocument): string {
  const parts: string[] = [];
  parts.push(
    `The attached PDF is a CV for a "${doc.targetRole}" role. You have 6 seconds to skim it.`,
  );
  parts.push("");
  parts.push(
    "Produce the structured report. Do not study the PDF — respond with only what you would actually absorb in a 6-second glance.",
  );
  return parts.join("\n");
}

function toReport(s: ReportSchema): SixSecondReport {
  return {
    nameRead: s.nameRead,
    currentRoleRead: s.currentRoleRead,
    seniorityImpression: s.seniorityImpression,
    strongestSignal: s.strongestSignal,
    oneThingRemembered: s.oneThingRemembered,
    misreadings: s.misreadings,
    scannabilityScore: Math.round(s.scannabilityScore),
    warnings: s.warnings,
  };
}

// After the model reports what it saw, compare against the parsed/extracted
// data. A mismatch on name or current role is a hard warning — it means the
// CV's most important identity bits aren't readable at a glance.
function augmentWithMismatchChecks(
  report: SixSecondReport,
  input: SixSecondInput,
): SixSecondReport {
  const extra: string[] = [];
  const actualName = resolveActualName(input);
  const actualRole = resolveActualCurrentRole(input);

  if (report.nameRead && actualName) {
    if (!softEquals(report.nameRead, actualName)) {
      extra.push(
        `Parser / reader didn't identify your name correctly at a glance — read as "${report.nameRead}" vs actual "${actualName}".`,
      );
    }
  } else if (!report.nameRead && actualName) {
    extra.push(
      `Parser / reader didn't identify your name correctly at a glance — nothing was picked up in 6 seconds.`,
    );
  }

  if (report.currentRoleRead && actualRole) {
    if (!softContains(report.currentRoleRead, actualRole)) {
      extra.push(
        `Current role isn't readable at a glance — skim read "${report.currentRoleRead}" vs actual "${actualRole}".`,
      );
    }
  } else if (!report.currentRoleRead && actualRole) {
    extra.push(
      `Current role not captured in 6 seconds — consider making the most recent title more prominent.`,
    );
  }

  // If scannability is low but no warnings came back, add a conservative one.
  const warnings = [...report.warnings, ...extra];
  if (report.scannabilityScore < 50 && warnings.length === 0) {
    warnings.push(
      "Scannability below 50 — essentials aren't visible in a skim. Try larger name, bolder recent role, fewer walls of text.",
    );
  }

  return { ...report, warnings };
}

function resolveActualName(input: SixSecondInput): string | undefined {
  if (input.extracted?.name) return input.extracted.name;
  // Fallback — take the first non-empty text line of the doc.
  const text = extractPlainText(input.doc).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return text[0];
}

function resolveActualCurrentRole(input: SixSecondInput): string | undefined {
  const exp = input.extracted?.workExperience ?? [];
  if (exp.length === 0) return undefined;
  const first = exp[0];
  const bits: string[] = [];
  if (first.title) bits.push(first.title);
  if (first.company) bits.push(first.company);
  return bits.length ? bits.join(" at ") : undefined;
}

function softEquals(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) === n(b);
}

function softContains(haystack: string, needle: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const h = n(haystack);
  const candidate = n(needle);
  if (!candidate) return true;
  if (h.includes(candidate)) return true;
  // Any token of the needle longer than 3 chars appears in the haystack.
  const tokens = candidate.split(" ").filter((t) => t.length > 3);
  if (tokens.length === 0) return false;
  return tokens.some((t) => h.includes(t));
}

function unavailable(reason: string): SixSecondReport {
  return {
    strongestSignal: "",
    oneThingRemembered: "",
    misreadings: [],
    scannabilityScore: 60,
    warnings: [],
    unavailable: true,
    unavailableReason: reason,
  };
}
