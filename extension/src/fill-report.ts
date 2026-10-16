// What the Fill view says, as pure functions (like report.ts for Capture): why the page matched a
// package, the package in words, the field rows in the portal's order with their source in words,
// the end-of-fill announcement, and where focus goes after a fill.
import type {
  FieldAnswer, FieldOutcome, FillSource, FillStart, OutcomeCounts, PackageInBrief, PageJobReference, PageKind, PageReading, PendingAnswer, ReadField, SaveOffer, SubmittedApplication,
} from "@apply-kit/core";

const sources: Record<FillSource, string> = { profile: "Profile", "answer-bank": "Answer bank", package: "Package", "cv-version": "CV version", you: "You" };

/** A value's source in words, never colour alone. */
export function sourceWords(source: FillSource): string {
  return sources[source];
}

/** The polite announcement at the end of a fill: "6 filled, 1 needs you". */
export function fillAnnouncement(counts: OutcomeCounts): string {
  const parts = [`${counts.filled} filled`, `${counts.needsYou} ${counts.needsYou === 1 ? "needs" : "need"} you`];
  if (counts.kept) parts.push(`${counts.kept} kept`);
  if (counts.didntStick) parts.push(`${counts.didntStick} didn't stick`);
  return parts.join(", ");
}

export type ChipTone = "met" | "ask" | "partly" | "gap" | "closed";

export interface FieldRow {
  fieldId: string;
  label: string;
  /** What's in the field now, or what it needs. */
  value: string;
  chip: { tone: ChipTone; word: string };
  /** The reason or basis, when there's one worth saying. */
  why: string | null;
  outcome: FieldOutcome["outcome"];
  /** "max 1,000 characters" on a needs-you field with a limit, so a long answer is never cut off. */
  limit: string | null;
  /** apply-kit's value for a kept field ("Replace"), or a value that didn't stick (to paste). */
  offer: string | null;
}

/** The page's fields in the portal's order: label → value → source. */
export function fieldRows(reading: PageReading, answers: FieldAnswer[], outcomes: FieldOutcome[]): FieldRow[] {
  const answer = new Map(answers.map((a) => [a.fieldId, a]));
  const outcome = new Map(outcomes.map((o) => [o.fieldId, o]));
  return reading.fields.flatMap((f): FieldRow[] => {
    const a = answer.get(f.id);
    const o = outcome.get(f.id);
    if (!a || !o) return [];
    const row = { fieldId: f.id, label: f.label, outcome: o.outcome, offer: null, limit: null };
    switch (o.outcome) {
      case "filled":
        return [{ ...row, value: a.kind === "fill" ? a.value : f.value, chip: { tone: "met", word: sourceWords(o.source ?? "profile") }, why: a.kind === "fill" ? a.basis : null }];
      case "kept":
        // A needs-you field with a value: Kris answered it on the page.
        if (a.kind === "needs-you") return [{ ...row, value: f.value, chip: { tone: "met", word: sourceWords("you") }, why: "You answered this on the page." }];
        return [{ ...row, value: f.value, chip: { tone: "partly", word: "Kept" }, why: "The field already had this value, so apply-kit left it.", offer: a.kind === "fill" ? a.value : null }];
      case "needs-you":
        return [{
          ...row, value: a.kind === "needs-you" && a.suggestion ? `Suggested: ${a.suggestion}` : "Not filled", chip: { tone: "ask", word: "Needs you" },
          why: a.kind === "needs-you" ? [a.reason, a.basis].filter(Boolean).join(". ") : null,
          limit: limitWords(f),
        }];
      case "didnt-stick":
        return [{ ...row, value: "Empty: the value didn't stay", chip: { tone: "gap", word: "Didn't stick" }, why: "Paste it into the field yourself.", offer: a.kind === "fill" ? a.value : null }];
      case "skipped":
        return [{ ...row, value: "Not filled", chip: { tone: "closed", word: a.kind === "skip" && a.byRule ? "Skipped · your rule" : "Skipped" }, why: a.kind === "skip" ? a.reason : null }];
    }
  });
}

const limitWords = (f: ReadField) => (f.maxLength !== null && (f.kind === "textarea" || f.kind === "text") ? `max ${f.maxLength.toLocaleString("en-GB")} characters` : null);

