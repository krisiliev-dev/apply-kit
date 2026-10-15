// What the Fill view says, as pure functions (like report.ts for Capture): why the page matched a
// package, the package in words, the field rows in the portal's order with their source in words,
// the end-of-fill announcement, and where focus goes after a fill.
import type { FieldAnswer, FieldOutcome, FillSource, FillStart, OutcomeCounts, PackageInBrief, PageJobReference, PageReading } from "@apply-kit/core";

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
    const row = { fieldId: f.id, label: f.label, outcome: o.outcome, offer: null };
    switch (o.outcome) {
      case "filled":
        return [{ ...row, value: a.kind === "fill" ? a.value : f.value, chip: { tone: "met", word: sourceWords(o.source ?? "profile") }, why: a.kind === "fill" ? a.basis : null }];
      case "kept":
        return [{ ...row, value: f.value, chip: { tone: "partly", word: "Kept" }, why: "The field already had this value, so apply-kit left it.", offer: a.kind === "fill" ? a.value : null }];
      case "needs-you":
        return [{ ...row, value: a.kind === "needs-you" && a.suggestion ? `Suggested: ${a.suggestion}` : "Not filled", chip: { tone: "ask", word: "Needs you" }, why: a.kind === "needs-you" ? [a.reason, a.basis].filter(Boolean).join(". ") : null }];
      case "didnt-stick":
        return [{ ...row, value: "Empty: the value didn't stay", chip: { tone: "gap", word: "Didn't stick" }, why: "Paste it into the field yourself.", offer: a.kind === "fill" ? a.value : null }];
      case "skipped":
        return [{ ...row, value: "Not filled", chip: { tone: "closed", word: "Skipped" }, why: a.kind === "skip" ? a.reason : null }];
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
export function packageLines(p: PackageInBrief): { term: string; detail: string; note: string | null }[] {
  const ats = p.cv.ats.passed === p.cv.ats.total
    ? p.cv.ats.accepted.length ? `ATS check passed, ${p.cv.ats.accepted.length} accepted knowingly` : "ATS check passed"
    : `${p.cv.ats.passed} of ${p.cv.ats.total} ATS checks pass`;
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
