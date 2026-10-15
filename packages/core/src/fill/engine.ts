// Apply's fill engine (spec #23, ticket #38): which approved package a portal page belongs to, the
// fill session that ties a browser tab to it, what goes in each field of the page, and the record of
// each page filled (never its values). It reads Prepare only through `PrepareForApply`
// (docs/contracts.md). The extension reads and fills the page; this decides.
import { randomUUID } from "node:crypto";
import type { PrepareForApply } from "../preparation/engine.ts";
import { sameJobReference, type ApprovedPackage, type PageJobReference } from "../preparation/contracts.ts";
import type { Clock, SqlDatabase } from "../ports.ts";
import { migrate } from "../schema.ts";
import type { Answer } from "../preparation/answers.ts";
import { contactValue } from "./contact.ts";
import { answerKindWords, fieldKindWords, kindFits, mapToField, nearMissFloor, similarity } from "./questions.ts";
import { countOutcomes, type FieldAnswer, type FieldOutcome, type PageReading, type ReadField, type RecordedPage } from "./reading.ts";

export interface FillDeps {
  db: SqlDatabase;
  clock: Clock;
  prepare: Pick<PrepareForApply, "approvedPackages" | "packageForApply" | "profileForApply" | "findAnswer" | "listAnswers" | "recordAnswerUse">;
}

/** The page Kris is on, as the extension recognised it from the tab's address. */
export interface FillPage {
  portal: PageJobReference["portal"];
  host: string;
  jobRef: PageJobReference | null;
}

export type SessionEnd = "different-job" | "submitted" | "tab-closed" | "abandoned";

export interface FillSession {
  id: string;
  packageId: string;
  portal: string;
  host: string;
  jobRef: PageJobReference | null;
  startedAt: string;
  endedAt: string | null;
  endReason: SessionEnd | null;
}

/** An approved package as the panel summarises it before filling. */
export interface PackageInBrief {
  id: string;
  version: number;
  approvedAt: string;
  job: { title: string; company: string };
  jobRef: PageJobReference | null;
  language: "en" | "bg";
  cv: { fileName: string; label: string; angle: ApprovedPackage["angle"]; ats: ApprovedPackage["cv"]["ats"] };
  /** How many approved screening answers it carries. */
  answers: number;
  /** Whether it has an approved letter. */
  letter: boolean;
}

export type FillMatch =
  /** `why`: the page's job ID is the target posting's, the page is another posting of the package's Job, or Kris chose it. */
  | { kind: "matched"; why: "job-id" | "same-job" | "chosen"; continued: boolean; package: PackageInBrief; session: FillSession | null }
  /** Approved packages on the same board, none for this job ID: Kris picks one (or none). */
  | { kind: "choose"; candidates: PackageInBrief[] }
  /** No approved package for this page; `job` when the Job has a package that isn't approved yet. */
  | { kind: "no-package"; job: { id: string; packageId: string; packageState: "draft"; reason: string } | null };

export type FillStart =
  | FillMatch
  /** The tab moved to another job: the old session ended (on start) and the page was matched again. */
  | { kind: "different-job"; previous: { packageId: string; job: { title: string; company: string } | null; jobRef: PageJobReference | null }; then: FillMatch };

export interface FillOptions {
  /** The tab's session, if it has one. */
  sessionId?: string | null;
  /** The package Kris chose from "choose". */
  packageId?: string;
}

export interface FillEngine {
  /** Which package fits the page, without opening or ending anything (what the panel shows before Fill). */
  matchPage(page: FillPage, options?: FillOptions): Promise<FillStart>;
  /** Every Fill starts here: re-reads the job, keeps the tab's session for the same job, ends it for a different one, and opens one on a match. */
  startFill(page: FillPage, options?: FillOptions): Promise<FillStart>;
  /** The answer for each field of the page, in its order. Throws once the session has ended. */
  answer(sessionId: string, reading: PageReading): FieldAnswer[];
  /** Records what the fill did on a page: counts and per-field outcome and source, no values. */
  recordPage(sessionId: string, reading: PageReading, outcomes: FieldOutcome[]): RecordedPage;
  /** The pages recorded in a session, oldest first. */
  pages(sessionId: string): RecordedPage[];
  session(sessionId: string): FillSession | null;
  endSession(sessionId: string, reason: SessionEnd): FillSession | null;
}

export class FillError extends Error {
  constructor(readonly problem: "no-session" | "session-ended", message: string) {
    super(message);
  }
}

