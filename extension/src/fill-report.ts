// What the Fill view says, as pure functions (like report.ts for Capture): why the page matched a
// package, the package in words, the field rows in the portal's order with their source in words,
// the end-of-fill announcement, and where focus goes after a fill.
import type { FieldAnswer, FieldOutcome, FillSource, FillStart, OutcomeCounts, PackageFileKind, PackageInBrief, PageJobReference, PageKind, PageReading, SubmittedApplication } from "@apply-kit/core";

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
    if (a.kind === "file") {
      if (o.outcome === "filled") return [{ ...row, value: a.fileName, chip: { tone: "met", word: sourceWords("package") }, why: a.basis }];
      if (o.outcome === "didnt-stick") return [{ ...row, value: "Not attached", chip: { tone: "gap", word: "Didn't attach" }, why: "Attach it yourself from your Packages folder." }];
      if (o.outcome === "kept") return [{ ...row, value: "Another file", chip: { tone: "partly", word: "Kept" }, why: "The field already had a file, so apply-kit left it." }];
    }
    switch (o.outcome) {
      case "filled":
        return [{ ...row, value: a.kind === "fill" ? a.value : f.value, chip: { tone: "met", word: sourceWords(o.source ?? "profile") }, why: a.kind === "fill" ? a.basis : null }];
      case "kept":
        return [{ ...row, value: f.value, chip: { tone: "partly", word: "Kept" }, why: "The field already had this value, so apply-kit left it.", offer: a.kind === "fill" ? a.value : null }];
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
          limit: f.maxLength !== null && (f.kind === "textarea" || f.kind === "text") ? `max ${f.maxLength.toLocaleString("en-GB")} characters` : null,
        }];
      case "didnt-stick":
        return [{ ...row, value: "Empty: the value didn't stay", chip: { tone: "gap", word: "Didn't stick" }, why: "Paste it into the field yourself.", offer: a.kind === "fill" ? a.value : null }];
      case "skipped":
        return [{ ...row, value: "Not filled", chip: { tone: "closed", word: a.kind === "skip" && a.byRule ? "Skipped · your rule" : "Skipped" }, why: a.kind === "skip" ? a.reason : null }];
    }
  });
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
