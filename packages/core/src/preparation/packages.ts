// Packages (ticket #62): one per Job, with five steps approved in order (target posting, CV
// version, cover letter, screening answers, ATS check) and the parts generated for them. Starting a
// package picks the closest angle, the recommended target posting and the posting's language, then
// generates the parts in the background within the monthly AI budget: a part that would cross the
// cap isn't started, a failed part is retried once and then waits for Retry, and stopping keeps
// what's finished. Stored in SQLite (ADR 0003); the CV's draft PDF is in the packages folder.
// The CV version (#63) is the master profile's CV with the tailoring's changes, each checked by the
// honesty validator and undoable, printed again on every change (cv-version.ts).
// Flags (#64): a stronger line, a required item with no evidence and a line drafted from Kris's
// answer to a gap question each wait for Kris's decision, and the CV step can't be approved while
// one is open. A gap answer becomes an unconfirmed piece used only in this package until Kris
// confirms it in Profile (Profile › Learned during packages).
import { angleLabel, type Angle } from "../fit/angles.ts";
import { evidenceLabel, matchEvidence, type RequirementCategory } from "../fit/evidence.ts";
import type { AiBudget, BudgetInfo } from "../budget.ts";
import type { Clock, SqlDatabase } from "../ports.ts";
import type { CvContent, DocumentDate, DocumentLanguage, DocumentToRender } from "../documents/content.ts";
import type { AtsCheck } from "../documents/ats.ts";
import type { CoachTurnInput, TailorCvInput, TailoredCv, Writer } from "../writing/writer.ts";
import type { AngleChoice, AnglePosting } from "./angles.ts";
import {
  applyChanges, decisionsOf, deriveChanges, flagView, honestyChecks, keepTwoPages, offers, openReason, placesOnCv, tightenChange, tightenChoices,
  type CvChange, type CvFlag, type CvFlagView, type CvLineView, type CvPlan, type CvVersionState, type EvidenceRow, type HonestyCheckView, type PieceLink, type TightenChoice,
} from "./cv-version.ts";
import { checkWording, quoteOf, validateCv, type HonestyProfile } from "./honesty.ts";
import { nearTheLine, type NearTheLine, type SkippedQuestion } from "./interview.ts";
import type { Contact } from "./contact.ts";
import type { FileStore, PackageFolder } from "./ports.ts";
import { entryLabel, type PieceInput, type PieceKind, type PieceOrigin, type ProfilePiece, type SavePieceResult } from "./profile.ts";
import type { DocumentDraft, DraftRequest } from "./engine.ts";

export const packageSteps = ["target", "cv", "letter", "answers", "ats"] as const;
export type PackageStep = (typeof packageSteps)[number];

export const stepLabel: Record<PackageStep, string> = {
  target: "Target posting",
  cv: "CV version",
  letter: "Cover letter",
  answers: "Screening answers",
  ats: "ATS check",
};

/** Every tunable number behind packages, in one place. Starting guesses: tune them against real packages. */
export const packageRules = {
  /** A failed model call is tried this many times in all before the part waits for Retry. */
  attempts: 2,
  /** About how long each part takes, in seconds, for the time estimate. */
  seconds: { target: 0, cv: 20, letter: 15, answers: 15, ats: 2 } satisfies Record<PackageStep, number>,
  /** The time goal from opening the job to an approved package, in minutes (shown neutrally). */
  goalMinutes: 10,
} as const;

/** The Job a package is for, as Discover reads it: a JobDetail fits. */
export interface PackageJob {
  id: string;
  title: string;
  titleTranslation: string | null;
  company: string;
  location: string | null;
  /** The language the posting asks for: Bulgarian for a Bulgarian posting, English otherwise. */
  packageLanguage: DocumentLanguage;
  closed: { at: string; how: string; decisionId: string } | null;
  reading: { state: string };
  /** How the posting asks for each (required unless it says), and what kind of thing it is, for the evidence matcher. */
  requirements: { text: string; kind?: "required" | "preferred"; category?: RequirementCategory }[];
  postings: {
    id: string;
    site: string;
    url: string;
    source: { name: string; kind: string; label: string; category: string };
  }[];
  target: { postingId: string };
}

/** Why a package can't start, in the Job page's words. */
export type PrepareProblem = "closed" | "not-read" | "no-profile";

/** What the Job page's Prepare button shows for a package that exists. */
export interface PackageChip {
  packageId: string;
  /** Preparing (parts still being written), continue (a step waits for Kris), or ready. */
  kind: "preparing" | "continue" | "ready";
  /** "Preparing package", "Continue package · step 2 of 5", "Package ready". */
  label: string;
  /** The step Kris is at (1–5). */
  step: number;
}

export type PrepareStatus =
  | { canStart: true; package: PackageChip | null }
  | { canStart: false; problem: PrepareProblem; reason: string; package: PackageChip | null };

/**
 * A part's state: waiting to be written, working, done, failed (after the automatic retry), stopped
 * by Kris, not written (the AI budget would have been crossed), or later (not built yet).
 */
export type PartState = "waiting" | "working" | "done" | "failed" | "stopped" | "not-written" | "later";

export interface PackagePart {
  part: PackageStep;
  label: string;
  state: PartState;
  /** What it is or why it's in this state, in plain words. */
  what: string;
  /** How many times the model was asked for it. */
  attempts: number;
  /** Why the last attempt failed. */
  error: string | null;
  /** What it cost so far, in USD. */
  costUsd: number;
  /** Whether it needs the model (only those stop at the cap). */
  needsModel: boolean;
}

/** A step as the stepper shows it. States never only by colour: each has its sub-label. */
export type StepState = "done" | "current" | "flagged" | "working" | "failed" | "upcoming";

export interface PackageStepView {
  step: PackageStep;
  /** 1–5. */
  number: number;
  label: string;
  state: StepState;
  /** "Approved", "Choose", "Writing…", "Failed", "Not built yet". */
  sub: string;
  approvedAt: string | null;
  /** Null when Approve would work; otherwise why it can't, in plain words. */
  blocked: string | null;
}

/** One posting Kris could apply through, with what choosing it means. */
export interface TargetOption {
  postingId: string;
  site: string;
  url: string;
  /** The company's own page, where the CV goes straight into its system. */
  recommended: boolean;
  consequence: string;
}

/** The CV's current draft file: the exact PDF, read back. */
export interface CvDraftView {
  fileName: string;
  path: string;
  sha256: string;
  size: number;
  pages: number;
  overflow: DocumentDraft["overflow"];
  ats: AtsCheck | null;
  language: DocumentLanguage;
  photo: boolean;
}

/** A change from the master profile, as the CV step lists it. */
export interface CvChangeView {
  id: string;
  origin: "tailoring" | "tightening" | "decision";
  /** Set for a decision on a flag: changed through the flag, not with Undo. */
  flagId: string | null;
  label: string;
  was: string | null;
  is: string | null;
  detail: string | null;
  why: string;
  undone: boolean;
}

/** Whether the CV fits one page, and the ways to tighten it when it doesn't (Approve waits for one). */
export interface CvFit {
  pages: number;
  linesOnPage2: number;
  keepTwoPages: boolean;
  /** Empty while it fits on one page or Kris kept two. */
  choices: TightenChoice[];
}

