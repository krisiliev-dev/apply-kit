// Apply's fill engine (spec #23, ticket #38): which approved package a portal page belongs to, the
// fill session that ties a browser tab to it, what goes in each field of the page, and the record of
// each page filled (never its values). It reads Prepare only through `PrepareForApply`
// (docs/contracts.md). The extension reads and fills the page; this decides.
import { randomUUID } from "node:crypto";
import type { PrepareForApply } from "../preparation/engine.ts";
import { sameJobReference, type ApprovedPackage, type PageJobReference, type SubmittedVia } from "../preparation/contracts.ts";
import { TrackerError, type ApplicationSummary, type Submission, type Tracker } from "../tracker.ts";
import type { Clock, SqlDatabase } from "../ports.ts";
import type { PackageFolder } from "../preparation/ports.ts";
import { migrate } from "../schema.ts";
import { minMatchConfidence, type Answer } from "../preparation/answers.ts";
import { isSalaryQuestion } from "../preparation/screening.ts";
import { contactValue } from "./contact.ts";
import { answerKindWords, diversityTopic, fieldKindWords, kindFits, kindOfText, mapToField, nearMissFloor, similarity } from "./questions.ts";
import { countOutcomes, type FieldAnswer, type FieldOutcome, type FieldReport, type FieldReportInput, type PackageFileKind, type PageReading, type ReadField, type RecordedPage } from "./reading.ts";
import { fieldStructure, whereReported } from "./field-report.ts";

export interface FillDeps {
  db: SqlDatabase;
  clock: Clock;
  prepare: Pick<PrepareForApply,
    "approvedPackages" | "packageForApply" | "profileForApply" | "packageFile" | "findAnswer" | "listAnswers" | "recordAnswerUse" | "markPackageSubmitted" | "undoPackageSubmitted">;
  /** Track: "Mark as submitted" creates the Application through its record submission. */
  track: Pick<Tracker, "recordSubmission" | "undoSubmission">;
  /**
   * The packages folder, to copy an approved file to Kris's Packages folder on first use when approval
   * couldn't ("Show in Finder" needs it there). Freezing the same bytes again only finds the file and its copy.
   */
  packages?: Pick<PackageFolder, "freeze">;
}

/** A package file to attach: its bytes, the name the portal gets, and its copy in the Packages folder (null if it couldn't be written). */
export interface PackageFileForFill {
  which: PackageFileKind;
  fileName: string;
  size: number;
  path: string | null;
  bytes: Uint8Array;
}

/** The page Kris is on, as the extension recognised it from the tab's address ("unknown": a form apply-kit doesn't know, #47). */
export interface FillPage {
  portal: PageJobReference["portal"] | "unknown";
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
  cv: { fileName: string; size: number; label: string; angle: ApprovedPackage["angle"]; ats: ApprovedPackage["cv"]["ats"] };
  /** How many approved screening answers it carries. */
  answers: number;
  /** Whether it has an approved letter. */
  letter: boolean;
}

export type FillMatch =
  /**
   * `why`: the page's job ID is the target posting's, the page is another posting of the package's Job,
   * the package's target posting is on this site (a form apply-kit doesn't know), or Kris chose it.
   */
  | { kind: "matched"; why: "job-id" | "same-job" | "target-host" | "chosen"; continued: boolean; package: PackageInBrief; session: FillSession | null }
  /**
   * Approved packages on the same board, none for this job ID; or, on a form apply-kit doesn't know with
   * no package targeting its site, every approved package not yet submitted, newest first: Kris picks one (or none).
   */
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

/** The Application "Mark as submitted" made (or found), as the panel and the Job page show it. */
export type SubmittedApplication = ApplicationSummary & { submission: Submission };

export type MarkResult =
  /** `alreadyMarked`: the package had its Application already; this is it ("Already marked as submitted on …"). */
  | { marked: true; alreadyMarked: boolean; application: SubmittedApplication; package: PackageInBrief }
  /** Nothing was created: why, and the Application to open instead when the Job already has one. */
  | { marked: false; reason: string; application: ApplicationSummary | null };