/** How Kris answers a needs-you item in the panel: options as radios, a number, long text with its count, or (a file) only on the page. */
export type AnswerControl =
  | { kind: "yes-no"; options: string[] }
  | { kind: "choice"; options: string[] }
  | { kind: "number" }
  | { kind: "long-text"; max: number | null }
  | { kind: "text"; max: number | null }
  | { kind: "tick" }
  | { kind: "file" };

export interface NeedsYouItem {
  fieldId: string;
  question: string;
  limit: string | null;
  control: AnswerControl;
  /** The draft or suggestion to start from ("" for none). */
  value: string;
  /** Why it needs Kris, and what the suggestion or draft rests on. */
  basis: string;
  /** "Save to answer bank": null when not offered (the bank has it, it's decided per job, or it's a file). */
  save: SaveOffer | null;
}

const yesNoWords = /^(yes|no|да|не)$/iu;

function controlFor(f: ReadField): AnswerControl {
  if (f.kind === "file") return { kind: "file" };
  if (f.kind === "checkbox") return { kind: "tick" };
  if (f.options.length > 0) return f.options.every((o) => yesNoWords.test(o.trim())) ? { kind: "yes-no", options: f.options } : { kind: "choice", options: f.options };
  if (f.kind === "number") return { kind: "number" };
  if (f.kind === "textarea") return { kind: "long-text", max: f.maxLength };
  return { kind: "text", max: f.maxLength };
}

/** The needs-you items, first in the panel, in the portal's order: only what still needs Kris. */
export function needsYouItems(reading: PageReading, answers: FieldAnswer[], outcomes: FieldOutcome[]): NeedsYouItem[] {
  const answer = new Map(answers.map((a) => [a.fieldId, a]));
  const outcome = new Map(outcomes.map((o) => [o.fieldId, o]));
  return reading.fields.flatMap((f): NeedsYouItem[] => {
    const a = answer.get(f.id);
    if (a?.kind !== "needs-you" || outcome.get(f.id)?.outcome !== "needs-you") return [];
    return [{
      fieldId: f.id, question: f.label, limit: limitWords(f), control: controlFor(f), value: a.draft ?? a.suggestion ?? "",
      basis: [a.reason, a.basis].filter(Boolean).join(". "), save: a.save ?? null,
    }];
  });
}

/** "Fill 3,300", 'Fill "No"', "Fill this answer". */
export function fillButtonLabel(control: AnswerControl, value: string): string {
  const v = value.trim();
  if (control.kind === "number" && /^\d+([.,]\d+)?$/.test(v)) return `Fill ${Number(v.replace(",", ".")).toLocaleString("en-GB")}`;
  if (control.kind === "yes-no" || control.kind === "choice" || control.kind === "number") return v ? `Fill "${v}"` : "Fill";
  return "Fill this answer";
}

/** The visible count ("312 / 1,000"), and what to announce: once, when 50 or fewer are left (again only after going back over 50). */
export function characterCount(length: number, max: number, warned: boolean): { text: string; announce: string | null; warned: boolean } {
  const text = `${length.toLocaleString("en-GB")} / ${max.toLocaleString("en-GB")}`;
  const left = max - length;
  if (left > 50) return { text, announce: null, warned: false };
  if (warned) return { text, announce: null, warned };
  return { text, announce: `${left} ${left === 1 ? "character" : "characters"} left`, warned: true };
}

/** An answer typed on the portal, as offered: "Question" → answer. */
export const typedAnswerLine = (p: PendingAnswer) => `"${p.question}" → ${p.answer}`;

export const saveTypedLabel = (n: number) => `Save ${n} to the answer bank`;

/** After a fill, focus goes to the first needs-you item; null means it stays on Fill this page. */
export function focusAfterFill(outcomes: FieldOutcome[]): string | null {
  return outcomes.find((o) => o.outcome === "needs-you")?.fieldId ?? null;
}

/** The context card's "why" line for a match. */
export function matchWhy(match: Extract<FillStart, { kind: "matched" }>, pageRef: PageJobReference | null): string {
  const id = pageRef?.jobId ?? match.package.jobRef?.jobId;
  if (match.why === "chosen") return `You chose this package for ${id ? `job ${id}` : "this page"}.`;
  if (match.why === "same-job") return `Matched: job ${id} is another posting of the job your package is for.`;
  if (!pageRef) return `Same application as the last page: job ${id}, your package's target posting.`;
  return `Matched: job ID ${id} is your package's target posting.`;
}

