// Step 5 of a package, the ATS check (#67), as Kris sees it: the CV's PDF read back the way a
// parser reads it (the text in reading order, a line marked where a field was lost), pass or fail
// per check in plain words, and the fixes that ask for a fact rather than guess one. Pure: the
// checks themselves are in documents/ats.ts; the text was read from the PDF on this laptop.
import type { AtsCheck, AtsCheckId, AtsKeyword } from "../documents/ats.ts";
import type { PdfText } from "./ports.ts";

export const atsCheckLabel: Record<AtsCheckId, string> = {
  "text-based": "Text-based PDF",
  "single-column": "Single column, in reading order",
  contact: "Contact details found",
  sections: "Sections found",
  dates: "Dates read as months and years",
  pages: "One page",
  keywords: "Posting keywords found",
  bullets: "Bullets short enough",
  summary: "Summary short enough",
  "file-name": "File name portals accept",
};

export interface AtsCheckView {
  check: AtsCheckId;
  label: string;
  passed: boolean;
  /** What failed, one line per problem; empty when it passes. */
  problems: string[];
  /** What passed on purpose (a deliberate gap) and why. */
  notes: string[];
}

/** One line of the text as a parser reads it; `lost` names what the parser couldn't read on it. */
export interface AtsLine {
  text: string;
  lost: string | null;
}

/** A contact detail the CV lacks: the fix asks for it, and can save it to the master profile. */
export type AtsFixField = "phone" | "city" | "country";

export interface AtsFixView {
  id: "contact";
  /** "Add your phone number". */
  title: string;
  /** Why, in plain words: what the parser looks for. Nothing is guessed. */
  detail: string;
  fields: { field: AtsFixField; label: string }[];
}

export interface AtsStepView {
  checks: AtsCheckView[];
  passing: number;
  /** The text in reading order, page after page. */
  lines: AtsLine[];
  /** What the parser didn't find anywhere ("Phone"). */
  lost: string[];
  fixes: AtsFixView[];
  /** Kris approved knowing these checks fail. */
  accepted: AtsCheckId[];
}

/** Leading words a posting wraps a keyword in ("Experience with Wazuh" → "Wazuh"). */
const filler = /^(?:(?:hands-on|solid|strong|good|deep|proven|practical|working)\s+)*(?:experience|knowledge|familiarity|proficiency|expertise|skills?)\s+(?:with|in|of|using)\s+/i;

/**
 * The posting keywords a parser searches the CV for: its skill and certificate requirements, as
 * named. A gap Kris decided to name or leave out, and a preferred item she doesn't hold, pass as
 * deliberate gaps with the reason.
 */
export function postingKeywords(requirements: { text: string; category?: string; gap?: string | null }[]): AtsKeyword[] {
  return requirements
    .filter((r) => r.category === "skill" || r.category === "certificate")
    .map((r) => ({ term: r.text.trim().replace(filler, ""), ...(r.gap ? { gap: r.gap } : {}) }));
}

export function atsStepView(input: {
  ats: AtsCheck;
  text: PdfText;
  headings: string[];
  missing: AtsFixField[];
  accepted: AtsCheckId[];
}): AtsStepView {
  const checks = input.ats.checks.map((c) => ({ check: c.check, label: atsCheckLabel[c.check], passed: c.passed, problems: c.problems, notes: c.notes }));
  const dates = input.ats.checks.find((c) => c.check === "dates")?.problems ?? [];
  const lines = input.text.pages.flatMap((p) => p.lines).map((raw) => {
    const text = raw.replace(/\s+/g, " ").trim();
    const role = input.headings.find((h) => text.startsWith(h) && dates.some((d) => d.startsWith(`${h}:`)));
    return { text, lost: role ? "no dates found" : null };
  }).filter((l) => l.text);
  const contact = input.ats.checks.find((c) => c.check === "contact")?.problems ?? [];
  const sections = input.ats.checks.find((c) => c.check === "sections")?.problems ?? [];
  const lost = [...contact, ...sections];
  const fixes: AtsFixView[] = [];
  if (input.missing.length) {
    const phone = input.missing.includes("phone");
    const place = input.missing.filter((f) => f !== "phone");
    fixes.push({
      id: "contact",
      title: phone && place.length ? "Add your phone number and where you live" : phone ? "Add your phone number" : "Add where you live",
      detail: "Parsers fill a portal's contact fields from the CV, and your profile doesn't have this yet. Nothing is guessed: give the real one.",
      fields: input.missing.map((field) => ({ field, label: field === "phone" ? "Phone, with the country code" : field === "city" ? "City" : "Country" })),
    });
  }
  return { checks, passing: checks.filter((c) => c.passed).length, lines, lost, fixes, accepted: input.accepted };
}
