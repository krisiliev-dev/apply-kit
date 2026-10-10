import { generateObject } from "ai";
import { z } from "zod";
import type { CvDocument } from "@/lib/doc/types";
import type { ParsedJob } from "@/lib/app/types";
import type { Settings } from "@/lib/settings/types";
import type { RecruiterReport } from "./types";
import { extractPlainText } from "./extractText";
import { ProviderConfigError, resolveModel } from "@/lib/ai/provider";

// ————————————————————————————————————————————————
// Layer 3 — Recruiter-eye LLM pass.
//
// A 15-second triage from a senior recruiter's perspective. We pass in the
// flattened CV text (not the visual doc) because that's what the human would
// skim. The model returns a structured report; we surface every field in the
// UI and map issues into unified warnings.
// ————————————————————————————————————————————————

const flaggedIssueSchema = z.object({
  kind: z
    .enum([
      "unclear-header",
      "inconsistent-tense",
      "buzzword-no-evidence",
      "over-claiming",
      "format-issue",
      "other",
    ])
    .describe("Which category the issue falls into."),
  message: z
    .string()
    .describe("One terse sentence a recruiter would mutter to themselves."),
});

const recruiterSchema = z.object({
  strongestSignal: z
    .string()
    .describe(
      "The single thing on the page that makes you want to keep reading. Be specific — cite the line.",
    ),
  biggestWeakness: z
    .string()
    .describe(
      "The single thing most likely to get the CV tossed. Be direct, not polite.",
    ),
  concreteImprovement: z
    .string()
    .describe(
      "One specific change the candidate should make next. Not general advice.",
    ),
  flaggedIssues: z
    .array(flaggedIssueSchema)
    .describe(
      "Up to 6 specific issues. Cover unclear headers, inconsistent tenses, buzzwords without evidence, over-claiming, formatting problems.",
    ),
  interviewOdds: z
    .enum(["Low", "Mid", "High"])
    .describe("Subjective gut call on whether this CV earns a phone screen for the target role."),
});

type RecruiterSchema = z.infer<typeof recruiterSchema>;

const SYSTEM = `You are a senior recruiter. You skim hundreds of CVs per day. A candidate gets about 15 seconds of your attention before you decide: pass, maybe, keep.

For the CV you're about to see, produce a structured triage. Be terse. Be honest. No hedging.

Report:
- strongestSignal: the single thing that makes you want to keep reading
- biggestWeakness: the single thing most likely to get this tossed
- concreteImprovement: one specific next-step change
- flaggedIssues: up to 6 specific problems. Call out:
  • unclear section headers (e.g. "Stuff" instead of "Experience")
  • inconsistent verb tenses across bullets
  • buzzwords with no concrete evidence ("passionate", "synergy", "results-driven")
  • over-claiming ("rebuilt the entire platform" for someone with 6 months)
  • format issues a human eye catches (walls of text, orphan lines, weird caps)
- interviewOdds: Low | Mid | High — your gut on whether this earns a screen for the target role

Do not pad. If there are fewer than 6 issues, return fewer. Do not be nice.`;

export async function recruiterEyePass(
  doc: CvDocument,
  job: ParsedJob | null,
  settings?: Settings,
): Promise<RecruiterReport> {
  let model;
  try {
    model = resolveModel("evaluator", settings);
  } catch (err) {
    const reason =
      err instanceof ProviderConfigError
        ? err.message
        : "AI provider not configured — recruiter-eye pass skipped.";
    return {
      strongestSignal: "",
      biggestWeakness: "",
      concreteImprovement: "",
      flaggedIssues: [],
      interviewOdds: "Mid",
      unavailable: true,
      unavailableReason: reason,
    };
  }

  const cvText = extractPlainText(doc);
  const prompt = buildPrompt(cvText, doc.targetRole, job);

  try {
    const { object } = await generateObject({
      model,
      schema: recruiterSchema,
      schemaName: "RecruiterReport",
      schemaDescription: "A senior recruiter's 15-second triage of a CV.",
      system: SYSTEM,
      prompt,
    });

    return toReport(object);
  } catch (err) {
    const message = err instanceof Error ? err.message : "recruiter pass failed";
    return {
      strongestSignal: "",
      biggestWeakness: "",
      concreteImprovement: "",
      flaggedIssues: [],
      interviewOdds: "Mid",
      unavailable: true,
      unavailableReason: `Recruiter pass error: ${message}`,
    };
  }
}

function buildPrompt(
  cvText: string,
  targetRole: string,
  job: ParsedJob | null,
): string {
  const parts: string[] = [];
  parts.push(`Target role (from the CV variant): ${targetRole}`);
  if (job) {
    parts.push("");
    parts.push(`Job posting context:`);
    parts.push(`  Title: ${job.title}`);
    parts.push(`  Company: ${job.company}`);
    if (job.description) {
      parts.push(`  Description: ${job.description.slice(0, 800)}`);
    }
    if (job.requirements?.length) {
      parts.push(`  Requirements: ${job.requirements.slice(0, 8).join("; ")}`);
    }
  }
  parts.push("");
  parts.push("CV text (flow-extracted, top-to-bottom):");
  parts.push("---");
  parts.push(cvText.slice(0, 8000));
  parts.push("---");
  parts.push("");
  parts.push("Return the structured report. 15 seconds. Go.");
  return parts.join("\n");
}

function toReport(s: RecruiterSchema): RecruiterReport {
  return {
    strongestSignal: s.strongestSignal,
    biggestWeakness: s.biggestWeakness,
    concreteImprovement: s.concreteImprovement,
    flaggedIssues: s.flaggedIssues,
    interviewOdds: s.interviewOdds,
  };
}