/** The tailored CV version: its lines with their pieces, the evidence per requirement, every change, the honesty summary and notes. */
export interface CvVersionView {
  summary: CvLineView | null;
  roles: { roleId: string; heading: string; bullets: CvLineView[] }[];
  skills: CvLineView[];
  education: CvLineView[];
  evidence: EvidenceRow[];
  changes: CvChangeView[];
  /** Every flag, in the order of the requirements they sit inside; decided ones stay with their choice. */
  flags: CvFlagView[];
  /** The decisions made so far, in words: for the approved package's summary and the later steps. */
  decisions: { flagId: string; title: string; decision: string; at: string }[];
  honesty: HonestyCheckView[];
  notes: string[];
  fit: CvFit;
}

/** A piece learned from Kris's answer inside a package, waiting in Profile › Learned during packages. */
export interface LearnedPiece {
  piece: ProfilePiece;
  packageId: string;
  jobId: string;
  /** "Security Engineer at Kestrel Payments". */
  job: string;
  company: string;
  question: string;
  answer: string;
  learnedAt: string;
  /** Set when the piece says more than the answer did: the suggested honest version (never bulk-confirmed). */
  nearTheLine: NearTheLine | null;
}

export interface PackageView {
  id: string;
  jobId: string;
  title: string;
  company: string;
  startedAt: string;
  language: DocumentLanguage;
  /** The posting's own language, which the package started in. */
  postingLanguage: DocumentLanguage;
  angle: { angle: Angle; label: string; reason: string };
  targetPostingId: string;
  targetOptions: TargetOption[];
  /** Whether the CV shows the photo, and whether there is one in Profile to show. */
  photo: boolean;
  photoAvailable: boolean;
  parts: PackagePart[];
  /** Parts done out of the five. */
  partsReady: number;
  /** True while a part is being written. */
  generating: boolean;
  /** When Kris stopped generating, if he did. */
  stoppedAt: string | null;
  steps: PackageStepView[];
  cv: CvDraftView | null;
  /** The tailored CV version, once the CV is written. */
  cvVersion: CvVersionView | null;
  /** What the package has cost so far, and the estimate for what's still to be written. */
  costUsd: number;
  estimate: { costUsd: number; seconds: number };
  /** This month's AI spending against the shared cap. */
  budget: BudgetInfo;
  chip: PackageChip;
}

export type StartPackageResult =
  | { started: true; package: PackageView }
  | { started: false; problem: PrepareProblem; reason: string };

export type ApproveResult =
  | { approved: true; package: PackageView }
  | {
    approved: false; reason: string; /** The step that blocks it: the one to move focus to. */ blockedBy: PackageStep;
    /** The open flag that blocks it, to link to. */ flagId: string | null; package: PackageView;
  };

/** Kris's decision on a flag: one of its options, or her own wording (checked before it's used). */
export type FlagChoice = { option: string } | { own: string };

export type ChangeResult = { changed: true; package: PackageView } | { changed: false; reason: string; package: PackageView };

export interface PackageStoreDeps {
  db: SqlDatabase;
  clock: Clock;
  budget: AiBudget;
  writer: Writer;
  files: FileStore;
  packages: PackageFolder;
  pieces: () => ProfilePiece[];
  /** Saves a piece learned from Kris's answer (unconfirmed, or flagged near the line). */
  savePiece: (input: PieceInput, origin: PieceOrigin) => SavePieceResult;
  /** Interview questions Kris skipped, so a gap can say when it was one of them. */
  skipped: () => SkippedQuestion[];
  contact: () => Contact;
  closestAngle: (posting: AnglePosting) => AngleChoice;
  draftDocument: (request: DraftRequest) => Promise<DocumentDraft>;
}

export interface PackageStore {
  status(job: PackageJob): PrepareStatus;
  start(job: PackageJob): StartPackageResult;
  get(id: string): PackageView | null;
  forJob(jobId: string): PackageView | null;
  chips(jobIds: string[]): Record<string, PackageChip>;
  settled(id: string): Promise<PackageView | null>;
  approve(id: string, step: PackageStep): ApproveResult;
  setTarget(id: string, postingId: string): ChangeResult;
  setLanguage(id: string, language: DocumentLanguage): Promise<ChangeResult>;
  setPhoto(id: string, on: boolean): Promise<ChangeResult>;
  stop(id: string): PackageView;
  retry(id: string, part: PackageStep): ChangeResult;
  /** Undoes one change from the master profile (the line it replaced comes back) and prints the CV again. */
  undoChange(id: string, changeId: string): Promise<ChangeResult>;
  redoChange(id: string, changeId: string): Promise<ChangeResult>;
  /** One of the ways offered to fit the CV on one page (an undoable change), keep two pages, or "choose-again" after keeping two. */
  fitCv(id: string, choiceId: string): Promise<ChangeResult>;
  cvFile(id: string): Promise<{ fileName: string; pdf: Uint8Array } | null>;
  /** Kris's decision on a flag; a wording is printed on the CV, and an approved CV step reopens. */
  decideFlag(id: string, flagId: string, choice: FlagChoice): Promise<ChangeResult>;
  /** Kris's answer to a gap's question: the coach writes a piece from it, and its line comes back as a new flag. */
  answerGap(id: string, flagId: string, answer: string): Promise<ChangeResult>;
  /** Pieces learned in packages that wait for Kris (unconfirmed or near the line), newest first. */
  learned(): LearnedPiece[];
}

/** Sources that are the company's own careers system (an ATS, or a company's own jobs API). */
const ownSystems = new Set(["amazon", "microsoft"]);
const isOwnPage = (p: PackageJob["postings"][number]) => p.source.category === "ats" || ownSystems.has(p.source.kind);