export interface FillEngine {
  /** Which package fits the page, without opening or ending anything (what the panel shows before Fill). */
  matchPage(page: FillPage, options?: FillOptions): Promise<FillStart>;
  /** Every Fill starts here: re-reads the job, keeps the tab's session for the same job, ends it for a different one, and opens one on a match. */
  startFill(page: FillPage, options?: FillOptions): Promise<FillStart>;
  /** The answer for each field of the page, in its order. Throws once the session has ended. */
  answer(sessionId: string, reading: PageReading): FieldAnswer[];
  /** The session's package's CV or letter, exactly as approved; null when the package has no such file. Throws once the session has ended. */
  packageFile(sessionId: string, which: PackageFileKind): Promise<PackageFileForFill | null>;
  /** Records what the fill did on a page: counts and per-field outcome and source, no values. */
  recordPage(sessionId: string, reading: PageReading, outcomes: FieldOutcome[]): RecordedPage;
  /** The pages recorded in a session, oldest first. */
  pages(sessionId: string): RecordedPage[];
  session(sessionId: string): FillSession | null;
  endSession(sessionId: string, reason: SessionEnd): FillSession | null;
  /**
   * Mark as submitted, for the tab's session (the panel) or a package (the Job page): Track creates
   * the Application in Applied with the package, portal, address, time and how; the package becomes
   * "submitted"; the session ends. Once per package: marking again returns the first, `alreadyMarked`.
   */
  markSubmitted(target: { sessionId: string } | { packageId: string }, how: { portalUrl: string | null; via: SubmittedVia }): Promise<MarkResult>;
  /** Undo after marking: the Application goes and the package is approved again. Refused (FillError) once the Application has a later Event. */
  undoMarkSubmitted(applicationId: string): Promise<{ packageId: string }>;
  /** "Report this field": keeps the field's structure, the portal, host and path (never the query) and step label. Never a value. */
  reportField(report: FieldReportInput): FieldReport;
  /** The saved field reports, newest first. */
  fieldReports(): FieldReport[];
  /** Deletes one; false if there's no such report. */
  deleteFieldReport(id: string): boolean;
}

export class FillError extends Error {
  constructor(readonly problem: "no-session" | "session-ended" | "not-found" | "not-undoable" | "bad-report", message: string) {
    super(message);
  }
}