const angleWords = { developer: "Developer", security: "Security", design: "Design" } as const;

/** The package in words, so the right CV is confirmed before anything is attached: [term, detail, note]. */
const atsWords = (ats: PackageInBrief["cv"]["ats"]) => ats.passed === ats.total
  ? ats.accepted.length ? `ATS check passed, ${ats.accepted.length} accepted knowingly` : "ATS check passed"
  : `${ats.passed} of ${ats.total} ATS checks pass`;

export function packageLines(p: PackageInBrief): { term: string; detail: string; note: string | null }[] {
  const ats = atsWords(p.cv.ats);
  return [
    { term: "CV", detail: p.cv.fileName, note: `${angleWords[p.cv.angle]} angle · v${p.version} · ${ats}` },
    { term: "Answers", detail: `${p.answers === 1 ? "1 approved screening answer" : `${p.answers} approved screening answers`}, plus your answer bank`, note: null },
    { term: "Letter", detail: p.letter ? "Ready; used if the portal asks for one" : "No letter in this package", note: null },
  ];
}

/** The "Different job" banner: what the tab moved from and to, and that nothing was filled from the old package. */
export function differentJobLine(previous: Extract<FillStart, { kind: "different-job" }>["previous"], now: { title: string; jobId: string | null }): string {
  const was = previous.job?.title ?? "the previous job";
  const from = previous.jobRef ? `${was} (${previous.jobRef.jobId})` : was;
  const to = now.jobId ? `${now.title} (${now.jobId})` : now.title;
  return `The tab moved from ${from} to ${to}. Nothing was filled from the ${was} package.`;
}

/**
 * Where marking as submitted is offered: "ask" ("Did you submit?") on a portal's confirmation page;
 * "footer" ("I've submitted this") on a form apply-kit doesn't know, where there's no confirmation to
 * detect; nowhere else, and never on a review page, where it would come before Submit.
 */
export function submitPrompt(page: { known: boolean; pageKind: PageKind | null }): "ask" | "footer" | null {
  if (page.pageKind === "review") return null;
  if (page.known) return page.pageKind === "confirmation" ? "ask" : null;
  return "footer";
}

const portalNames: Record<string, string> = { workday: "Workday", greenhouse: "Greenhouse", lever: "Lever", smartrecruiters: "SmartRecruiters", workable: "Workable", ashby: "Ashby" };
const sofia = (iso: string, parts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Sofia", ...parts });
const dayWords = (iso: string) => sofia(iso, { day: "numeric", month: "short" });

/** The banner after Mark as submitted: created now, or already marked on an earlier day. */
export function markedBanner(r: { alreadyMarked: boolean; application: SubmittedApplication }): { lead: string; rest: string } {
  const what = `${r.application.title} at ${r.application.company}`;
  return r.alreadyMarked
    ? { lead: `Already marked as submitted on ${dayWords(r.application.submission.submittedAt)}.`, rest: `${what} has its Application; nothing new was created.` }
    : { lead: "Application created.", rest: `${what} is now tracked.` };
}

/** The Application as marked, in key-values: status, when and how, the package, the portal's host. */
export function markedLines(a: SubmittedApplication, p: PackageInBrief): { term: string; detail: string }[] {
  const s = a.submission;
  const when = `${dayWords(s.submittedAt)}, ${sofia(s.submittedAt, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  const how = s.via === "app" ? "marked in apply-kit" : `via ${s.portal ? (portalNames[s.portal] ?? s.portal) : "the portal"}`;
  const lines = [
    { term: "Status", detail: a.status.charAt(0).toUpperCase() + a.status.slice(1) },
    { term: "Submitted", detail: `${when}, ${how}` },
    { term: "Package", detail: `CV v${p.version} · ${p.answers === 1 ? "1 answer" : `${p.answers} answers`} · ${atsWords(p.cv.ats)}` },
  ];
  if (s.portalUrl) lines.push({ term: "Portal", detail: new URL(s.portalUrl).hostname });
  return lines;
}