function consequence(p: PackageJob["postings"][number]): string {
  if (isOwnPage(p)) return "The company's own page. Your CV goes straight into their system and no account is needed.";
  switch (p.source.category) {
    case "email":
      return `From a ${p.source.label} alert email. The site may send its own profile of you rather than this tailored CV, so you'd likely apply by hand.`;
    case "capture":
      return "A page you captured. Check it still takes applications before you apply through it.";
    default:
      return `A job board's copy. It may forward you to the company's form and mark you as coming from ${p.site}. Pick it only if you want the board credited.`;
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function createPackageStore(deps: PackageStoreDeps): PackageStore {
  const { db, clock } = deps;
  /** The generation running for each package, so callers (and tests) can wait for it. */
  const running = new Map<string, Promise<void>>();
  // A part left being written when the app stopped can't finish: it shows as failed, ready for Retry.
  db.prepare("UPDATE package_part SET state = 'failed', error = ?, updated_at = ? WHERE state = 'working'")
    .run("apply-kit stopped while this was being written", clock.now().toISOString());

  // ---- reading -----------------------------------------------------------------------------

  interface Row {
    id: string; jobId: string; job: PackageJob; angle: Angle; angleReason: string; language: DocumentLanguage;
    targetPostingId: string; photo: boolean; approved: Partial<Record<PackageStep, string>>; reviewed: boolean; cvDraft: CvDraftView | null;
    cvVersion: CvVersionState | null; startedAt: string; stoppedAt: string | null;
  }
  interface PartRow { part: PackageStep; state: PartState; attempts: number; error: string | null; costUsd: number; output: unknown }

  const toRow = (r: Record<string, unknown>): Row => ({
    id: String(r.id), jobId: String(r.job_id), job: JSON.parse(String(r.job)) as PackageJob, angle: r.angle as Angle,
    angleReason: String(r.angle_reason), language: r.language as DocumentLanguage, targetPostingId: String(r.target_posting_id),
    photo: Number(r.photo) === 1, approved: JSON.parse(String(r.approved)) as Row["approved"], reviewed: r.reviewed_at != null,
    cvDraft: r.cv_draft == null ? null : (JSON.parse(String(r.cv_draft)) as CvDraftView),
    cvVersion: r.cv_version == null ? null : (JSON.parse(String(r.cv_version)) as CvVersionState),
    startedAt: String(r.started_at), stoppedAt: r.stopped_at == null ? null : String(r.stopped_at),
  });
  const row = (id: string) => {
    const r = db.prepare("SELECT * FROM package WHERE id = ?").get(id);
    return r ? toRow(r) : null;
  };
  const parts = (id: string): Map<PackageStep, PartRow> => new Map(
    db.prepare("SELECT * FROM package_part WHERE package_id = ?").all(id).map((r) => [r.part as PackageStep, {
      part: r.part as PackageStep, state: r.state as PartState, attempts: Number(r.attempts),
      error: r.error == null ? null : String(r.error), costUsd: Number(r.cost_usd),
      output: r.output == null ? null : JSON.parse(String(r.output)),
    }]),
  );
  const setPart = (id: string, part: PackageStep, fields: Partial<Omit<PartRow, "part">>) => {
    const sets = Object.entries({
      state: fields.state, attempts: fields.attempts, error: fields.error, cost_usd: fields.costUsd,
      output: fields.output === undefined ? undefined : JSON.stringify(fields.output),
    }).filter(([, v]) => v !== undefined);
    db.prepare(`UPDATE package_part SET ${[...sets.map(([k]) => `${k} = ?`), "updated_at = ?"].join(", ")} WHERE package_id = ? AND part = ?`)
      .run(...sets.map(([, v]) => v as string | number | null), clock.now().toISOString(), id, part);
  };

  const modelParts: PackageStep[] = ["cv"];
  const partWhat = (r: Row, p: PartRow): string => {
    const target = r.job.postings.find((x) => x.id === r.targetPostingId);
    const language = r.language === "bg" ? "Bulgarian" : "English";
    switch (p.part) {
      case "target":
        return `${target?.site ?? "The job's posting"}${target && isOwnPage(target) ? ", the company's own page" : ""} · ${language}${r.language === r.job.packageLanguage ? ", from the posting" : ""}`;
      case "cv":
        return p.state === "working" ? `${angleLabel[r.angle]} angle · writing from your profile`
          : p.state === "done" ? `${angleLabel[r.angle]} angle · ${r.cvDraft?.pages === 1 ? "1 page" : `${r.cvDraft?.pages ?? 0} pages`}`
          : p.state === "failed" ? `Not written: ${p.error ?? "the model didn't answer"}. The rest is saved.`
          : p.state === "stopped" ? "Stopped before it was written. Generate it again when you like."
          : p.state === "not-written" ? "Not written: this month's AI budget would be crossed."
          : `${angleLabel[r.angle]} angle`;
      case "letter":
      case "answers":
        return "Arrives with a later part of the rebuild.";
      case "ats":
        return "Reads the CV PDF once you approve the CV. Runs on this laptop, no model needed.";
    }
  };

  const isGenerating = (r: Row, ps: Map<PackageStep, PartRow>) =>
    [...ps.values()].some((p) => p.state === "working" || (p.state === "waiting" && modelParts.includes(p.part) && !r.stoppedAt));

  function chipOf(r: Row, ps: Map<PackageStep, PartRow>): PackageChip {
    const first = packageSteps.findIndex((s) => !r.approved[s]);
    const step = first === -1 ? packageSteps.length : first + 1;
    if (isGenerating(r, ps)) return { packageId: r.id, kind: "preparing", label: "Preparing package", step };
    // Ready: everything written and Kris hasn't started reviewing, or every step approved.
    const allWritten = [...ps.values()].every((p) => p.state === "done" || p.state === "later" || p.part === "ats");
    if (first === -1 || (!r.reviewed && allWritten)) return { packageId: r.id, kind: "ready", label: "Package ready", step };
    return { packageId: r.id, kind: "continue", label: `Continue package · step ${step} of ${packageSteps.length}`, step };
  }

  /** Why a step can't be approved now, and the step that blocks it; null when it can. */
  function blockOf(r: Row, ps: Map<PackageStep, PartRow>, step: PackageStep): { reason: string; by: PackageStep; flag?: string } | null {
    const n = packageSteps.indexOf(step);
    const before = packageSteps.slice(0, n).find((s) => !r.approved[s]);
    if (before) {
      const m = packageSteps.indexOf(before) + 1;
      return { reason: `Approve step ${m}, ${stepLabel[before]}, first. Steps are approved in order, so a later part never contradicts an earlier decision.`, by: before };
    }
    const p = ps.get(step)!;
    const name = lower(stepLabel[step]);
    switch (p.state) {
      case "done": {
        const open = step === "cv" ? openFlags(r) : [];
        if (open.length) {
          const f = open[0]!;
          return {
            reason: `The CV can't be approved yet: ${open.length === 1 ? "1 flag is" : `${open.length} flags are`} still open. ${openReason(f, requirementText(r, f))}`,
            by: step, flag: f.id,
          };
        }
        if (step === "cv" && r.cvDraft?.overflow && !r.cvVersion?.keepTwoPages) {
          return { reason: `This CV runs onto ${r.cvDraft.pages} pages. Choose how to fit one page, or keep ${r.cvDraft.pages}.`, by: step };
        }
        return null;
      }
      case "working": return { reason: `The ${name} is still being written.`, by: step };
      case "waiting": return step === "ats"
        ? { reason: "The ATS check runs once the CV is approved.", by: step }
        : { reason: `The ${name} hasn't been written yet.`, by: step };
      case "later": return { reason: `The ${name} arrives with a later part of the rebuild.`, by: step };
      default: return { reason: `There's no ${name} to approve: it wasn't written. Retry it first.`, by: step };
    }
  }

  function stepsOf(r: Row, ps: Map<PackageStep, PartRow>): PackageStepView[] {
    const current = packageSteps.find((s) => !r.approved[s]);
    return packageSteps.map((step, i) => {
      const p = ps.get(step)!;
      const approvedAt = r.approved[step] ?? null;
      const block = blockOf(r, ps, step);
      const flags = step === "cv" && p.state === "done" ? r.cvVersion?.flags ?? [] : [];
      const open = flags.filter((f) => !f.decision).length;
      const [state, sub]: [StepState, string] = approvedAt ? ["done", "Approved"]
        : open ? [step === current ? "current" : "flagged", open === 1 ? "1 flag" : `${open} flags`]
        : flags.length && step === current ? ["current", "Flags decided"]
        : p.state === "working" ? ["working", "Writing…"]
        : p.state === "failed" ? ["failed", "Failed"]
        : step === current ? ["current", p.state === "done" ? (step === "target" ? "Choose" : "Ready to check") : p.state === "later" ? "Not built yet" : "Not written"]
        : p.state === "later" ? ["upcoming", "Not built yet"]
        : p.state === "stopped" || p.state === "not-written" ? ["upcoming", "Not written"]
        : step === "ats" ? ["upcoming", "After the CV"]
        : ["upcoming", p.state === "done" ? "Drafted" : "Waiting"];
      return { step, number: i + 1, label: stepLabel[step], state, sub, approvedAt, blocked: approvedAt ? null : block?.reason ?? null };
    });
  }

  function view(r: Row): PackageView {
    const ps = parts(r.id);
    const list = packageSteps.map((s) => ps.get(s)!);
    const toWrite = list.filter((p) => modelParts.includes(p.part) && (p.state === "waiting" || p.state === "working"));
    const contact = deps.contact();
    const recommended = r.job.postings.find(isOwnPage)?.id ?? null;
    return {
      id: r.id,
      jobId: r.jobId,
      title: r.job.titleTranslation ?? r.job.title,
      company: r.job.company,
      startedAt: r.startedAt,
      language: r.language,
      postingLanguage: r.job.packageLanguage,
      angle: { angle: r.angle, label: angleLabel[r.angle], reason: r.angleReason },
      targetPostingId: r.targetPostingId,
      targetOptions: r.job.postings.map((p) => ({ postingId: p.id, site: p.site, url: p.url, recommended: p.id === recommended, consequence: consequence(p) }))
        .sort((a, b) => Number(b.recommended) - Number(a.recommended)),
      photo: r.photo,
      photoAvailable: contact.photo !== null,
      parts: list.map((p) => ({
        part: p.part, label: stepLabel[p.part], state: p.state, what: partWhat(r, p), attempts: p.attempts, error: p.error,
        costUsd: p.costUsd, needsModel: modelParts.includes(p.part),
      })),
      partsReady: list.filter((p) => p.state === "done").length,
      generating: isGenerating(r, ps),
      stoppedAt: r.stoppedAt,
      steps: stepsOf(r, ps),
      cv: r.cvDraft,
      cvVersion: cvVersionView(r),
      costUsd: Math.round(list.reduce((n, p) => n + p.costUsd, 0) * 1e6) / 1e6,
      estimate: {
        // Only the CV needs the model so far; later parts add their own task's estimate here.
        costUsd: toWrite.length ? Math.round(deps.writer.estimateCostUsd({ task: "tailor-cv", input: tailorInput(r) }) * 1e6) / 1e6 : 0,
        seconds: toWrite.reduce((n, p) => n + packageRules.seconds[p.part], 0),
      },
      budget: deps.budget.info(),
      chip: chipOf(r, ps),
    };
  }

  // ---- the CV --------------------------------------------------------------------------------

  /** Confirmed pieces: the only ones a package may use, besides the ones it learned itself. */
  const confirmed = () => deps.pieces().filter((p) => p.status === "confirmed");
  /** Pieces this package learned from Kris's answers: usable only here until she confirms them. */
  const learnedIds = (id: string) => db.prepare("SELECT piece_id FROM package_piece WHERE package_id = ?").all(id).map((x) => String(x.piece_id));
  const honestyProfile = (r: Row): HonestyProfile => ({ pieces: deps.pieces(), packagePieces: learnedIds(r.id), alsoNamed: [r.job.company], now: clock.now() });

  function tailorInput(r: Row): TailorCvInput {
    const angle = deps.closestAngle(r.job);
    return {
      posting: { title: r.job.title, company: r.job.company, requirements: r.job.requirements.map((q) => q.text) },
      language: r.language,
      angle: { label: angleLabel[r.angle], summary: angle.angle === r.angle ? angle.summary : "" },
      pieces: deps.pieces().filter((p) => p.status === "confirmed" || learnedIds(r.id).includes(p.id)).map((p) => ({
        id: p.id, kind: p.kind, text: p.text, entry: p.entry && { title: p.entry.title, organisation: p.entry.organisation, start: p.entry.start, end: p.entry.end },
        belongsTo: p.belongsTo, tags: p.tags, numberSource: p.numberSource,
      })),
    };
  }

  const month = (ym: string): DocumentDate => {
    const [y, m] = ym.split("-").map(Number);
    return Number.isFinite(y) ? (m ? { year: y!, month: m } : { year: y! }) : { text: ym };
  };

  const byId = () => new Map(deps.pieces().map((p) => [p.id, p]));

  /**
   * The master profile's CV for the package's angle, by piece: the angle's summary line, every role
   * (the timeline is never shortened) with the angle's achievements as bullets, leads first, the
   * angle's skills, and education. The baseline every change is made to.
   */
  function baseline(r: Row): CvPlan {
    const pieces = confirmed();
    const choice = deps.closestAngle(r.job);
    const leads = choice.angle === r.angle ? choice.leads.map((p) => p.id) : [];
    const rank = (p: ProfilePiece) => (leads.includes(p.id) ? leads.indexOf(p.id) : leads.length);
    const byEnd = (a: ProfilePiece, b: ProfilePiece) => (b.entry!.end ?? "9999").localeCompare(a.entry!.end ?? "9999") || b.entry!.start.localeCompare(a.entry!.start);
    const roles = pieces.filter((p) => p.kind === "role" && p.entry).sort(byEnd);
    const ofAngle = (p: ProfilePiece) => p.angles.includes(r.angle);
    const summaryText = choice.angle === r.angle ? choice.summary.trim() : "";
    const summaryPieces = leads.length ? leads.slice(0, 3) : roles.slice(0, 1).map((p) => p.id);
    return {
      summary: summaryText && summaryPieces.length ? { text: summaryText, pieceIds: summaryPieces } : null,
      roles: roles.map((role) => ({
        roleId: role.id,
        bullets: pieces.filter((p) => p.kind === "achievement" && p.belongsTo === role.id && ofAngle(p))
          .sort((a, b) => rank(a) - rank(b)).map((p) => ({ pieceId: p.id, text: p.text.trim().replace(/\.$/, ""), pieceIds: [p.id] })),
      })),
      skills: pieces.filter((p) => p.kind === "skill" && ofAngle(p)).sort((a, b) => rank(a) - rank(b)).map((p) => p.id),
      education: pieces.filter((p) => p.kind === "education" && p.entry).sort(byEnd).map((p) => p.id),
    };
  }

  /** The CV as printed: the baseline with the changes that aren't undone. */
  const planOf = (r: Row): CvPlan => applyChanges(baseline(r), r.cvVersion?.changes ?? []);

  /** The CV through its template: the plan's words, with roles' and education's facts exactly as in the profile. */
  async function cvDocument(r: Row): Promise<DocumentToRender> {
    const plan = planOf(r);
    const pieces = byId();
    const contact = deps.contact();
    const entries = plan.roles.map((role) => ({ role, entry: pieces.get(role.roleId)?.entry })).filter((x) => x.entry);
    const name = r.language === "bg" && contact.nameCyrillic ? contact.nameCyrillic : contact.nameLatin;
    const content: CvContent = {
      letterhead: {
        name,
        headline: entries[0]?.entry?.title ?? "",
        location: [contact.city, contact.country].filter(Boolean).join(", ") || undefined,
        email: contact.email,
        phone: contact.phone || undefined,
        links: contact.links.map((l) => l.replace(/^https?:\/\//, "").replace(/\/$/, "")),
      },
      summary: plan.summary?.text ?? "",
      experience: entries.map(({ role, entry }) => ({
        title: entry!.title,
        employer: entry!.organisation,
        place: entry!.city ?? undefined,
        start: month(entry!.start),
        end: entry!.end ? month(entry!.end) : "present",
        bullets: role.bullets.map((b) => b.text),
      })),
      skills: plan.skills.map((id) => pieces.get(id)?.text ?? "").filter(Boolean),
      education: plan.education.map((id) => pieces.get(id)?.entry).filter((e) => !!e).map((e) => ({
        degree: e.title, school: e.organisation, start: month(e.start), end: e.end ? month(e.end) : { text: "" },
      })),
      languagesAndCourses: [],
    };
    if (r.photo && contact.photo) {
      const bytes = await deps.files.get(contact.photo.sha256);
      if (bytes) content.photo = { mediaType: bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg", bytes };
    }
    return { kind: "cv", language: r.language, title: `${name} · CV · ${r.job.company}`, content };
  }

  /** Checks the writer's tailored CV with the honesty validator and keeps it as the package's CV version. */
  function keepTailored(id: string, output: unknown): void {
    const r = row(id)!;
    const validated = validateCv(output as TailoredCv, honestyProfile(r));
    const base = baseline(r);
    const now = clock.now();
    const required = r.job.requirements.map((q) => (q.kind ?? "required") === "required"
      ? matchEvidence({ text: q.text, kind: "required", category: q.category ?? "other" }, deps.pieces(), now) : null);
    /** The first requirement these pieces are evidence for (the writer's citations, then the matcher's). */
    const requirementOf = (ids: string[]): number | null => {
      const cited = validated.evidence.find((e) => e.pieceIds.some((x) => ids.includes(x)));
      if (cited) return cited.requirement;
      const i = required.findIndex((m) => m?.pieces.some((x) => ids.includes(x.id)));
      return i === -1 ? null : i;
    };
    const flags: CvFlag[] = [];
    const flag = (f: Omit<CvFlag, "id" | "answer" | "related" | "decision">) => flags.push({ ...f, id: crypto.randomUUID(), answer: null, related: null, decision: null });
    if (validated.heldSummary) {
      const h = validated.heldSummary;
      flag({ kind: "near-the-line", requirement: requirementOf(h.pieceIds), place: { kind: "summary" }, pieceIds: h.pieceIds, piece: base.summary?.text ?? null, draft: h.draft, honest: h.honest });
    }
    for (const role of validated.roles) {
      for (const b of role.bullets) {
        if (b.kept?.reason !== "near-the-line") continue;
        const piece = byId().get(b.pieceIds[0]!);
        flag({
          kind: "near-the-line", requirement: requirementOf(b.pieceIds), place: { kind: "bullet", roleId: role.pieceId, pieceId: b.pieceIds[0]! },
          pieceIds: b.pieceIds, piece: piece?.text.trim() ?? b.text, draft: b.kept.draft, honest: b.kept.honest,
        });
      }
    }
    required.forEach((m, i) => {
      if (m?.status === "gap") flag({ kind: "gap", requirement: i, place: null, pieceIds: [], piece: null, draft: null, honest: null });
    });
    const state: CvVersionState = {
      changes: deriveChanges(base, validated, byId(), () => crypto.randomUUID()),
      keepTwoPages: false,
      evidence: validated.evidence,
      notes: validated.notes,
      caught: validated.caught,
      heldBack: validated.heldBack,
      flags,
    };
    db.prepare("UPDATE package SET cv_version = ? WHERE id = ?").run(JSON.stringify(state), id);
  }

  const saveVersion = (id: string, state: CvVersionState) => db.prepare("UPDATE package SET cv_version = ? WHERE id = ?").run(JSON.stringify(state), id);

  const requirementText = (r: Row, f: CvFlag) => (f.requirement === null ? null : r.job.requirements[f.requirement]?.text ?? null);
  const openFlags = (r: Row) => sortFlags(r.cvVersion?.flags ?? []).filter((f) => !f.decision);
  const sortFlags = (flags: CvFlag[]) => flags.map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.requirement ?? Infinity) - (b.f.requirement ?? Infinity) || a.i - b.i).map((x) => x.f);

  /** The flags as the CV step shows them; a gap Kris skipped in the coach interview says so. */
  function flagsOf(r: Row): CvFlagView[] {
    const skipped = deps.skipped().filter((q) => q.topic.kind === "skill");
    return sortFlags(r.cvVersion?.flags ?? []).map((f) => {
      const v = flagView(f, requirementText(r, f));
      const req = requirementText(r, f)?.toLowerCase() ?? "";
      const asked = f.kind === "gap" && skipped.find((q) => q.topic.kind === "skill" && req.includes(q.topic.skill.toLowerCase()));
      return asked && asked.topic.kind === "skill"
        ? { ...v, detail: `${v.detail} You skipped a question about ${asked.topic.skill} in the coach interview: this is a good time to answer it.` }
        : v;
    });
  }

  function cvVersionView(r: Row): CvVersionView | null {
    if (!r.cvVersion || !r.cvDraft) return null;
    const state = r.cvVersion;
    const pieces = byId();
    const plan = planOf(r);
    const link = (id: string): PieceLink | null => { const p = pieces.get(id); return p ? evidenceLabel(p) : null; };
    const line = (text: string, ids: string[]): CvLineView => ({ text, pieces: ids.map(link).filter((l): l is PieceLink => l !== null) });
    const now = clock.now();
    const evidence: EvidenceRow[] = r.job.requirements.map((q, i) => {
      const kind = q.kind ?? "required";
      const found = matchEvidence({ text: q.text, kind, category: q.category ?? "other" }, deps.pieces(), now);
      const cited = state.evidence.filter((e) => e.requirement === i).flatMap((e) => e.pieceIds);
      // A line from Kris's answer that she chose to use is this package's evidence for it.
      const learned = (state.flags ?? []).filter((f) => f.kind === "learned" && f.requirement === i && (f.decision?.option === "use" || f.decision?.option === "own")).flatMap((f) => f.pieceIds);
      const ids = [...new Set([...found.pieces.map((p) => p.id), ...(found.status === "gap" || found.status === "not-held" ? [] : cited), ...learned])];
      const onCv = placesOnCv(ids, plan, pieces);
      return {
        requirement: q.text, kind, status: found.status, note: found.note,
        pieces: ids.map(link).filter((l): l is PieceLink => l !== null),
        onCv: onCv.length ? onCv
          : found.status === "not-held" ? ["Left out, not claimed. Preferred items are never gaps."]
          : found.status === "gap" ? ["Not on the CV"] : ["Not on this CV"],
      };
    });
    const draft = r.cvDraft;
    const overflow = draft.overflow;
    const template = `${draft.pages === 1 ? "1 page" : `${draft.pages} pages`}, single column, Standard template, ${r.photo ? "with photo" : "no photo"}.`;
    return {
      summary: plan.summary && line(plan.summary.text, plan.summary.pieceIds),
      roles: plan.roles.filter((role) => pieces.get(role.roleId)?.entry).map((role) => ({
        roleId: role.roleId, heading: entryLabel(pieces.get(role.roleId)!.entry!), bullets: role.bullets.map((b) => line(b.text, b.pieceIds)),
      })),
      skills: plan.skills.filter((id) => pieces.has(id)).map((id) => line(pieces.get(id)!.text, [id])),
      education: plan.education.filter((id) => pieces.get(id)?.entry).map((id) => {
        const e = pieces.get(id)!.entry!;
        return line(`${e.title} · ${e.organisation}`, [id]);
      }),
      evidence,
      changes: state.changes.map(({ id, origin, flagId, label, was, is, detail, why, undone }) => ({ id, origin, flagId: flagId ?? null, label, was, is, detail, why, undone })),
      flags: flagsOf(r),
      decisions: decisionsOf(state.flags ?? [], (f) => flagView(f, requirementText(r, f)).title),
      honesty: honestyChecks(state, evidence),
      notes: [...state.notes, template],
      fit: {
        pages: draft.pages,
        linesOnPage2: overflow?.linesAfterFirstPage ?? 0,
        keepTwoPages: state.keepTwoPages,
        choices: overflow && !state.keepTwoPages ? tightenChoices(plan, pieces, r.angle) : [],
      },
    };
  }

  /** Prints the CV and keeps it as the package's draft. */
  async function renderCv(id: string): Promise<void> {
    const r = row(id)!;
    const draft = await deps.draftDocument({
      packageId: id,
      document: await cvDocument(r),
      fileName: { name: deps.contact().nameLatin, company: r.job.company, role: r.job.title },
      keywords: [],
    });
    const cv: CvDraftView = {
      fileName: draft.fileName, path: draft.path, sha256: draft.sha256, size: draft.size, pages: draft.pages,
      overflow: draft.overflow, ats: draft.ats, language: r.language, photo: r.photo,
    };
    db.prepare("UPDATE package SET cv_draft = ? WHERE id = ?").run(JSON.stringify(cv), id);
  }

  // ---- generating ----------------------------------------------------------------------------

  const stopped = (id: string) => row(id)?.stoppedAt != null;
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  /** Writes the CV part: the tailoring call (retried once on failure) within the cap, then the PDF. */
  async function writeCv(id: string): Promise<void> {
    let { attempts, costUsd } = parts(id).get("cv")!;
    setPart(id, "cv", { state: "working", error: null });
    for (let tries = 0; tries < packageRules.attempts; tries++) {
      if (stopped(id)) return;
      const input = tailorInput(row(id)!);
      attempts += 1;
      let outcome;
      try {
        outcome = await deps.budget.call(
          { task: "tailor-cv", estimateUsd: deps.writer.estimateCostUsd({ task: "tailor-cv", input }) },
          () => deps.writer.tailorCv(input),
        );
      } catch (err) {
        const billed = (err as { costUsd?: unknown } | null)?.costUsd;
        if (typeof billed === "number" && billed > 0) costUsd += billed;
        const last = tries === packageRules.attempts - 1;
        if (stopped(id)) { setPart(id, "cv", { attempts, costUsd, error: message(err) }); return; }
        setPart(id, "cv", { attempts, costUsd, error: message(err), ...(last && { state: "failed" }) });
        if (last) return;
        continue;
      }
      if (outcome.refused) {
        setPart(id, "cv", { state: "not-written", attempts: attempts - 1, error: null });
        return;
      }
      costUsd += outcome.result.costUsd;
      // Stopped while the model was writing: the call is paid for, but its answer isn't used.
      if (stopped(id)) { setPart(id, "cv", { attempts, costUsd }); return; }
      setPart(id, "cv", { attempts, costUsd, output: outcome.result.output });
      keepTailored(id, outcome.result.output);
      try {
        await renderCv(id);
      } catch (err) {
        setPart(id, "cv", { state: "failed", error: `The PDF couldn't be printed: ${message(err)}` });
        return;
      }
      setPart(id, "cv", { state: "done", error: null });
      return;
    }
  }

  function generate(id: string): void {
    // Parts about to be written show as working at once, so the package never looks idle.
    for (const part of modelParts) if (parts(id).get(part)!.state === "waiting") setPart(id, part, { state: "working" });
    const before = running.get(id) ?? Promise.resolve();
    const run = before.then(async () => {
      for (const part of modelParts) {
        const state = parts(id).get(part)!.state;
        if (state === "working" && !stopped(id)) await writeCv(id);
      }
    }).catch((err: unknown) => {
      // Never leave a part spinning: whatever broke, the part shows as failed with Retry.
      for (const p of parts(id).values()) if (p.state === "working") setPart(id, p.part, { state: "failed", error: message(err) });
    });
    running.set(id, run);
  }

  // ---- operations ----------------------------------------------------------------------------

  const forJob = (jobId: string) => {
    const r = db.prepare("SELECT * FROM package WHERE job_id = ?").get(jobId);
    return r ? toRow(r) : null;
  };

  function status(job: PackageJob): PrepareStatus {
    const existing = forJob(job.id);
    const chip = existing ? chipOf(existing, parts(existing.id)) : null;
    if (job.closed) {
      return {
        canStart: false, problem: "closed", package: chip,
        reason: `Can't prepare a package: this job is closed (${lower(job.closed.how)}), so the posting may no longer accept applications. If it's still open, reopen it first.`,
      };
    }
    if (job.reading.state !== "read") {
      return {
        canStart: false, problem: "not-read", package: chip,
        reason: "Can't prepare a package yet: the posting's requirements haven't been read, and every part of a package is built against them.",
      };
    }
    if (!existing && confirmed().length === 0) {
      return { canStart: false, problem: "no-profile", package: null, reason: "A package needs your master profile first: every part is built from it." };
    }
    return { canStart: true, package: chip };
  }

  function start(job: PackageJob): StartPackageResult {
    const existing = forJob(job.id);
    if (existing) return { started: true, package: view(existing) };
    const s = status(job);
    if (!s.canStart) return { started: false, problem: s.problem, reason: s.reason };
    const id = crypto.randomUUID();
    const angle = deps.closestAngle(job);
    const target = job.postings.find(isOwnPage) ?? job.postings.find((p) => p.id === job.target.postingId) ?? job.postings[0];
    const now = clock.now().toISOString();
    const snapshot: PackageJob = {
      id: job.id, title: job.title, titleTranslation: job.titleTranslation, company: job.company, location: job.location,
      packageLanguage: job.packageLanguage, closed: null, reading: { state: job.reading.state },
      requirements: job.requirements.map((q) => ({ text: q.text, kind: q.kind ?? "required", category: q.category ?? "other" })),
      postings: job.postings.map((p) => ({ id: p.id, site: p.site, url: p.url, source: { name: p.source.name, kind: p.source.kind, label: p.source.label, category: p.source.category } })),
      target: { postingId: job.target.postingId },
    };
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO package (id, job_id, job, angle, angle_reason, language, target_posting_id, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, job.id, JSON.stringify(snapshot), angle.angle, angle.reason, job.packageLanguage, target?.id ?? "", now);
      const initial: Record<PackageStep, PartState> = { target: "done", cv: "waiting", letter: "later", answers: "later", ats: "waiting" };
      for (const step of packageSteps) {
        db.prepare("INSERT INTO package_part (package_id, part, state, updated_at) VALUES (?, ?, ?, ?)").run(id, step, initial[step], now);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    generate(id);
    return { started: true, package: view(row(id)!) };
  }

  /** Editing an approved part reopens its step and every later one. */
  const reopenFrom = (r: Row, step: PackageStep) => {
    const from = packageSteps.indexOf(step);
    const approved = Object.fromEntries(Object.entries(r.approved).filter(([s]) => packageSteps.indexOf(s as PackageStep) < from));
    db.prepare("UPDATE package SET approved = ? WHERE id = ?").run(JSON.stringify(approved), r.id);
  };

  /** Undoes (or redoes) one change, reopens the CV step and prints the CV again. */
  async function toggleChange(id: string, changeId: string, undone: boolean): Promise<ChangeResult> {
    const r = mustGet(id);
    const change = r.cvVersion?.changes.find((c) => c.id === changeId);
    if (!r.cvVersion || !change) return { changed: false, reason: "That change isn't in this CV version.", package: view(r) };
    if (change.flagId) return { changed: false, reason: "This change is a decision on a flag: change it there.", package: view(r) };
    if (change.undone !== undone) {
      saveVersion(id, { ...r.cvVersion, changes: r.cvVersion.changes.map((c) => (c.id === changeId ? { ...c, undone } : c)) });
      reopenFrom(r, "cv");
      await renderCv(id);
    }
    return { changed: true, package: view(row(id)!) };
  }

  // ---- flags (#64) ---------------------------------------------------------------------------

  const norm = (t: string) => t.normalize("NFC").replace(/\s+/g, " ").trim().replace(/[.;]$/, "").toLowerCase();

  /** The change a decision makes to the CV (none when the CV keeps what it has). */
  function decisionChange(r: Row, f: CvFlag, option: string, text: string | null): CvChange | null {
    if (!text || !f.place || ["profile", "letter", "leave-out", "experience"].includes(option)) return null;
    const plan = planOf(r);
    const common = { id: crypto.randomUUID(), origin: "decision" as const, flagId: f.id, undone: false, was: null, is: text, detail: null };
    const place = f.place;
    if (place.kind === "summary") {
      return { ...common, kind: "summary", line: { text, pieceIds: f.pieceIds }, label: "Summary rewritten, as you decided", was: plan.summary?.text ?? null, why: "Your decision on a near-the-line edit." };
    }
    if (place.kind === "skill") {
      return { ...common, kind: "add-skill", pieceId: place.pieceId, label: "Skill added from your answer", why: "From your answer to the gap question. Used for this job only until you confirm it in Profile." };
    }
    if (f.kind === "learned") {
      const entry = byId().get(place.roleId)?.entry;
      return {
        ...common, kind: "add", roleId: place.roleId, bullet: { pieceId: place.pieceId, text, pieceIds: f.pieceIds }, label: "Bullet added from your answer",
        detail: `Under ${entry?.organisation ?? "its role"}.`, why: "From your answer to the gap question. Used for this job only until you confirm it in Profile.",
      };
    }
    const was = plan.roles.flatMap((x) => x.bullets).find((b) => b.pieceId === place.pieceId)?.text ?? f.piece;
    return { ...common, kind: "reword", pieceId: place.pieceId, line: { text, pieceIds: f.pieceIds }, label: "Bullet reworded, as you decided", was, why: "Your decision on a near-the-line edit." };
  }

  /** Saves the flags and changes, reopens the CV step and prints it again when the CV changed. */
  async function saveFlags(r: Row, flags: CvFlag[], changes: CvChange[]): Promise<ChangeResult> {
    const before = JSON.stringify(applyChanges(baseline(r), r.cvVersion!.changes));
    saveVersion(r.id, { ...r.cvVersion!, flags, changes });
    reopenFrom(r, "cv");
    if (JSON.stringify(planOf(row(r.id)!)) !== before) await renderCv(r.id);
    return { changed: true, package: view(row(r.id)!) };
  }

  async function decideFlag(id: string, flagId: string, choice: FlagChoice): Promise<ChangeResult> {
    const r = mustGet(id);
    const refuse = (reason: string): ChangeResult => ({ changed: false, reason, package: view(r) });
    const flags = r.cvVersion?.flags ?? [];
    const f = flags.find((x) => x.id === flagId);
    if (!r.cvVersion || !f) return refuse("That flag isn't in this CV version.");
    const option = "own" in choice ? "own" : choice.option;
    if (!offers(f, option)) return refuse("That isn't one of this flag's options.");
    if (option === "experience") return refuse("Tell the coach what you did first: answer the question under the options.");
    let text: string | null = null;
    if ("own" in choice) {
      text = choice.own.trim();
      if (f.draft && norm(text) === norm(f.draft)) return refuse("That's the wording that claims more than your profile backs. Choose another.");
      const problems = checkWording(text, f.pieceIds, honestyProfile(r));
      if (problems.length) return refuse(`That wording can't be used: it ${problems.map((p) => p.message).join("; it ")}.`);
      if (f.place?.kind !== "summary") text = text.replace(/\.$/, "");
    } else {
      text = option === "profile" ? f.piece : option === "honest" || option === "use" ? f.honest : null;
    }
    const at = clock.now().toISOString();
    // A gap decided another way no longer needs the line from Kris's answer.
    const dropped = f.kind === "gap" && f.related ? f.related : null;
    const next = flags.filter((x) => x.id !== dropped).map((x) => (x.id === f.id ? { ...x, decision: { option, text, at }, related: dropped ? null : x.related } : x));
    const change = decisionChange(r, f, option, text);
    const changes = [...r.cvVersion.changes.filter((c) => c.flagId !== f.id && (!dropped || c.flagId !== dropped)), ...(change ? [change] : [])];
    return saveFlags(r, next, changes);
  }

  async function answerGap(id: string, flagId: string, answer: string): Promise<ChangeResult> {
    const r = mustGet(id);
    const refuse = (reason: string): ChangeResult => ({ changed: false, reason, package: view(row(id)!) });
    const flags = r.cvVersion?.flags ?? [];
    const f = flags.find((x) => x.id === flagId);
    if (!r.cvVersion || !f || f.kind !== "gap") return refuse("That gap isn't in this CV version.");
    const said = answer.trim();
    if (!said) return refuse("Say what you did first. A short answer is fine.");
    const requirement = requirementText(r, f) ?? "";
    const question = flagView(f, requirement).question!.text;
    // Kris's answer is kept before it's sent, so a failure or the budget loses nothing.
    saveVersion(id, { ...r.cvVersion, flags: flags.map((x) => (x.id === f.id ? { ...x, answer: said } : x)) });
    const entries = confirmed().filter((p) => (p.kind === "role" || p.kind === "education") && p.entry).map((p) => ({
      id: p.id, kind: p.kind as "role" | "education", title: p.entry!.title, organisation: p.entry!.organisation, start: p.entry!.start, end: p.entry!.end,
    }));
    const input: CoachTurnInput = {
      asked: { topic: { kind: "skill", angle: r.angle, skill: requirement, suggestedBy: [] }, lines: [{ id: "question", who: "coach", text: question }, { id: "answer", who: "you", text: said }] },
      next: null,
      entries,
    };
    let outcome;
    try {
      outcome = await deps.budget.call({ task: "coach-turn", estimateUsd: deps.writer.estimateCostUsd({ task: "coach-turn", input }) }, () => deps.writer.coachTurn(input));
    } catch (err) {
      return refuse(`The coach didn't answer (${message(err)}). Your answer is kept: send it again.`);
    }
    if (outcome.refused) return refuse("This month's AI budget would be crossed, so the coach can't read your answer now. Your answer is kept.");
    const cv = parts(id).get("cv")!;
    setPart(id, "cv", { costUsd: cv.costUsd + outcome.result.costUsd });

    // The first achievement or skill written only from Kris's words; never an edit of a piece already there.
    const company = r.job.company;
    let learned: { piece: ProfilePiece; near: NearTheLine | null } | null = null;
    for (const w of outcome.result.output.pieces) {
      if (w.turn !== "answer" || w.updates || (w.kind !== "achievement" && w.kind !== "skill")) continue;
      const near = nearTheLine(w.text, said, w);
      const saved = deps.savePiece(
        { kind: w.kind as PieceKind, text: w.text, belongsTo: w.kind === "achievement" ? w.role : null, tags: w.tags, angles: w.angles.length ? w.angles : [r.angle], numberSource: w.numberSource },
        { from: `${company} package`, quote: said, status: near ? "flagged" : "unconfirmed" },
      );
      if (saved.saved) { learned = { piece: saved.piece, near }; break; }
    }
    if (!learned) return refuse("The coach couldn't write a line from that answer that keeps to your words. Add where and what you did, or choose another option.");

    const { piece, near } = learned;
    db.prepare("INSERT INTO package_piece (package_id, piece_id, flag_id, question, answer, near, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, piece.id, f.id, question, said, near ? JSON.stringify(near) : null, clock.now().toISOString());
    const line = (near ? near.honest : piece.text)?.trim().replace(/\.$/, "") ?? null;
    const onCv = planOf(r).roles.some((x) => x.roleId === piece.belongsTo);
    const place = piece.kind === "skill" ? { kind: "skill" as const, pieceId: piece.id }
      : piece.belongsTo && onCv ? { kind: "bullet" as const, roleId: piece.belongsTo, pieceId: piece.id } : null;
    const at = clock.now().toISOString();
    const fresh: CvFlag = {
      id: crypto.randomUUID(), kind: "learned", requirement: f.requirement, place, pieceIds: [piece.id], piece: null,
      draft: near ? near.stronger : null, honest: line, answer: said, related: f.id, decision: null,
    };
    const current = row(id)!.cvVersion!;
    const next = current.flags!.filter((x) => x.id !== f.related)
      .map((x) => (x.id === f.id ? { ...x, answer: said, related: fresh.id, decision: { option: "experience", text: said, at } } : x));
    // The new flag sits right after its gap.
    next.splice(next.findIndex((x) => x.id === f.id) + 1, 0, fresh);
    return saveFlags(row(id)!, next, current.changes.filter((c) => !f.related || c.flagId !== f.related));
  }

  function learned(): LearnedPiece[] {
    const pieces = new Map(deps.pieces().map((p) => [p.id, p]));
    return db.prepare("SELECT pp.*, p.job FROM package_piece pp JOIN package p ON p.id = pp.package_id ORDER BY pp.created_at DESC, pp.rowid DESC").all()
      .flatMap((x) => {
        const piece = pieces.get(String(x.piece_id));
        if (!piece || piece.status === "confirmed") return [];
        const job = JSON.parse(String(x.job)) as PackageJob;
        return [{
          piece, packageId: String(x.package_id), jobId: job.id, job: `${job.titleTranslation ?? job.title} at ${job.company}`, company: job.company,
          question: String(x.question), answer: String(x.answer), learnedAt: String(x.created_at),
          // Near the line only while Kris hasn't chosen a wording for it.
          nearTheLine: x.near != null && piece.status === "flagged" ? (JSON.parse(String(x.near)) as NearTheLine) : null,
        }];
      });
  }

  const mustGet = (id: string) => {
    const r = row(id);
    if (!r) throw new Error("No such package");
    return r;
  };

  return {
    status,
    start,
    get: (id) => { const r = row(id); return r ? view(r) : null; },
    forJob: (jobId) => { const r = forJob(jobId); return r ? view(r) : null; },
    chips(jobIds) {
      const out: Record<string, PackageChip> = {};
      for (const jobId of jobIds) {
        const r = forJob(jobId);
        if (r) out[jobId] = chipOf(r, parts(r.id));
      }
      return out;
    },
    async settled(id) {
      await running.get(id);
      const r = row(id);
      return r ? view(r) : null;
    },

    approve(id, step) {
      const r = mustGet(id);
      if (r.approved[step]) return { approved: true, package: view(r) };
      const block = blockOf(r, parts(id), step);
      if (block) return { approved: false, reason: block.reason, blockedBy: block.by, flagId: block.flag ?? null, package: view(r) };
      const now = clock.now().toISOString();
      db.prepare("UPDATE package SET approved = ?, reviewed_at = COALESCE(reviewed_at, ?) WHERE id = ?").run(JSON.stringify({ ...r.approved, [step]: now }), now, id);
      return { approved: true, package: view(row(id)!) };
    },

    setTarget(id, postingId) {
      const r = mustGet(id);
      if (!r.job.postings.some((p) => p.id === postingId)) return { changed: false, reason: "That posting isn't one of this job's.", package: view(r) };
      if (postingId !== r.targetPostingId) {
        db.prepare("UPDATE package SET target_posting_id = ? WHERE id = ?").run(postingId, id);
        reopenFrom(r, "target");
      }
      return { changed: true, package: view(row(id)!) };
    },

    async setLanguage(id, language) {
      const r = mustGet(id);
      if (language !== r.language) {
        db.prepare("UPDATE package SET language = ? WHERE id = ?").run(language, id);
        reopenFrom(r, "target");
        // Until the other parts exist, switching only prints the CV again in the new language.
        if (parts(id).get("cv")!.state === "done") await renderCv(id);
      }
      return { changed: true, package: view(row(id)!) };
    },

    async setPhoto(id, on) {
      const r = mustGet(id);
      if (on && !deps.contact().photo) return { changed: false, reason: "There's no photo in Profile yet. Add one under Contact details first.", package: view(r) };
      if (on !== r.photo) {
        db.prepare("UPDATE package SET photo = ? WHERE id = ?").run(on ? 1 : 0, id);
        reopenFrom(r, "cv");
        if (parts(id).get("cv")!.state === "done") await renderCv(id);
      }
      return { changed: true, package: view(row(id)!) };
    },

    stop(id) {
      const r = mustGet(id);
      if (!r.stoppedAt) db.prepare("UPDATE package SET stopped_at = ? WHERE id = ?").run(clock.now().toISOString(), id);
      for (const p of parts(id).values()) {
        if (modelParts.includes(p.part) && (p.state === "waiting" || p.state === "working")) setPart(id, p.part, { state: "stopped" });
      }
      return view(row(id)!);
    },

    retry(id, part) {
      const r = mustGet(id);
      const p = parts(id).get(part)!;
      if (!modelParts.includes(part) || !["failed", "stopped", "not-written"].includes(p.state)) {
        return { changed: false, reason: `The ${lower(stepLabel[part])} has nothing to retry.`, package: view(r) };
      }
      db.prepare("UPDATE package SET stopped_at = NULL WHERE id = ?").run(id);
      setPart(id, part, { state: "waiting", error: null });
      reopenFrom(r, part);
      generate(id);
      return { changed: true, package: view(row(id)!) };
    },

    async undoChange(id, changeId) { return toggleChange(id, changeId, true); },
    async redoChange(id, changeId) { return toggleChange(id, changeId, false); },

    async fitCv(id, choiceId) {
      const r = mustGet(id);
      if (choiceId === "choose-again" && r.cvVersion?.keepTwoPages) {
        saveVersion(id, { ...r.cvVersion, keepTwoPages: false });
        reopenFrom(r, "cv");
        return { changed: true, package: view(row(id)!) };
      }
      const offered = cvVersionView(r)?.fit.choices ?? [];
      if (!r.cvVersion || !offered.some((c) => c.id === choiceId)) {
        return { changed: false, reason: "That isn't one of the ways offered to fit this CV on one page.", package: view(r) };
      }
      if (choiceId === keepTwoPages) {
        saveVersion(id, { ...r.cvVersion, keepTwoPages: true });
        return { changed: true, package: view(row(id)!) };
      }
      const change = tightenChange(choiceId, planOf(r), byId(), () => crypto.randomUUID());
      if (!change) return { changed: false, reason: "That isn't one of the ways offered to fit this CV on one page.", package: view(r) };
      saveVersion(id, { ...r.cvVersion, changes: [...r.cvVersion.changes, change] });
      reopenFrom(r, "cv");
      await renderCv(id);
      return { changed: true, package: view(row(id)!) };
    },

    async cvFile(id) {
      const r = row(id);
      if (!r?.cvDraft) return null;
      const pdf = await deps.packages.read(r.cvDraft.path);
      return pdf ? { fileName: r.cvDraft.fileName, pdf } : null;
    },

    decideFlag,
    answerGap,
    learned,

  };
}