export function createFillEngine({ db, clock, prepare, track, packages }: FillDeps): FillEngine {
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
    let m = prepare.findAnswer(f.label, language);
    // A diversity question the bank doesn't word ("Are you Hispanic/Latino?") follows the rule for its topic, if that rule leaves it blank.
    if (!m) {
      const topic = diversityTopic(f.label);
      const byTopic = topic ? prepare.findAnswer(topic, language) : null;
      if (byTopic?.fill.action === "leave-blank") m = { ...byTopic, confidence: 1 };
    }
    if (!m) return null;
    const fieldId = f.id;
    if (m.fill.action === "ask") {
      const rule = m.fill.rule;
      const floor = rule?.params?.kind === "salary" ? rule.params.floor : null;
      const basis = rule ? `Your rule: "${rule.text}".${floor != null ? " The posting's range isn't known here, so this is your floor." : ""}` : null;
      const answer: FieldAnswer = { fieldId, kind: "needs-you", reason: "Your answer bank says: ask each time", basis };
      return { answerId: m.answerId, answer: floor != null ? { ...answer, suggestion: String(floor) } : answer };
    }
    if (m.fill.action === "leave-blank") {
      const ruleWords = "Your rule leaves voluntary questions blank";
      if (!f.required) return { answerId: m.answerId, answer: { fieldId, kind: "skip", reason: ruleWords, byRule: true } };
      const instead = m.fill.whenRequired;
      const mapped = instead ? mapToField(instead, f, clock.now()) : null;
      return {
        answerId: m.answerId,
        answer: mapped?.ok
          ? { fieldId, kind: "fill", value: mapped.value, source: "answer-bank", basis: `This portal requires an answer, so your rule's "${instead}"` }
          : { fieldId, kind: "needs-you", reason: `This portal requires an answer, and none of its options is "${instead ?? "Prefer not to say"}"`, basis: ruleWords },
      };
    }
    const entry = bankEntries().find((a) => a.id === m.answerId);
    const basis = m.confidence < 1 ? `Close wording of "${m.question}" in your answer bank` : null;
    const value = m.fill.action === "fill" ? m.fill.value : null;
    if (m.confidence < 1 && entry && !kindFits(entry.kind, f.kind)) {
      const answer: FieldAnswer = { fieldId, kind: "needs-you", reason: `The closest answer is ${answerKindWords(entry.kind)} answer, and this field asks for ${fieldKindWords(f.kind)}`, basis };
      return { answerId: m.answerId, answer: value ? { ...answer, suggestion: value } : answer };
    }
    if (m.fill.action === "no-version") {
      const names = m.fill.languages.map((l) => (l === "bg" ? "Bulgarian" : "English")).join(" and ");
      return { answerId: m.answerId, answer: { fieldId, kind: "needs-you", reason: `Your answer bank has this only in ${names}`, basis: `"${m.question}" in your answer bank` } };
    }
    if (value === null) return null;
    const mapped = mapToField(value, f, clock.now());
    return {
      answerId: m.answerId,
      answer: mapped.ok
        ? { fieldId, kind: "fill", value: mapped.value, source: "answer-bank", basis: mapped.basis ?? basis }
        : { fieldId, kind: "needs-you", reason: mapped.reason, basis, suggestion: value },
    };
  }

  /** The package's approved screening answer for a field's question, ahead of the answer bank; null when the package has none for it. */
  function fromPackage(f: ReadField, pkg: ApprovedPackage | null): FieldAnswer | null {
    let best: { question: string; answer: string; score: number } | null = null;
    for (const a of pkg?.answers ?? []) {
      const score = similarity(f.label, a.question);
      if (score >= minMatchConfidence && (!best || score > best.score) && (score === 1 || kindFits(kindOfText(a.answer), f.kind))) best = { ...a, score };
    }
    if (!best) return null;
    const fieldId = f.id;
    if (isSalaryQuestion(f.label) || isSalaryQuestion(best.question)) {
      return { fieldId, kind: "needs-you", reason: "Your answer bank says: ask each time", basis: `You chose ${best.answer} for this job when you approved the package.`, suggestion: best.answer };
    }
    const basis = "Approved screening answer in this package";
    const mapped = mapToField(best.answer, f, clock.now());
    return mapped.ok
      ? { fieldId, kind: "fill", value: mapped.value, source: "package", basis }
      : { fieldId, kind: "needs-you", reason: mapped.reason, basis, suggestion: best.answer };
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
    const matched = (pkg: ApprovedPackage, why: Extract<FillMatch, { kind: "matched" }>["why"]): FillMatch =>
      ({ kind: "matched", why, continued: false, package: brief(pkg), session: commit ? start(pkg, page) : null });
    if (packageId) {
      const r = prepare.packageForApply({ packageId });
      if (r.kind === "approved") return matched(r.package, "chosen");
      return { kind: "no-package", job: r.kind === "not-approved" ? { id: r.jobId, packageId: r.packageId, packageState: "draft", reason: r.reason } : null };
    }
    if (page.portal === "unknown") return matchUnknown(page, matched);
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

  /** A form apply-kit doesn't know: the package whose target posting is on this site, else Kris picks from those not yet submitted. */
  function matchUnknown(page: FillPage, matched: (pkg: ApprovedPackage, why: "target-host") => FillMatch): FillMatch {
    const open = prepare.approvedPackages().filter((p) => p.state === "approved");
    const host = bareHost(page.host);
    const here = open.filter((p) => bareHost(hostOf(p.targetPosting.url)) === host);
    if (here.length === 1) return matched(here[0]!, "target-host");
    const candidates = here.length > 1 ? here : open;
    return candidates.length > 0 ? { kind: "choose", candidates: candidates.map(brief) } : { kind: "no-package", job: null };
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
      // One letter per page: as a file where the page takes one, its text only where there's no file field for it.
      const letterAsFile = !!pkg?.letter && reading.fields.some((f) => f.kind === "file" && letterLabel.test(f.label));
      return reading.fields.map((f): FieldAnswer => {
        const fieldId = f.id;
        if (f.password) return { fieldId, kind: "skip", reason: "Passwords are yours: Chrome's password manager fills them" };
        if (f.consent) return { fieldId, kind: "skip", reason: "Consent boxes are yours to tick" };
        if (f.kind === "file") return fileAnswer(f, pkg);
        if (letterLabel.test(f.label) && (f.kind === "textarea" || f.kind === "text")) {
          if (letterAsFile) return { fieldId, kind: "skip", reason: "Your letter is attached as a file" };
          if (pkg?.letter) return { fieldId, kind: "fill", value: pkg.letter.text, source: "package", basis: `Your package's letter, v${pkg.version}` };
        }
        const contact = contactValue(f, profile, reading.fields);
        if (contact?.value) {
          if (f.options.length === 0) return { fieldId, kind: "fill", value: contact.value, source: "profile", basis: contact.basis };
          const option = f.options.find((o) => o.trim().toLowerCase() === contact.value!.toLowerCase());
          if (option) return { fieldId, kind: "fill", value: option, source: "profile", basis: contact.basis };
          return { fieldId, kind: "needs-you", reason: "None of the options matches your profile", basis: contact.basis, suggestion: contact.value };
        }
        if (contact) return f.required ? { fieldId, kind: "needs-you", reason: contact.missing, basis: null } : { fieldId, kind: "skip", reason: contact.missing };
        const packaged = fromPackage(f, pkg);
        if (packaged) return packaged;
        const banked = fromBank(f, pkg?.language ?? "en");
        if (banked) return banked.answer;
        if (isSalaryQuestion(f.label)) return { fieldId, kind: "needs-you", reason: "Salary is yours to decide for each job", basis: null };
        return f.required
          ? { fieldId, kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: nearMiss(f) }
          : { fieldId, kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" };
      });
    },

    async packageFile(sessionId, which) {
      const s = openSession(sessionId);
      const pkg = approvedById(s.packageId);
      const file = pkg ? await prepare.packageFile(pkg.id, which, pkg.version) : null;
      if (!pkg || !file) return null;
      let path = file.copy;
      if (!path && packages) path = await packages.freeze(pkg.id, pkg.version, file.fileName, file.bytes).then((r) => r.copy, () => null);
      return { which, fileName: file.fileName, size: file.size, path, bytes: file.bytes };
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

    async markSubmitted(target, { portalUrl, via }) {
      const s = "sessionId" in target ? session(target.sessionId) : null;
      if ("sessionId" in target && !s) throw new FillError("no-session", "This tab's fill session isn't known. Click Fill this page to start again.");
      const packageId = s ? s.packageId : (target as { packageId: string }).packageId;
      const found = prepare.packageForApply({ packageId });
      if (found.kind !== "approved") {
        return { marked: false, reason: found.kind === "not-approved" ? found.reason : "There's no such package.", application: null };
      }
      const pkg = found.package;
      const submittedAt = clock.now().toISOString();
      const recorded = await track.recordSubmission({
        jobId: pkg.jobId, job: pkg.job, angle: pkg.angle, packageId: pkg.id,
        portal: s?.portal ?? pkg.targetPosting.jobRef?.portal ?? null, portalUrl, submittedAt, via,
      });
      if (recorded.outcome === "already-open") return { marked: false, reason: recorded.message, application: recorded.application };
      const marked = recorded.alreadyRecorded ? null : prepare.markPackageSubmitted(pkg.id, { via, portalUrl, at: submittedAt });
      if (s && !s.endedAt) endSession(s.id, "submitted");
      const now = marked?.marked ? marked.package : pkg;
      return { marked: true, alreadyMarked: recorded.alreadyRecorded, application: recorded.application, package: brief(now) };
    },

    reportField({ portal, address, stepLabel, field }) {
      const where = whereReported(address);
      const structure = fieldStructure(field);
      if (!where || !structure) throw new FillError("bad-report", "Send the page's address and the field's structure.");
      const report: FieldReport = {
        id: randomUUID(), portal: String(portal).slice(0, 40), ...where,
        stepLabel: typeof stepLabel === "string" && stepLabel.trim() ? stepLabel.trim().slice(0, 200) : null,
        field: structure, createdAt: clock.now().toISOString(),
      };
      db.prepare("INSERT INTO field_report (id, portal, host, path, step_label, field, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(report.id, report.portal, report.host, report.path, report.stepLabel, JSON.stringify(report.field), report.createdAt);
      return report;
    },

    fieldReports() {
      return db.prepare("SELECT * FROM field_report ORDER BY created_at DESC, rowid DESC").all().map((r) => ({
        id: String(r.id), portal: String(r.portal), host: String(r.host), path: String(r.path),
        stepLabel: r.step_label == null ? null : String(r.step_label), field: JSON.parse(String(r.field)) as FieldReport["field"], createdAt: String(r.created_at),
      }));
    },

    deleteFieldReport(id) {
      const result = db.prepare("DELETE FROM field_report WHERE id = ?").run(id) as { changes?: number | bigint } | undefined;
      return Number(result?.changes ?? 0) > 0;
    },

    async undoMarkSubmitted(applicationId) {
      try {
        const { packageId } = await track.undoSubmission(applicationId);
        prepare.undoPackageSubmitted(packageId);
        return { packageId };
      } catch (err) {
        if (err instanceof TrackerError) throw new FillError(err.problem === "not-found" ? "not-found" : "not-undoable", err.message);
        throw err;
      }
    },
  };
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const letterLabel = /\bcover(ing)? ?letter\b|\bmotivation(al)? letter\b|мотивационно писмо/iu;
const cvLabel = /\b(resume|résumé|cv|curriculum)\b|автобиография/iu;

/** A file field: the package's CV or letter, or Kris's when the package has no such file. */
function fileAnswer(f: ReadField, pkg: ApprovedPackage | null): FieldAnswer {
  const fieldId = f.id;
  const which = letterLabel.test(f.label) ? "letter" : cvLabel.test(f.label) ? "cv" : null;
  const file = which === "letter" ? pkg?.letter?.file : which === "cv" ? pkg?.cv.file : null;
  if (which && file && pkg) {
    return { fieldId, kind: "file", which, fileName: file.fileName, size: file.size, source: "package", basis: `Your package's ${which === "cv" ? "CV" : "letter"}${pkg.language === "bg" ? " in Bulgarian" : ""}, v${pkg.version}` };
  }
  const reason = which === "letter" ? "Your package has no letter" : "apply-kit has no file for this";
  return f.required ? { fieldId, kind: "needs-you", reason, basis: null } : { fieldId, kind: "skip", reason };
}

function brief(p: ApprovedPackage): PackageInBrief {
  return {
    id: p.id, version: p.version, approvedAt: p.approvedAt, job: p.job, jobRef: p.targetPosting.jobRef, language: p.language,
    cv: { fileName: p.cv.file.fileName, size: p.cv.file.size, label: p.cv.label, angle: p.angle, ats: p.cv.ats },
    answers: p.answers.length, letter: p.letter !== null,
  };
}
