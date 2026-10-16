// What the Fill view says, as pure functions (like report.ts for Capture): why the page matched a
// package, the package in words, the field rows in the portal's order with their source in words,
// the end-of-fill announcement, and where focus goes after a fill.
import { countOutcomes } from "@apply-kit/core/fill";
import type {
  EntrySection, FieldAnswer, FieldOutcome, FillSource, FillStart, OutcomeCounts, PackageFileKind, PackageInBrief, PageJobReference, PageKind, PageReading, PendingAnswer, ReadField, SaveOffer, SubmittedApplication,
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
  /** A list or typeahead with more than one plausible match: the options for Kris to choose between. */
  choices: string[] | null;
}

const sectionNouns: Record<EntrySection, [string, string]> = { work: ["job entry", "job entries"], education: ["education entry", "education entries"] };
const sectionHeads: Record<EntrySection, string> = { work: "Work Experience", education: "Education" };

/** The page's fields in the portal's order: label → value → source. */
export function fieldRows(reading: PageReading, answers: FieldAnswer[], outcomes: FieldOutcome[]): FieldRow[] {
  const answer = new Map(answers.map((a) => [a.fieldId, a]));
  const outcome = new Map(outcomes.map((o) => [o.fieldId, o]));
  return reading.fields.flatMap((f): FieldRow[] => {
    const a = answer.get(f.id);
    const o = outcome.get(f.id);
    if (!a || !o) return [];
    const row = { fieldId: f.id, label: f.label, outcome: o.outcome, offer: null, limit: null, choices: null };
    if (a.kind === "entries") {
      const n = Number(f.value) || 0;
      if (o.outcome === "filled") return [{ ...row, value: `${n} ${n === 1 ? "entry" : "entries"}`, chip: { tone: "met", word: sourceWords("cv-version") }, why: a.basis }];
      if (o.outcome === "needs-you") return [{ ...row, value: `Add ${a.add} more ${a.add === 1 ? "entry" : "entries"}`, chip: { tone: "ask", word: "Needs you" }, why: `Add ${a.add === 1 ? "it" : "them"} with Workday's Add button; apply-kit can't press it. ${a.basis}` }];
      if (o.outcome === "didnt-stick") return [{ ...row, value: "Not all added", chip: { tone: "gap", word: "Didn't stick" }, why: `Workday didn't add every entry. ${a.basis}` }];
      return [{ ...row, value: `${n} ${n === 1 ? "entry" : "entries"}`, chip: { tone: "closed", word: "Skipped" }, why: "Workday changed this section while reading your CV. Click Fill this page again." }];
    }
    if (o.outcome === "needs-you" && a.kind === "fill" && reading.jobRef?.portal === "workday") {
      // apply-kit had the value but couldn't put it in: a list it can't open, or more than one match.
      if (o.choices?.length) return [{ ...row, value: `Suggested: ${o.choices[0]}`, chip: { tone: "ask", word: "Needs you" }, why: `Workday offers more than one match for "${a.value}"`, choices: o.choices }];
      return [{ ...row, value: `Choose: ${a.value.split("\n").join(", ")}`, chip: { tone: "ask", word: "Needs you" }, why: "apply-kit can't open Workday's lists yet. Choose it on the page" }];
    }
    if (a.kind === "file") {
      if (o.outcome === "filled") return [{ ...row, value: a.fileName, chip: { tone: "met", word: sourceWords("package") }, why: a.basis }];
      if (o.outcome === "didnt-stick") return [{ ...row, value: "Not attached", chip: { tone: "gap", word: "Didn't attach" }, why: "Attach it yourself from your Packages folder." }];
      if (o.outcome === "kept") return [{ ...row, value: "Another file", chip: { tone: "partly", word: "Kept" }, why: "The field already had a file, so apply-kit left it." }];
    }
    switch (o.outcome) {
      case "filled":
        // A typeahead's picks (skills) are one per line: shown as a list.
        return [{ ...row, value: (a.kind === "fill" ? a.value : f.value).split("\n").join(", "), chip: { tone: "met", word: sourceWords(o.source ?? "profile") }, why: a.kind === "fill" ? a.basis : null }];
      case "kept":
        // A needs-you field with a value: Kris answered it on the page.
        if (a.kind === "needs-you") return [{ ...row, value: f.value, chip: { tone: "met", word: sourceWords("you") }, why: "You answered this on the page." }];
        return [{ ...row, value: f.value, chip: { tone: "partly", word: "Kept" }, why: "The field already had this value, so apply-kit left it.", offer: a.kind === "fill" && a.value.trim() !== f.value.trim() ? a.value : null }];
      case "needs-you":
        if (o.choices?.length && a.kind === "fill") {
          return [{
            ...row, value: o.choices.join(" or "), chip: { tone: "ask", word: "Needs you" },
            why: `More than one place fits "${a.value}" (from your ${sourceWords(a.source).toLowerCase()}). Pick yours on the page; apply-kit doesn't choose between them.`,
          }];
        }
        return [{
          ...row, value: a.kind === "needs-you" && a.suggestion ? `Suggested: ${a.suggestion}` : "Not filled", chip: { tone: "ask", word: "Needs you" },
          why: a.kind === "needs-you" ? [a.reason, a.basis].filter(Boolean).join(". ") : null,
          limit: limitWords(f),
        }];
      case "didnt-stick":
        return [{ ...row, value: a.kind === "fill" ? a.value : "Empty: the value didn't stay", chip: { tone: "gap", word: "Didn't stick" }, why: "Paste it into the field yourself.", offer: a.kind === "fill" ? a.value : null }];
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
    const o = outcome.get(f.id);
    // A typeahead where more than one suggestion fits apply-kit's value: Kris picks one of them.
    if (a?.kind === "fill" && o?.outcome === "needs-you" && o.choices?.length) {
      return [{
        fieldId: f.id, question: f.label, limit: null, control: { kind: "choice", options: o.choices }, value: "",
        basis: `More than one place fits "${a.value}" (from your ${sourceWords(a.source).toLowerCase()}). Pick yours; apply-kit doesn't choose between them.`, save: null,
      }];
    }
    if (a?.kind !== "needs-you" || o?.outcome !== "needs-you") return [];
    return [{
      fieldId: f.id, question: f.label, limit: limitWords(f), control: controlFor(f), value: a.draft ?? a.suggestion ?? "",
      basis: [a.reason, a.basis].filter(Boolean).join(". "), save: a.save ?? null,
    }];
  });
}

export interface StuckField {
  fieldId: string;
  label: string;
  /** "Phone Number didn't stick": the error names the field. */
  heading: string;
  text: string;
  /** What the value to copy is, with the field's format ("Phone Number · without +359, which is in Country Phone Code"). */
  copyLabel: string;
  /** The value ready to paste, in the format the field wants (the engine's answer for it). */
  value: string;
  /** "Try once more" is offered once per field, never in a loop. */
  tryOnceMore: boolean;
}

/**
 * The fields whose value didn't stick (hi-fi "Error · field didn't stick"), in the portal's order, each
 * with its value ready to copy. Files have their own "didn't attach" block. `retried`: the fields
 * Try once more was used on.
 */
export function stuckFields(reading: PageReading, answers: FieldAnswer[], outcomes: FieldOutcome[], retried: ReadonlySet<string>, portal: string): StuckField[] {
  const answer = new Map(answers.map((a) => [a.fieldId, a]));
  const outcome = new Map(outcomes.map((o) => [o.fieldId, o.outcome]));
  return reading.fields.flatMap((f): StuckField[] => {
    const a = answer.get(f.id);
    if (outcome.get(f.id) !== "didnt-stick" || a?.kind !== "fill") return [];
    const again = retried.has(f.id);
    return [{
      fieldId: f.id, label: f.label, heading: `${f.label} didn't stick`,
      text: `${portal} ${again ? "cleared it again after Try once more" : "cleared or changed it right after filling"}. Paste it in yourself, in the format the field wants:`,
      copyLabel: a.basis ? `${f.label} · ${a.basis.charAt(0).toLowerCase()}${a.basis.slice(1)}` : f.label,
      value: a.value, tryOnceMore: !again,
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

/** The "app not running" state after the app stopped answering mid-fill: how many fields stay filled, and that Undo still works. */
export function stoppedMidFill(outcomes: FieldOutcome[]): string {
  const n = countOutcomes(outcomes).filled;
  return n === 1
    ? "apply-kit stopped answering after filling 1 field on this page. It stays filled, and Undo this page still puts it back."
    : `apply-kit stopped answering after filling ${n} fields on this page. They stay filled, and Undo this page still puts them back.`;
}

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

/** A file's size as the panel shows it: "148 KB", "1.2 MB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const fileWord = { cv: "CV", letter: "cover letter" } as const;

export interface FileReport {
  /** The file chips: "CV attached:" "<name> · 148 KB", with the version line under it for the CV. */
  attached: { which: PackageFileKind; fieldId: string; fileName: string; label: string; line: string; meta: string | null }[];
  /** Files the portal didn't take: the warning, and the file one click away. */
  failed: { which: PackageFileKind; fieldId: string; fileName: string; size: string; chip: string; heading: string; text: string }[];
  /** Said when the package has a letter and this page had nowhere to put it. */
  letter: string | null;
}

/** What happened to the package's files on this page, in words (hi-fi "CV attached" and "CV didn't attach"). */
export function fileReport(p: PackageInBrief, answers: FieldAnswer[], outcomes: FieldOutcome[], portal: string): FileReport {
  const outcome = new Map(outcomes.map((o) => [o.fieldId, o.outcome]));
  const files = answers.filter((a): a is Extract<FieldAnswer, { kind: "file" }> => a.kind === "file");
  const approved = new Date(p.approvedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const cvNote = packageLines(p)[0]!.note;
  const report: FileReport = { attached: [], failed: [], letter: null };
  for (const a of files) {
    const o = outcome.get(a.fieldId);
    const word = fileWord[a.which];
    if (o === "filled") {
      report.attached.push({
        which: a.which, fieldId: a.fieldId, fileName: a.fileName,
        label: `${a.which === "cv" ? "CV" : "Cover letter"} attached:`, line: `${a.fileName} · ${fileSize(a.size)}`,
        meta: a.which === "cv" && cvNote ? cvNote.replace(/ · (ATS|\d)/, ` · approved ${approved} · $1`) : null,
      });
    } else if (o === "didnt-stick") {
      report.failed.push({
        which: a.which, fieldId: a.fieldId, fileName: a.fileName, size: fileSize(a.size),
        chip: `${a.which === "cv" ? "CV" : "Letter"} not attached`, heading: `Your ${word} didn't attach.`,
        text: `${portal}'s upload box didn't accept the file from apply-kit. Attach it yourself: it's ready in your Packages folder.`,
      });
    }
  }
  // The engine answers a letter text box with the letter, basis "Your package's letter…".
  const letterUsed = files.some((a) => a.which === "letter") || answers.some((a) => a.kind === "fill" && a.source === "package" && /^Your package's letter/.test(a.basis ?? ""));
  if (p.letter && !letterUsed) report.letter = "This page has no cover letter field, so your letter wasn't used.";
  return report;
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

// ---------- Workday: duplicates, where Kris is, earlier pages and the review ----------

export interface DuplicatesReport {
  section: EntrySection;
  fieldId: string;
  indexes: number[];
  question: string;
  basis: string;
  remove: string;
  keep: string;
  /** The first duplicate's heading, for Show on page. */
  show: string;
}

/** Entries Workday added when it read the CV that repeat the CV's own (hi-fi "CV attached"); null when there are none. */
export function duplicatesReport(answers: FieldAnswer[]): DuplicatesReport | null {
  const a = answers.find((x): x is Extract<FieldAnswer, { kind: "entries" }> => x.kind === "entries" && x.duplicates.length > 0);
  if (!a) return null;
  const n = a.duplicates.length;
  const [one, many] = sectionNouns[a.section];
  const quoted = a.duplicates.map((d) => `"${d.words}"`);
  const list = quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
  return {
    section: a.section, fieldId: a.fieldId, indexes: a.duplicates.map((d) => d.index),
    question: `Workday added ${n} ${n === 1 ? one : many} after reading your CV`,
    basis: `${list} ${n === 1 ? "repeats" : "repeat"} ${a.section === "work" ? "roles" : "entries"} on your CV. Nothing was removed.`,
    remove: n === 1 ? "Remove the duplicate" : `Remove the ${n} duplicates`, keep: n === 1 ? "Keep it" : "Keep them",
    show: `${sectionHeads[a.section]} ${a.duplicates[0]!.index}`,
  };
}

/** Under the step's heading: the count only when the portal prints it, and when it was filled. */
export function stepLine(reading: PageReading, portal: string, time: string): string {
  return reading.stepCount ? `Page ${reading.stepCount.current} of ${reading.stepCount.total}, as ${portal} shows it. Filled ${time}.` : `Filled ${time}.`;
}

/** A page as Kris left it, for "Earlier pages" and the review's checks. In the panel's memory only. */
export interface PageSummary {
  step: string;
  filled: number;
  /** Fields Kris chose an option for (a needs-you choice). */
  chosen: string[];
  /** The CV attached on this page, by name. */
  cv: string | null;
  duplicatesRemoved: number;
  /** Values that didn't stick: Kris pastes them. */
  didntStick: string[];
  /** Questions left blank by Kris's rule. */
  byRule: number;
}

export function pageSummary(reading: PageReading, answers: FieldAnswer[], outcomes: FieldOutcome[], extra: { chosen: string[]; duplicatesRemoved: number }): PageSummary {
  const answer = new Map(answers.map((a) => [a.fieldId, a]));
  const label = new Map(reading.fields.map((f) => [f.id, f.label]));
  const cv = answers.find((a): a is Extract<FieldAnswer, { kind: "file" }> => a.kind === "file" && a.which === "cv" && outcomes.some((o) => o.fieldId === a.fieldId && o.outcome === "filled"));
  return {
    step: reading.stepLabel ?? "This page",
    filled: outcomes.filter((o) => o.outcome === "filled").length,
    chosen: extra.chosen,
    cv: cv?.fileName ?? null,
    duplicatesRemoved: extra.duplicatesRemoved,
    didntStick: outcomes.filter((o) => o.outcome === "didnt-stick" && answer.get(o.fieldId)?.kind !== "file").map((o) => label.get(o.fieldId) ?? o.fieldId),
    byRule: outcomes.filter((o) => { const a = answer.get(o.fieldId); return o.outcome === "skipped" && a?.kind === "skip" && a.byRule; }).length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Earlier pages · 16 filled" and a line per page; null before the first page is left. */
export function earlierPages(pages: PageSummary[]): { heading: string; lines: string[] } | null {
  if (!pages.length) return null;
  const total = pages.reduce((n, p) => n + p.filled + p.chosen.length, 0);
  return {
    heading: `Earlier pages · ${total} filled`,
    lines: pages.map((p) => {
      const parts: string[] = [];
      const filled = p.filled + p.chosen.length;
      if (filled) parts.push(`${filled} filled${p.chosen.length ? ` (${p.chosen.length} you chose: ${p.chosen.join(", ")})` : ""}`);
      if (p.cv) parts.push("CV attached");
      if (p.duplicatesRemoved) parts.push(`${plural(p.duplicatesRemoved, "Workday duplicate", "Workday duplicates")} removed`);
      if (p.didntStick.length) parts.push(`${p.didntStick.length} to paste yourself`);
      if (p.byRule) parts.push(`${p.byRule} left blank by your rule`);
      return `${p.step} · ${parts.join(", ") || "nothing filled"}`;
    }),
  };
}

/** The review page's "Worth a look before you submit" (hi-fi "Review · you submit"). */
export function reviewChecks(pages: PageSummary[]): { tone: "ok" | "nb" | "dim"; text: string }[] {
  if (!pages.length) return [{ tone: "dim", text: "No pages filled in this panel yet" }];
  const checks: { tone: "ok" | "nb" | "dim"; text: string }[] = [];
  const cv = pages.find((p) => p.cv)?.cv;
  if (cv) checks.push({ tone: "ok", text: `CV attached: ${cv}` });
  const filled = pages.reduce((n, p) => n + p.filled + p.chosen.length, 0);
  checks.push({ tone: "ok", text: `${plural(filled, "field", "fields")} filled across ${plural(pages.length, "page", "pages")}` });
  const paste = pages.flatMap((p) => p.didntStick);
  if (paste.length) checks.push({ tone: "nb", text: `${plural(paste.length, "value", "values")} to paste yourself: ${paste.join(", ")}` });
  for (const p of pages) if (p.duplicatesRemoved) checks.push({ tone: "nb", text: `${plural(p.duplicatesRemoved, "Workday duplicate", "Workday duplicates")} removed on ${p.step}` });
  const blank = pages.reduce((n, p) => n + p.byRule, 0);
  if (blank) checks.push({ tone: "dim", text: `${plural(blank, "voluntary question", "voluntary questions")} left blank, by your rule` });
  return checks;
}

/** The portal's "how do you want to apply?" screen: what to choose, in words; apply-kit never clicks it. */
export function startScreen(portal: string): { heading: string; text: string } {
  return {
    heading: `Choose Apply Manually on ${portal}`,
    text: `apply-kit fills the form you get after it, page by page. Autofill with Resume makes ${portal} read your CV and add entries of its own to check. apply-kit never presses these choices.`,
  };
}