export function createFillEngine({ db, clock, prepare }: FillDeps): FillEngine {
  migrate(db);

  const toSession = (r: Record<string, unknown>): FillSession => ({
    id: String(r.id), packageId: String(r.package_id), portal: String(r.portal), host: String(r.host),
    jobRef: r.job_ref == null ? null : (JSON.parse(String(r.job_ref)) as PageJobReference),
    startedAt: String(r.started_at), endedAt: r.ended_at == null ? null : String(r.ended_at), endReason: (r.end_reason ?? null) as SessionEnd | null,
  });
  const session = (id: string) => {
    const r = db.prepare("SELECT * FROM fill_session WHERE id = ?").get(id);
    return r ? toSession(r) : null;
  };
  const openSession = (id: string) => {
    const s = session(id);
    if (!s) throw new FillError("no-session", "This tab's fill session isn't known. Click Fill this page to start again.");
    if (s.endedAt) throw new FillError("session-ended", "This tab's fill session has ended. Click Fill this page to match the page again.");
    return s;
  };
  const endSession = (id: string, reason: SessionEnd) => {
    db.prepare("UPDATE fill_session SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL").run(clock.now().toISOString(), reason, id);
    return session(id);
  };
  const start = (pkg: ApprovedPackage, page: FillPage): FillSession => {
    const id = randomUUID();
    const jobRef = page.jobRef ?? pkg.targetPosting.jobRef;
    db.prepare("INSERT INTO fill_session (id, package_id, portal, host, job_ref, started_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, pkg.id, page.portal, page.host, jobRef ? JSON.stringify(jobRef) : null, clock.now().toISOString());
    return session(id)!;
  };
  const pages = (sessionId: string): RecordedPage[] =>
    db.prepare("SELECT * FROM fill_page WHERE session_id = ? ORDER BY id").all(sessionId).map((r) => ({
      stepLabel: r.step_label == null ? null : String(r.step_label), pageKind: r.page_kind as RecordedPage["pageKind"], filledAt: String(r.filled_at),
      counts: JSON.parse(String(r.counts)) as RecordedPage["counts"], fields: JSON.parse(String(r.fields)) as RecordedPage["fields"],
    }));

  const bankEntries = (): Answer[] => prepare.listAnswers({ pageSize: 10_000 }).answers;

  /** The answer bank's answer for a field, or null when nothing in the bank matches well enough. */
  function fromBank(f: ReadField, language: "en" | "bg"): { answer: FieldAnswer; answerId: string } | null {
    const m = prepare.findAnswer(f.label, language);
    if (!m) return null;
    const fieldId = f.id;
    const entry = bankEntries().find((a) => a.id === m.answerId);
    const basis = m.confidence < 1 ? `Close wording of "${m.question}" in your answer bank` : null;
    const value = m.fill.action === "fill" ? m.fill.value : null;
    if (m.confidence < 1 && entry && !kindFits(entry.kind, f.kind)) {
      const answer: FieldAnswer = { fieldId, kind: "needs-you", reason: `The closest answer is ${answerKindWords(entry.kind)} answer, and this field asks for ${fieldKindWords(f.kind)}`, basis };
      return { answerId: m.answerId, answer: value ? { ...answer, suggestion: value } : answer };
    }
    if (value === null) return null;
    const mapped = mapToField(value, f);
    return {
      answerId: m.answerId,
      answer: mapped.ok ? { fieldId, kind: "fill", value: mapped.value, source: "answer-bank", basis } : { fieldId, kind: "needs-you", reason: mapped.reason, basis, suggestion: value },
    };
  }

  /** "The closest answer bank entry (…) is a different question", for a question nothing matched. */
  function nearMiss(f: ReadField): string | null {
    let best: { question: string; score: number } | null = null;
    for (const a of bankEntries()) {
      for (const phrase of [a.question, ...a.wordings.map((w) => w.text)]) {
        const score = similarity(f.label, phrase);
        if (score >= nearMissFloor && (!best || score > best.score)) best = { question: a.question, score };
      }
    }
    return best ? `The closest answer bank entry ("${best.question}") is a different question, so it wasn't used` : null;
  }

  const approvedById = (id: string) => {
    const r = prepare.packageForApply({ packageId: id });
    return r.kind === "approved" ? r.package : null;
  };

  /** A fresh match for the page, opening a session on a match when `commit`. */
  function match(page: FillPage, packageId: string | undefined, commit: boolean): FillMatch {
    const matched = (pkg: ApprovedPackage, why: "job-id" | "same-job" | "chosen"): FillMatch =>
      ({ kind: "matched", why, continued: false, package: brief(pkg), session: commit ? start(pkg, page) : null });
    if (packageId) {
      const r = prepare.packageForApply({ packageId });
      if (r.kind === "approved") return matched(r.package, "chosen");
      return { kind: "no-package", job: r.kind === "not-approved" ? { id: r.jobId, packageId: r.packageId, packageState: "draft", reason: r.reason } : null };
    }
    if (!page.jobRef) return { kind: "no-package", job: null };
    const approved = prepare.approvedPackages();
    const exact = approved.filter((p) => sameJobReference(p.targetPosting.jobRef, page.jobRef));
    if (exact.length === 1) return matched(exact[0]!, "job-id");
    if (exact.length > 1) return { kind: "choose", candidates: exact.map(brief) };
    const forJob = prepare.packageForApply({ jobRef: page.jobRef });
    if (forJob.kind === "approved") return matched(forJob.package, "same-job");
    if (forJob.kind === "not-approved") return { kind: "no-package", job: { id: forJob.jobId, packageId: forJob.packageId, packageState: "draft", reason: forJob.reason } };
    const board = page.jobRef.board?.toLowerCase();
    const sameBoard = board ? approved.filter((p) => p.targetPosting.jobRef?.portal === page.portal && p.targetPosting.jobRef.board.toLowerCase() === board) : [];
    if (sameBoard.length > 0) return { kind: "choose", candidates: sameBoard.map(brief) };
    return { kind: "no-package", job: null };
  }

  async function begin(page: FillPage, { sessionId, packageId }: FillOptions, commit: boolean): Promise<FillStart> {
    const current = sessionId ? session(sessionId) : null;
    if (current && !current.endedAt && !packageId) {
      // A page without a job reference (a sign-in page) continues the session only on the same host.
      const same = page.jobRef ? sameJobReference(current.jobRef, page.jobRef) : current.host === page.host;
      const pkg = same ? approvedById(current.packageId) : null;
      if (same && pkg) return { kind: "matched", why: "job-id", continued: true, package: brief(pkg), session: current };
      if (page.jobRef && !same) {
        if (commit) endSession(current.id, "different-job");
        const old = prepare.packageForApply({ packageId: current.packageId });
        return {
          kind: "different-job",
          previous: { packageId: current.packageId, job: old.kind === "approved" ? old.package.job : null, jobRef: current.jobRef },
          then: match(page, undefined, commit),
        };
      }
    }
    return match(page, packageId, commit);
  }

  return {
    matchPage: (page, options = {}) => begin(page, options, false),
    startFill: (page, options = {}) => begin(page, options, true),

    answer(sessionId, reading) {
      const s = openSession(sessionId);
      const profile = prepare.profileForApply();
      const pkg = approvedById(s.packageId);
      return reading.fields.map((f): FieldAnswer => {
        const fieldId = f.id;
        if (f.password) return { fieldId, kind: "skip", reason: "Passwords are yours: Chrome's password manager fills them" };
        if (f.consent) return { fieldId, kind: "skip", reason: "Consent boxes are yours to tick" };
        if (f.kind === "file") {
          const letter = /cover|letter|мотивац/i.test(f.label);
          const file = letter ? pkg?.letter?.file : pkg?.cv.file;
          return { fieldId, kind: "needs-you", reason: `Attach the ${letter ? "letter" : "CV"} yourself for now`, basis: file ? `Your package's ${letter ? "letter" : "CV"}: ${file.fileName}` : null };
        }
        const contact = contactValue(f, profile);
        if (contact?.value) {
          if (f.options.length === 0) return { fieldId, kind: "fill", value: contact.value, source: "profile", basis: contact.basis };
          const option = f.options.find((o) => o.trim().toLowerCase() === contact.value!.toLowerCase());
          if (option) return { fieldId, kind: "fill", value: option, source: "profile", basis: contact.basis };
          return { fieldId, kind: "needs-you", reason: "None of the options matches your profile", basis: contact.basis, suggestion: contact.value };
        }
        if (contact) return f.required ? { fieldId, kind: "needs-you", reason: contact.missing, basis: null } : { fieldId, kind: "skip", reason: contact.missing };
        const banked = fromBank(f, pkg?.language ?? "en");
        if (banked) return banked.answer;
        return f.required
          ? { fieldId, kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: nearMiss(f) }
          : { fieldId, kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" };
      });
    },

    recordPage(sessionId, reading, outcomes) {
      const s = openSession(sessionId);
      const byId = new Map(outcomes.map((o) => [o.fieldId, o]));
      // Each answer-bank entry filled in this session counts as one use, however often the page is filled.
      const language = approvedById(s.packageId)?.language ?? "en";
      const usedBefore = new Set(pages(sessionId).flatMap((p) => p.fields.filter((f) => f.outcome === "filled" && f.source === "answer-bank").map((f) => f.label)));
      for (const f of reading.fields) {
        const o = byId.get(f.id);
        if (o?.outcome !== "filled" || o.source !== "answer-bank" || usedBefore.has(f.label)) continue;
        const id = fromBank(f, language)?.answerId;
        if (id) prepare.recordAnswerUse(id);
      }
      const fields = reading.fields.flatMap((f) => {
        const o = byId.get(f.id);
        return o ? [{ label: f.label, kind: f.kind, outcome: o.outcome, source: o.source }] : [];
      });
      const page: RecordedPage = { stepLabel: reading.stepLabel, pageKind: reading.pageKind, filledAt: clock.now().toISOString(), counts: countOutcomes(fields), fields };
      db.prepare("INSERT INTO fill_page (session_id, step_label, page_kind, filled_at, counts, fields) VALUES (?, ?, ?, ?, ?, ?)")
        .run(sessionId, page.stepLabel, page.pageKind, page.filledAt, JSON.stringify(page.counts), JSON.stringify(page.fields));
      return page;
    },

    pages,

    session,
    endSession,
  };
}

function brief(p: ApprovedPackage): PackageInBrief {
  return {
    id: p.id, version: p.version, approvedAt: p.approvedAt, job: p.job, jobRef: p.targetPosting.jobRef, language: p.language,
    cv: { fileName: p.cv.file.fileName, label: p.cv.label, angle: p.angle, ats: p.cv.ats },
    answers: p.answers.length, letter: p.letter !== null,
  };
}
