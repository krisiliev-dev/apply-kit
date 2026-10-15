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
// The cover letter (#65) is written after the CV, in Kris's voice, from the CV as decided; its
// drafts are kept and paged, Kris's edits teach the voice, and it is checked (letter.ts) and printed
// with the CV's letterhead.
// Screening answers (#66): the target posting's questions (screening.ts), each answered from the
// answer bank, adapted from it (whole sentences removed to fit, nothing added), newly drafted by the
// drafter (honesty-checked, citing pieces, within the form's limit) or left for Kris; salary always
// waits for Kris. The same drafter answers Apply's needs-you questions (`draftAnswer`).
import { angleLabel, type Angle } from "../fit/angles.ts";
import { evidenceLabel, matchEvidence, type RequirementCategory } from "../fit/evidence.ts";
import type { AiBudget, BudgetInfo } from "../budget.ts";
import type { Clock, SqlDatabase } from "../ports.ts";
import type { CvContent, DocumentDate, DocumentLanguage, DocumentToRender, Letterhead } from "../documents/content.ts";
import { checkAts, type AtsCheck, type AtsCheckId } from "../documents/ats.ts";
import type { CoachTurnInput, DraftAnswerInput, SentExcerpt, TailorCvInput, TailoredCv, WriteLetterInput, Writer } from "../writing/writer.ts";
import type { AnswerLanguage, AnswerStore } from "./answers.ts";
import {
  euros, fits, formQuestions, heardFrom, isHeardQuestion, isSalaryQuestion, monthlyRange, suggestSalary, trimToFit, wordCount,
  type AnswerLimit, type FormQuestion, type PostingSalary, type QuestionType,
} from "./screening.ts";
import type { AngleChoice, AnglePosting } from "./angles.ts";
import {
  applyChanges, decisionsOf, deriveChanges, flagView, honestyChecks, keepTwoPages, offers, openReason, placesOnCv, tightenChange, tightenChoices,
  type CvChange, type CvFlag, type CvFlagView, type CvLineView, type CvPlan, type CvVersionState, type EvidenceRow, type HonestyCheckView, type PieceLink, type TightenChoice,
} from "./cv-version.ts";
import { checkWording, validateCv, type HonestyProfile } from "./honesty.ts";
import { nearTheLine, type NearTheLine, type SkippedQuestion } from "./interview.ts";
import type { Contact } from "./contact.ts";
import type { FileStore, PackageFolder, PdfText } from "./ports.ts";
import { atsCheckLabel, atsStepView, postingKeywords, type AtsFixField, type AtsStepView } from "./ats-step.ts";
import type { ApprovedPackage, CvEntryAsSent, FrozenFile } from "./contracts.ts";
import { portalJobReference } from "./portal.ts";
import { createHash } from "node:crypto";
import { entryLabel, type PieceInput, type PieceKind, type PieceOrigin, type ProfilePiece, type SavePieceResult } from "./profile.ts";
import type { DocumentDraft, DraftRequest } from "./engine.ts";
import {
  bodyParagraphs, bodyWords, checkLetter, emptyLetter, forCompanyCount, forCompanyPlaces, fromWritten, LETTER_WORDS, letterText, mentions, parseLetterText,
  type LetterCheck, type LetterDraft,
} from "./letter.ts";
import { wordCount as voiceWords, type VoiceContext, type VoiceContextRequest, type VoiceEditInput } from "./voice.ts";

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
  /** About how many screening answers a form needs drafted, for the cost estimate. */
  draftsExpected: 3,
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
  /** The posting's reading, for salary's range (#66); null until it's read. */
  screening?: { salary: PostingSalary | null } | null;
  postings: {
    id: string;
    site: string;
    url: string;
    /** When Discover first saw it, for "How did you hear about us?". */
    firstSeenAt?: string;
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

/** The CV's draft as stored: its view, and the text read back from it (for the ATS step). */
type CvDraftStored = CvDraftView & { text?: PdfText; document?: Extract<DocumentToRender, { kind: "cv" }> };

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

/** The cover letter's printed draft: the exact PDF, for the draft it was printed from. */
export interface LetterFileView {
  fileName: string;
  path: string;
  sha256: string;
  size: number;
  pages: number;
  overflow: DocumentDraft["overflow"];
  draft: number;
}

/** One of the letter's checks. A problem stops Approve; a warning is advice. */
export interface LetterCheckView {
  id: "trace" | "decisions" | "gaps" | "stock" | "example";
  state: "ok" | "problem" | "warning";
  label: string;
  /** What's wrong and where, in plain words; null when it passes. */
  detail: string | null;
}

/** The cover letter: the draft shown, its text, highlights, word count, checks, the voice it was written with and its file. */
export interface LetterView {
  /** The draft shown (the one approved and printed), from 1, and how many there are. Earlier ones are kept. */
  draft: number;
  drafts: number;
  /** Written by the writer, or by Kris herself ("Write it myself"). */
  origin: "writer" | "own";
  /** What Kris asked this draft for; null for the first. */
  instruction: string | null;
  /** As Kris edits it: the greeting, the paragraphs and the closing, separated by blank lines. */
  text: string;
  greeting: string;
  /** The body as sentences, each marked when it was written for this company. */
  paragraphs: { text: string; forCompany: boolean }[][];
  closing: string;
  words: number;
  target: number;
  /** The sentences written for this company, counted and named in words (highlights are never only a colour). */
  forCompany: { count: number; where: string | null };
  checks: LetterCheckView[];
  /** What the voice was learned from, and exactly what this draft sent. */
  voice: { samples: number; edits: number; sent: { text: string; from: string }[]; sentWords: number };
  /** Quick instructions for a new draft. */
  quick: string[];
  /** The printed draft; null until it's printed. */
  file: LetterFileView | null;
  /** When Kris last changed it, if she did. */
  editedAt: string | null;
}

/** A piece learned from Kris's answer inside a package, waiting in Profile › Learned during packages. */
export interface LearnedPiece {
  piece: ProfilePiece;
  /** The employer (or school) of the role it sits under, if any. */
  under: string | null;
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

/** Where a screening answer came from: the bank as it is, adapted from it, newly drafted, waiting for Kris, or translated from the bank. */
export type ScreeningOrigin = "bank" | "adapted" | "new" | "needs-you" | "translated";

/** Why an answer waits for Kris. */
export type ScreeningNeed = "salary" | "ask" | "missing" | "choose" | "failed" | "budget" | "too-long" | "unsafe" | "translated";

/** Salary's question: never filled from the bank. The posting's range, the floor, the last answer and the rule's suggestion. */
export interface SalaryView {
  /** "€2,800–3,600 gross", or null when the posting states none. */
  range: string | null;
  floor: number | null;
  last: { amount: number; company: string } | null;
  suggested: number | null;
  /** The rule in Kris's words, from the answer bank. */
  rule: string | null;
  /** All of it in one line, as the step shows it. */
  text: string;
}

export interface ScreeningAnswerView {
  id: string;
  question: string;
  required: boolean;
  type: QuestionType;
  options: string[];
  limit: AnswerLimit;
  origin: ScreeningOrigin;
  /** The origin as its chip says it: "Answer bank", "Answer bank · adapted", "New draft", "New · from your sources", "Needs you", "Translated · check it". */
  label: string;
  text: string;
  words: number;
  /** True while it waits for Kris (Approve waits for it). */
  needsYou: boolean;
  /** Set when Kris answered or confirmed it herself. */
  yours: boolean;
  /** What to know about it, in plain words (where it came from, why it waits). */
  note: string;
  /** An adapted answer: exactly the sentences removed, and that nothing was added. */
  changed: { removed: string[]; note: string } | null;
  /** The pieces a drafted answer rests on. */
  pieces: PieceLink[];
  salary: SalaryView | null;
  /** The bank's answer it came from, with its use. */
  bank: { answerId: string; useCount: number; lastUsedAt: string | null } | null;
  /** Whether "Save to answer bank" is offered (never for company-specific answers), and once saved, the bank answer. */
  save: { offered: boolean; note: string | null; savedTo: string | null };
  /** "Write another draft" is offered (a paragraph the drafter can write). */
  redraft: boolean;
}

export interface ScreeningAnswersView {
  from: "form" | "standard";
  site: string;
  /** Why the form's own questions couldn't be read, when they couldn't. */
  problem: string | null;
  /** "6 questions from kestrel.greenhouse.io, in the form's order · 3 from your answer bank · 2 new drafts · 1 needs you." */
  summary: string;
  questions: ScreeningAnswerView[];
  /** The first answer Approve waits for, and why ("1 answer needs you: salary"); null when none. */
  waiting: { questionId: string; reason: string } | null;
}

/** What Apply's drafter answers: the text and the pieces it rests on, or why it couldn't. */
export type DraftAnswerResult =
  | { drafted: true; text: string; pieces: PieceLink[]; companySpecific: boolean; costUsd: number }
  | { drafted: false; reason: string };

export interface DraftAnswerRequest {
  question: string;
  /** The package's language when left out. */
  language?: DocumentLanguage;
  maxChars?: number | null;
  maxWords?: number | null;
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
  /** The cover letter, once a draft exists. */
  letter: LetterView | null;
  /** The screening answers, once they're written. */
  answers: ScreeningAnswersView | null;
  /** The ATS check of the CV's PDF, once the CV is approved. */
  ats: AtsStepView | null;
  /** The package as approved, with its frozen files; null while a step is open (after an edit too). */
  approved: ApprovedPackage | null;
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
  /** The voice, as the letter uses it: the context a draft sends, Kris's edits as evidence, and where excerpts came from. */
  voice: {
    context: (request: VoiceContextRequest) => VoiceContext;
    saveEdit: (edit: VoiceEditInput, previous: string | null) => string | null;
    learnedFrom: () => { samples: number; edits: number };
    sourceLabel: (source: string) => string;
  };
  /** The answer bank, for the screening answers. */
  answers: Pick<AnswerStore, "find" | "get" | "save" | "recordUse" | "list">;
  /** For the target posting's form (the Greenhouse and Ashby questions APIs). Missing: the standard questions. */
  fetch?: typeof fetch;
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
  /** A new letter draft with Kris's instruction; the earlier drafts are kept. */
  redraftLetter(id: string, instruction: string): Promise<ChangeResult>;
  /** Shows another draft: the one approved and printed. */
  showLetterDraft(id: string, draft: number): Promise<ChangeResult>;
  /** Kris's text for a draft: saved, printed, and recorded as voice evidence unless learning is paused. */
  editLetter(id: string, draft: number, text: string): Promise<ChangeResult>;
  /** An empty draft with the greeting and closing, for Kris to write herself. */
  writeLetterYourself(id: string): Promise<ChangeResult>;
  /** The letter's draft PDF, as printed from the draft shown. */
  letterFile(id: string): Promise<{ fileName: string; pdf: Uint8Array } | null>;
  /** Pieces learned in packages that wait for Kris (unconfirmed or near the line), newest first. */
  learned(): LearnedPiece[];
  /** Kris's answer to a screening question (her salary number, an option, her own words), checked against the form. */
  setAnswer(id: string, questionId: string, text: string): ChangeResult;
  /** "Write another draft" for a paragraph question. */
  redraftAnswer(id: string, questionId: string): Promise<ChangeResult>;
  /** "Save to answer bank": a reusable answer becomes a screening answer in the bank; a company-specific one never does. */
  saveAnswerToBank(id: string, questionId: string): ChangeResult;
  /** The drafter, for Apply's needs-you questions: honesty-checked, citing pieces, within the limit and the monthly cap. */
  draftAnswer(id: string, request: DraftAnswerRequest): Promise<DraftAnswerResult>;
  /** Approves the package (step 5's Approve) and freezes its files as the next version. */
  approvePackage(id: string, options?: { acceptFailingChecks?: boolean }): Promise<ApproveResult>;
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

/** A question as a reason names it: its first few words. */
const shortQuestion = (q: string) => {
  const t = q.replace(/\([^)]*\)/g, "").replace(/[?.:]\s*$/, "").trim();
  return t.length <= 40 ? lower(t) : `${lower(t.slice(0, 37).replace(/\s+\S*$/, ""))}…`;
};

/** One screening question's answer as stored with the package. */
interface ScreeningAnswer {
  id: string;
  question: string;
  required: boolean;
  type: QuestionType;
  options: string[];
  limit: AnswerLimit;
  origin: ScreeningOrigin;
  /** Why it waits for Kris; null when it doesn't. */
  needs: ScreeningNeed | null;
  text: string;
  pieceIds: string[];
  bank: { answerId: string } | null;
  /** An adapted answer's removed sentences. */
  removed: string[];
  companySpecific: boolean;
  /** Answered from where the job was first seen. */
  heard?: boolean;
  note: string;
  /** Kris answered or confirmed it herself, and when. */
  yours: boolean;
  at: string | null;
  /** The bank answer it was saved as. */
  savedTo: string | null;
}

interface ScreeningState {
  from: "form" | "standard";
  site: string;
  problem: string | null;
  language: DocumentLanguage;
  answers: ScreeningAnswer[];
}

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
    targetPostingId: string; photo: boolean; approved: Partial<Record<PackageStep, string>>; reviewed: boolean; cvDraft: CvDraftStored | null;
    cvVersion: CvVersionState | null; screening: ScreeningState | null; startedAt: string; stoppedAt: string | null; letterDraft: number | null; letterFile: LetterFileView | null;
    approvedVersion: number | null; atsAccepted: AtsCheckId[]; contactFix: Partial<Record<AtsFixField, string>>;
  }
  interface PartRow { part: PackageStep; state: PartState; attempts: number; error: string | null; costUsd: number; output: unknown }

  const toRow = (r: Record<string, unknown>): Row => ({
    id: String(r.id), jobId: String(r.job_id), job: JSON.parse(String(r.job)) as PackageJob, angle: r.angle as Angle,
    angleReason: String(r.angle_reason), language: r.language as DocumentLanguage, targetPostingId: String(r.target_posting_id),
    photo: Number(r.photo) === 1, approved: JSON.parse(String(r.approved)) as Row["approved"], reviewed: r.reviewed_at != null,
    cvDraft: r.cv_draft == null ? null : (JSON.parse(String(r.cv_draft)) as CvDraftStored),
    cvVersion: r.cv_version == null ? null : (JSON.parse(String(r.cv_version)) as CvVersionState),
    screening: r.screening == null ? null : (JSON.parse(String(r.screening)) as ScreeningState),
    startedAt: String(r.started_at), stoppedAt: r.stopped_at == null ? null : String(r.stopped_at),
    letterDraft: r.letter_draft == null ? null : Number(r.letter_draft),
    letterFile: r.letter_file == null ? null : (JSON.parse(String(r.letter_file)) as LetterFileView),
    approvedVersion: r.approved_version == null ? null : Number(r.approved_version),
    atsAccepted: JSON.parse(String(r.ats_accepted)) as AtsCheckId[],
    contactFix: r.contact_fix == null ? {} : (JSON.parse(String(r.contact_fix)) as Row["contactFix"]),
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

  const modelParts: PackageStep[] = ["cv", "letter", "answers"];
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
      case "letter": {
        const l = currentLetter(r);
        return p.state === "working" ? "In your voice · writing from your CV and profile"
          : p.state === "done" && l ? `Draft ${l.number} · ${bodyWords(l.content)} words${l.origin === "own" ? ", written by you" : ""}`
          : p.state === "failed" ? `Not written: ${p.error ?? "the model didn't answer"}. The rest is saved.`
          : p.state === "stopped" ? "Stopped before it was written. Write it again, or write it yourself."
          : p.state === "not-written" ? "Not written: this month's AI budget would be crossed."
          : "In your voice, once the CV is written";
      }
      case "answers": {
        const a = r.screening?.answers ?? [];
        const fromBank = a.filter((x) => x.origin === "bank" || x.origin === "adapted").length;
        return p.state === "working" ? "Reading the form's questions and drafting answers"
          : p.state === "done" ? `${a.length === 1 ? "1 question" : `${a.length} questions`} · ${fromBank} from your answer bank`
          : p.state === "failed" ? `Not written: ${p.error ?? "the model didn't answer"}. The rest is saved.`
          : p.state === "stopped" ? "Stopped before they were written. Generate them again when you like."
          : p.state === "not-written" ? "Not written: this month's AI budget would be crossed."
          : "From the target posting's form";
      }
      case "ats": {
        const checks = r.cvDraft?.ats?.checks ?? [];
        return p.state === "done" ? `${checks.filter((c) => c.passed).length} of ${checks.length} checks pass · on this laptop`
          : "Reads the CV PDF once you approve the CV. Runs on this laptop, no model needed.";
      }
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
  function blockOf(r: Row, ps: Map<PackageStep, PartRow>, step: PackageStep): { reason: string; by: PackageStep; flag?: string; question?: string } | null {
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
        const waiting = step === "answers" ? waitingAnswer(r) : null;
        if (waiting) return { reason: waiting.reason, by: step, question: waiting.questionId };
        if (step === "cv" && r.cvDraft?.overflow && !r.cvVersion?.keepTwoPages) {
          return { reason: `This CV runs onto ${r.cvDraft.pages} pages. Choose how to fit one page, or keep ${r.cvDraft.pages}.`, by: step };
        }
        if (step === "letter") return letterBlock(r);
        if (step === "ats") return atsBlock(r);
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
      const letter = step === "letter" && p.state === "done" ? currentLetter(r) : null;
      const toFix = letter ? letterChecks(r, letter).filter((c) => c.state === "problem").length : 0;
      const needs = step === "answers" && p.state === "done" ? openAnswers(r).length : 0;
      const failing = step === "ats" && p.state === "done" ? failingChecks(r).length : 0;
      const [state, sub]: [StepState, string] = approvedAt ? ["done", "Approved"]
        : open ? [step === current ? "current" : "flagged", open === 1 ? "1 flag" : `${open} flags`]
        : needs ? [step === current ? "current" : "flagged", `${needs} need${needs === 1 ? "s" : ""} you`]
        : flags.length && step === current ? ["current", "Flags decided"]
        : toFix ? [step === current ? "current" : "flagged", `${toFix} to fix`]
        : failing ? [step === current ? "current" : "flagged", `${failing} check${failing === 1 ? "" : "s"} fail${failing === 1 ? "s" : ""}`]
        : p.state === "working" ? ["working", "Writing…"]
        : p.state === "failed" ? ["failed", "Failed"]
        : step === current ? ["current", p.state === "done" ? (step === "target" ? "Choose" : step === "letter" ? "Review" : "Ready to check") : p.state === "later" ? "Not built yet" : "Not written"]
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
      cv: r.cvDraft && cvDraftView(r.cvDraft),
      cvVersion: cvVersionView(r),
      letter: letterView(r),
      answers: answersView(r),
      ats: atsView(r, ps),
      approved: r.approvedVersion === null ? null : versionOf(r.id, r.approvedVersion),
      costUsd: Math.round(list.reduce((n, p) => n + p.costUsd, 0) * 1e6) / 1e6,
      estimate: {
        // Each part's own task: the CV's tailoring, the letter, and a few drafted screening answers.
        costUsd: Math.round(toWrite.reduce((n, p) => n + estimateOf(r, p.part), 0) * 1e6) / 1e6,
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

  /** The letterhead the CV and the letter share: Kris's name for the language, the current title, the contact details. */
  function letterheadOf(r: Row): Letterhead {
    const plan = planOf(r);
    const pieces = byId();
    const contact = deps.contact();
    const first = plan.roles.map((role) => pieces.get(role.roleId)?.entry).find((e) => e);
    // Facts Kris gave the ATS fix for this package only fill what the profile lacks.
    const fix = r.contactFix;
    return {
      name: r.language === "bg" && contact.nameCyrillic ? contact.nameCyrillic : contact.nameLatin,
      headline: first?.title ?? "",
      location: [contact.city || fix.city, contact.country || fix.country].filter(Boolean).join(", ") || undefined,
      email: contact.email,
      phone: contact.phone || fix.phone || undefined,
      links: contact.links.map((l) => l.replace(/^https?:\/\//, "").replace(/\/$/, "")),
    };
  }

  /** The CV through its template: the plan's words, with roles' and education's facts exactly as in the profile. */
  async function cvDocument(r: Row): Promise<DocumentToRender> {
    const plan = planOf(r);
    const pieces = byId();
    const contact = deps.contact();
    const entries = plan.roles.map((role) => ({ role, entry: pieces.get(role.roleId)?.entry })).filter((x) => x.entry);
    const letterhead = letterheadOf(r);
    const name = letterhead.name;
    const content: CvContent = {
      letterhead,
      summary: plan.summary?.text ?? "",
      experience: entries.map(({ role, entry }) => ({
        title: entry!.title,
        employer: entry!.organisation,
        place: entry!.city ?? undefined,
        start: month(entry!.start),
        end: entry!.end ? month(entry!.end) : "present",
        bullets: role.bullets.map((b) => b.text),
      })),
      skills: plan.skills.map((id) => plan.skillWords?.[id] ?? pieces.get(id)?.text ?? "").filter(Boolean),
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
      skills: plan.skills.filter((id) => pieces.has(id)).map((id) => line(plan.skillWords?.[id] ?? pieces.get(id)!.text, [id])),
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

  /**
   * The posting keywords the ATS check looks for: the skill and certificate requirements. A gap Kris
   * chose to name in the letter or leave out, and a preferred item she doesn't hold, are deliberate.
   */
  function keywordsOf(r: Row) {
    const flags = r.cvVersion?.flags ?? [];
    const now = clock.now();
    return postingKeywords(r.job.requirements.map((q, i) => {
      const decided = flags.find((f) => f.kind === "gap" && f.requirement === i)?.decision?.option;
      const notHeld = q.kind === "preferred" && matchEvidence({ text: q.text, kind: "preferred", category: q.category ?? "other" }, deps.pieces(), now).status === "not-held";
      const gap = decided === "letter" ? "a deliberate gap, named in the letter" : decided === "leave-out" ? "a deliberate gap, left out" : notHeld ? "preferred, and not claimed" : null;
      return { text: q.text, category: q.category, gap };
    }));
  }

  /** Prints the CV and keeps it as the package's draft, with the text read back for the ATS check. */
  async function renderCv(id: string): Promise<void> {
    const r = row(id)!;
    const document = await cvDocument(r);
    const draft = await deps.draftDocument({
      packageId: id,
      document,
      fileName: { name: deps.contact().nameLatin, company: r.job.company, role: r.job.title },
      keywords: keywordsOf(r),
    });
    const cv: CvDraftStored = {
      fileName: draft.fileName, path: draft.path, sha256: draft.sha256, size: draft.size, pages: draft.pages,
      overflow: draft.overflow, ats: draft.ats, language: r.language, photo: r.photo,
      // What the ATS check reads (the photo aside: parsers skip it), so it can run again as decisions change.
      text: draft.text, document: document.kind === "cv" ? { ...document, content: { ...document.content, photo: undefined } } : undefined,
    };
    db.prepare("UPDATE package SET cv_draft = ? WHERE id = ?").run(JSON.stringify(cv), id);
  }

  const cvDraftView = ({ text: _text, document: _document, ...view }: CvDraftStored): CvDraftView => view;

  /** The ATS check over the CV's PDF as read back, with the posting keywords as Kris's decisions stand now. */
  function atsCheckOf(r: Row): AtsCheck | null {
    const cv = r.cvDraft;
    if (!cv?.text || !cv.document) return cv?.ats ?? null;
    return checkAts({ text: cv.text, document: cv.document, fileName: cv.fileName, keywords: keywordsOf(r) });
  }

  /** The ATS checks that fail now and that Kris hasn't accepted knowingly. */
  const failingChecks = (r: Row) => (atsCheckOf(r)?.checks ?? []).filter((c) => !c.passed && !r.atsAccepted.includes(c.check));

  /** Why the package can't be approved at the ATS check: a check fails (Kris may accept it knowingly). */
  function atsBlock(r: Row): { reason: string; by: PackageStep; failing: AtsCheckId[] } | null {
    const failing = failingChecks(r);
    if (!failing.length) return null;
    const names = failing.map((c) => lower(atsCheckLabel[c.check])).join(", ");
    return { reason: `${failing.length === 1 ? "1 check fails" : `${failing.length} checks fail`}: ${names}. Fix it, or approve knowing it fails.`, by: "ats", failing: failing.map((c) => c.check) };
  }

  /** Contact details the CV's letterhead lacks (in the profile and in this package), which the ATS check's fix asks for. */
  function missingContact(r: Row): AtsFixField[] {
    const c = deps.contact();
    const has = (f: AtsFixField) => !!(c[f].trim() || r.contactFix[f]?.trim());
    return (["phone", "city", "country"] as const).filter((f) => !has(f));
  }

  /** The ATS step: shown once the CV is approved, over the CV's current PDF. */
  function atsView(r: Row, ps: Map<PackageStep, PartRow>): AtsStepView | null {
    const cv = r.cvDraft;
    if (ps.get("ats")!.state !== "done" || !cv?.text || !cv.document) return null;
    return atsStepView({
      ats: atsCheckOf(r)!, text: cv.text, headings: cv.document.content.experience.map((x) => `${x.title} · ${x.employer}`), missing: missingContact(r), accepted: r.atsAccepted,
    });
  }

  // ---- the cover letter (#65) ---------------------------------------------------------------

  interface LetterRow {
    number: number; origin: "writer" | "own"; instruction: string | null; written: LetterDraft | null; content: LetterDraft;
    excerpts: SentExcerpt[]; voiceEditId: string | null; costUsd: number; createdAt: string; editedAt: string | null;
  }
  const toLetter = (x: Record<string, unknown>): LetterRow => ({
    number: Number(x.number), origin: x.origin as LetterRow["origin"], instruction: x.instruction == null ? null : String(x.instruction),
    written: x.written == null ? null : (JSON.parse(String(x.written)) as LetterDraft), content: JSON.parse(String(x.content)) as LetterDraft,
    excerpts: JSON.parse(String(x.excerpts)) as SentExcerpt[], voiceEditId: x.voice_edit_id == null ? null : String(x.voice_edit_id),
    costUsd: Number(x.cost_usd), createdAt: String(x.created_at), editedAt: x.edited_at == null ? null : String(x.edited_at),
  });
  const letters = (id: string) => db.prepare("SELECT * FROM package_letter WHERE package_id = ? ORDER BY number").all(id).map(toLetter);
  const letterOf = (id: string, n: number | null) => {
    const x = n === null ? undefined : db.prepare("SELECT * FROM package_letter WHERE package_id = ? AND number = ?").get(id, n);
    return x ? toLetter(x) : null;
  };
  const currentLetter = (r: Row) => letterOf(r.id, r.letterDraft);

  /** Keeps a new draft (earlier ones stay) and shows it. */
  function addLetter(id: string, draft: Omit<LetterRow, "number" | "voiceEditId" | "createdAt" | "editedAt">): number {
    const n = Number(db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM package_letter WHERE package_id = ?").get(id)!.n);
    db.prepare(
      `INSERT INTO package_letter (package_id, number, origin, instruction, written, content, excerpts, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, n, draft.origin, draft.instruction, draft.written && JSON.stringify(draft.written), JSON.stringify(draft.content), JSON.stringify(draft.excerpts), draft.costUsd, clock.now().toISOString());
    db.prepare("UPDATE package SET letter_draft = ? WHERE id = ?").run(n, id);
    return n;
  }

  /** The gaps Kris chose to name in the letter, by their requirement's words. */
  const namedGaps = (r: Row) => (r.cvVersion?.flags ?? []).filter((f) => f.kind === "gap" && f.decision?.option === "letter")
    .map((f) => requirementText(r, f)).filter((t): t is string => !!t);

  /** What the letter is written from: the posting, the voice, the CV as decided, the gaps to name and the pieces. */
  function letterInput(r: Row, voice: { rules: string[]; excerpts: SentExcerpt[] }, instruction: string | null, previous: string | null): WriteLetterInput {
    const plan = planOf(r);
    return {
      posting: { title: r.job.title, company: r.job.company, requirements: r.job.requirements.map((q) => q.text) },
      language: r.language,
      words: LETTER_WORDS,
      voice: voice.rules,
      excerpts: voice.excerpts,
      cv: { summary: plan.summary?.text ?? null, lines: plan.roles.flatMap((x) => x.bullets.map((b) => ({ text: b.text, pieceIds: b.pieceIds }))) },
      gaps: namedGaps(r),
      pieces: tailorInput(r).pieces,
      instruction,
      previous,
    };
  }

  /** The letter's checks against the profile, the CV's decisions and the gaps Kris chose to name or leave out. */
  function letterChecks(r: Row, l: LetterRow): LetterCheck[] {
    const flags = r.cvVersion?.flags ?? [];
    const decisions = flags.filter((f) => f.draft && f.decision?.text && f.decision.option !== "experience")
      .map((f) => ({ chosen: f.decision!.text!, draft: f.draft!, pieceIds: f.pieceIds, piece: f.piece }));
    const gapAt = new Set(flags.filter((f) => f.kind === "gap").map((f) => f.requirement));
    const leftOut = flags.filter((f) => f.kind === "gap" && f.decision?.option === "leave-out").map((f) => requirementText(r, f)).filter((t): t is string => !!t);
    // Besides the profile, the letter may name the company, the role and what the posting asks for (gaps only as gaps).
    const alsoNamed = [r.job.company, r.job.title, ...r.job.requirements.filter((_, i) => !gapAt.has(i)).map((q) => q.text)];
    return checkLetter(l.content, { profile: { ...honestyProfile(r), alsoNamed }, decisions, named: namedGaps(r), leftOut, language: r.language });
  }

  /** Why the letter can't be approved: no draft, an empty one, a check's problem, or more than one page. */
  function letterBlock(r: Row): { reason: string; by: PackageStep } | null {
    const l = currentLetter(r);
    if (!l) return { reason: "There's no cover letter to approve yet.", by: "letter" };
    if (bodyWords(l.content) === 0) return { reason: "The letter is empty. Write it, or ask for a draft.", by: "letter" };
    const problem = letterChecks(r, l).find((c) => c.state === "problem");
    if (problem) return { reason: `The cover letter can't be approved yet: ${problem.because}`, by: "letter" };
    const file = r.letterFile?.draft === l.number ? r.letterFile : null;
    if (file?.overflow) return { reason: `The letter runs onto ${file.pages} pages. Shorten it to fit one.`, by: "letter" };
    return null;
  }

  function estimateOf(r: Row, part: PackageStep): number {
    if (part === "cv") return deps.writer.estimateCostUsd({ task: "tailor-cv", input: tailorInput(r) });
    if (part === "letter") return deps.writer.estimateCostUsd({ task: "write-letter", input: letterInput(r, { rules: [], excerpts: [] }, null, null) });
    if (part === "answers") return deps.writer.estimateCostUsd({ task: "draft-answer", input: draftInput(r, "", { words: null, chars: null }, null) }) * packageRules.draftsExpected;
    return 0;
  }

  /**
   * One letter call within the cap. The voice context (rules and excerpts) is taken, and recorded as
   * sent, only once the call goes ahead.
   */
  async function letterCall(id: string, instruction: string | null, previous: string | null) {
    const r = row(id)!;
    return deps.budget.call({ task: "write-letter", estimateUsd: estimateOf(r, "letter") }, () => {
      const voice = deps.voice.context({ language: r.language, purpose: "cover-letter" });
      return deps.writer.writeLetter(letterInput(r, { rules: voice.rules.map((x) => x.text), excerpts: voice.excerpts }, instruction, previous));
    });
  }

  function letterView(r: Row): LetterView | null {
    const l = currentLetter(r);
    if (!l) return null;
    const learned = deps.voice.learnedFrom();
    const sent = l.excerpts.map((e) => ({ text: e.text, from: deps.voice.sourceLabel(e.source) }));
    return {
      draft: l.number,
      drafts: letters(r.id).length,
      origin: l.origin,
      instruction: l.instruction,
      text: letterText(l.content),
      greeting: l.content.greeting,
      paragraphs: l.content.paragraphs.map((p) => p.map((x) => ({ text: x.text, forCompany: x.forCompany }))),
      closing: l.content.closing,
      words: bodyWords(l.content),
      target: LETTER_WORDS,
      forCompany: { count: forCompanyCount(l.content), where: forCompanyPlaces(l.content) },
      checks: letterChecks(r, l).map(({ id, state, label, detail }) => ({ id, state, label, detail })),
      voice: { samples: learned.samples, edits: learned.edits, sent, sentWords: sent.reduce((n, e) => n + voiceWords(e.text), 0) },
      quick: [
        ...namedGaps(r).filter((gap) => !mentions(bodyParagraphs(l.content).join(" "), gap)).map((gap) => `Name the ${gap} gap`),
        "Shorter", "More direct",
      ],
      file: r.letterFile && r.letterFile.draft === l.number ? r.letterFile : null,
      editedAt: l.editedAt,
    };
  }

  /** The letter through its template: the CV's letterhead, the date, recipient and "Re:" line from the job, and Kris's words. */
  function letterDocument(r: Row, d: LetterDraft): DocumentToRender {
    const letterhead = letterheadOf(r);
    return {
      kind: "cover-letter",
      language: r.language,
      title: `${letterhead.name} · Cover letter · ${r.job.company}`,
      content: {
        letterhead,
        date: clock.now().toISOString().slice(0, 10),
        recipient: { company: r.job.company, place: r.job.location ?? undefined },
        re: { role: r.job.title },
        greeting: d.greeting,
        paragraphs: d.paragraphs.map((p) => p.map((x) => x.text).join(" ")),
        closing: d.closing,
      },
    };
  }

  /** Prints the draft shown and keeps it as the package's letter draft. */
  async function renderLetter(id: string): Promise<void> {
    const r = row(id)!;
    const l = currentLetter(r);
    if (!l) return;
    const draft = await deps.draftDocument({
      packageId: id,
      document: letterDocument(r, l.content),
      fileName: { name: deps.contact().nameLatin, company: r.job.company, role: r.job.title },
    });
    const file: LetterFileView = { fileName: draft.fileName, path: draft.path, sha256: draft.sha256, size: draft.size, pages: draft.pages, overflow: draft.overflow, draft: l.number };
    db.prepare("UPDATE package SET letter_file = ? WHERE id = ?").run(JSON.stringify(file), id);
  }

  // ---- generating ----------------------------------------------------------------------------

  const stopped = (id: string) => row(id)?.stoppedAt != null;
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  /**
   * Writes a part: its model call (retried once on failure) within the cap, then `keep` with the
   * answer (which prints the PDF). A part that would cross the cap isn't started.
   */
  async function writePart<T>(
    id: string, part: PackageStep,
    call: () => Promise<{ refused: true } | { refused: false; result: { output: T; costUsd: number; excerpts: SentExcerpt[] } }>,
    keep: (written: { output: T; costUsd: number; excerpts: SentExcerpt[] }) => void,
    print: () => Promise<void>,
  ): Promise<void> {
    let { attempts, costUsd } = parts(id).get(part)!;
    setPart(id, part, { state: "working", error: null });
    for (let tries = 0; tries < packageRules.attempts; tries++) {
      if (stopped(id)) return;
      attempts += 1;
      let outcome;
      try {
        outcome = await call();
      } catch (err) {
        const billed = (err as { costUsd?: unknown } | null)?.costUsd;
        if (typeof billed === "number" && billed > 0) costUsd += billed;
        const last = tries === packageRules.attempts - 1;
        if (stopped(id)) { setPart(id, part, { attempts, costUsd, error: message(err) }); return; }
        setPart(id, part, { attempts, costUsd, error: message(err), ...(last && { state: "failed" }) });
        if (last) return;
        continue;
      }
      if (outcome.refused) {
        setPart(id, part, { state: "not-written", attempts: attempts - 1, error: null });
        return;
      }
      costUsd += outcome.result.costUsd;
      // Stopped while the model was writing: the call is paid for, but its answer isn't used.
      if (stopped(id)) { setPart(id, part, { attempts, costUsd }); return; }
      setPart(id, part, { attempts, costUsd, output: outcome.result.output });
      keep(outcome.result);
      try {
        await print();
      } catch (err) {
        setPart(id, part, { state: "failed", error: `The PDF couldn't be printed: ${message(err)}` });
        return;
      }
      setPart(id, part, { state: "done", error: null });
      return;
    }
  }

  /** The CV part: the tailoring, checked by the honesty validator, then printed. */
  const writeCv = (id: string) => writePart(id, "cv", () => {
    const input = tailorInput(row(id)!);
    return deps.budget.call({ task: "tailor-cv", estimateUsd: deps.writer.estimateCostUsd({ task: "tailor-cv", input }) }, () => deps.writer.tailorCv(input));
  }, (written) => keepTailored(id, written.output), () => renderCv(id));

  /** The letter part: the first draft, in Kris's voice, from the CV as it stands. */
  const writeLetter = (id: string) => writePart(id, "letter", () => letterCall(id, null, null), (written) => {
    addLetter(id, { origin: "writer", instruction: null, written: fromWritten(written.output), content: fromWritten(written.output), excerpts: written.excerpts, costUsd: written.costUsd });
  }, () => renderLetter(id));

  function generate(id: string): void {
    // Parts about to be written show as working at once, so the package never looks idle.
    for (const part of modelParts) if (parts(id).get(part)!.state === "waiting") setPart(id, part, { state: "working" });
    const before = running.get(id) ?? Promise.resolve();
    const run = before.then(async () => {
      for (const part of modelParts) {
        const state = parts(id).get(part)!.state;
        if (state !== "working" || stopped(id)) continue;
        await (part === "cv" ? writeCv(id) : part === "letter" ? writeLetter(id) : writeAnswers(id));
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
      screening: job.screening?.salary ? { salary: { min: job.screening.salary.min, max: job.screening.salary.max, currency: job.screening.salary.currency, period: job.screening.salary.period, basis: job.screening.salary.basis } } : null,
      postings: job.postings.map((p) => ({
        id: p.id, site: p.site, url: p.url, ...(p.firstSeenAt ? { firstSeenAt: p.firstSeenAt } : {}),
        source: { name: p.source.name, kind: p.source.kind, label: p.source.label, category: p.source.category },
      })),
      target: { postingId: job.target.postingId },
    };
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO package (id, job_id, job, angle, angle_reason, language, target_posting_id, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, job.id, JSON.stringify(snapshot), angle.angle, angle.reason, job.packageLanguage, target?.id ?? "", now);
      const initial: Record<PackageStep, PartState> = { target: "done", cv: "waiting", letter: "waiting", answers: "waiting", ats: "waiting" };
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
    // The package is a draft again: its approved version stays as it was, frozen; the next approval is a new one.
    db.prepare("UPDATE package SET approved = ?, approved_version = NULL, ats_accepted = '[]' WHERE id = ?").run(JSON.stringify(approved), r.id);
    // The ATS check reads the approved CV: a CV open again waits for approval before it's checked.
    if (from <= packageSteps.indexOf("cv")) setPart(r.id, "ats", { state: "waiting" });
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
      return { ...common, kind: "add-skill", pieceId: place.pieceId, text, label: "Skill added from your answer", why: "From your answer to the gap question. Used for this job only until you confirm it in Profile." };
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
    // Read again: another answer may have finished while the coach was writing this one.
    const current = row(id)!.cvVersion!;
    const earlier = current.flags?.find((x) => x.id === f.id)?.related ?? null;
    const next = current.flags!.filter((x) => x.id !== earlier)
      .map((x) => (x.id === f.id ? { ...x, answer: said, related: fresh.id, decision: { option: "experience", text: said, at } } : x));
    // The new flag sits right after its gap.
    next.splice(next.findIndex((x) => x.id === f.id) + 1, 0, fresh);
    return saveFlags(row(id)!, next, current.changes.filter((c) => !earlier || c.flagId !== earlier));
  }

  function learned(): LearnedPiece[] {
    const pieces = new Map(deps.pieces().map((p) => [p.id, p]));
    return db.prepare("SELECT pp.*, p.job FROM package_piece pp JOIN package p ON p.id = pp.package_id ORDER BY pp.created_at DESC, pp.rowid DESC").all()
      .flatMap((x) => {
        const piece = pieces.get(String(x.piece_id));
        if (!piece || piece.status === "confirmed") return [];
        const job = JSON.parse(String(x.job)) as PackageJob;
        return [{
          piece, under: (piece.belongsTo && pieces.get(piece.belongsTo)?.entry?.organisation) || null, packageId: String(x.package_id), jobId: job.id, job: `${job.titleTranslation ?? job.title} at ${job.company}`, company: job.company,
          question: String(x.question), answer: String(x.answer), learnedAt: String(x.created_at),
          // Near the line only while Kris hasn't chosen a wording for it.
          nearTheLine: x.near != null && piece.status === "flagged" ? (JSON.parse(String(x.near)) as NearTheLine) : null,
        }];
      });
  }

  // ---- the cover letter's operations (#65) ----------------------------------------------------

  /** Adds a call's cost to the letter part. */
  const chargeLetter = (id: string, usd: number) => setPart(id, "letter", { costUsd: parts(id).get("letter")!.costUsd + usd });

  async function redraftLetter(id: string, instruction: string): Promise<ChangeResult> {
    const r = mustGet(id);
    const refuse = (reason: string): ChangeResult => ({ changed: false, reason, package: view(row(id)!) });
    const said = instruction.trim();
    if (!said) return refuse("Say what to change, or pick one of the quick instructions.");
    if (parts(id).get("letter")!.state === "working") return refuse("The letter is still being written. Ask for a new draft once it's there.");
    const current = currentLetter(r);
    const kept = current ? ` Draft ${current.number} is kept.` : "";
    let outcome;
    try {
      outcome = await letterCall(id, said, current ? letterText(current.content) : null);
    } catch (err) {
      const billed = (err as { costUsd?: unknown } | null)?.costUsd;
      if (typeof billed === "number" && billed > 0) chargeLetter(id, billed);
      return refuse(`The new draft wasn't written: ${message(err)}.${kept} Try again, or edit this one yourself.`);
    }
    if (outcome.refused) return refuse(`This month's AI budget would be crossed, so a new draft can't be written now.${kept} Edit it, or write it yourself.`);
    const written = outcome.result;
    chargeLetter(id, written.costUsd);
    addLetter(id, { origin: "writer", instruction: said, written: fromWritten(written.output), content: fromWritten(written.output), excerpts: written.excerpts, costUsd: written.costUsd });
    setPart(id, "letter", { state: "done", error: null });
    reopenFrom(r, "letter");
    await renderLetter(id);
    return { changed: true, package: view(row(id)!) };
  }

  async function showLetterDraft(id: string, draft: number): Promise<ChangeResult> {
    const r = mustGet(id);
    if (!letterOf(id, draft)) return { changed: false, reason: `There's no draft ${draft}.`, package: view(r) };
    if (draft !== r.letterDraft) {
      db.prepare("UPDATE package SET letter_draft = ? WHERE id = ?").run(draft, id);
      reopenFrom(r, "letter");
      await renderLetter(id);
    }
    return { changed: true, package: view(row(id)!) };
  }

  async function writeLetterYourself(id: string): Promise<ChangeResult> {
    const r = mustGet(id);
    if (parts(id).get("letter")!.state === "working") return { changed: false, reason: "The letter is still being written. Stop generating first, or wait for it.", package: view(r) };
    addLetter(id, { origin: "own", instruction: null, written: null, content: emptyLetter(r.job.company, r.language), excerpts: [], costUsd: 0 });
    setPart(id, "letter", { state: "done", error: null });
    reopenFrom(r, "letter");
    await renderLetter(id);
    return { changed: true, package: view(row(id)!) };
  }

  async function editLetter(id: string, draft: number, text: string): Promise<ChangeResult> {
    const r = mustGet(id);
    const l = letterOf(id, draft);
    if (!l) return { changed: false, reason: `There's no draft ${draft}.`, package: view(r) };
    const content = parseLetterText(text, l.content);
    if (letterText(content) === letterText(l.content) && draft === r.letterDraft) return { changed: true, package: view(r) };
    // Kris's changes to what the writer wrote teach the voice, kept as one piece of evidence per draft.
    const voiceEdit = l.written
      ? deps.voice.saveEdit({ purpose: "cover-letter", language: r.language, before: letterText(l.written), after: letterText(content), source: `package:${id}` }, l.voiceEditId)
      : l.voiceEditId;
    db.prepare("UPDATE package_letter SET content = ?, voice_edit_id = ?, edited_at = ? WHERE package_id = ? AND number = ?")
      .run(JSON.stringify(content), voiceEdit, clock.now().toISOString(), id, draft);
    db.prepare("UPDATE package SET letter_draft = ? WHERE id = ?").run(draft, id);
    reopenFrom(r, "letter");
    await renderLetter(id);
    return { changed: true, package: view(row(id)!) };
  }

  // ---- screening answers (#66) -----------------------------------------------------------------

  /** Answers still waiting for Kris, in the form's order. */
  const openAnswers = (r: Row) => (r.screening?.answers ?? []).filter((a) => a.needs && !a.yours);

  /** What Approve waits for on the screening answers: the first answer that needs Kris. */
  function waitingAnswer(r: Row): { questionId: string; reason: string } | null {
    const open = openAnswers(r);
    if (!open.length) return null;
    const names = open.map((a) => (a.needs === "salary" ? "salary" : shortQuestion(a.question)));
    return { questionId: open[0]!.id, reason: `${open.length === 1 ? "1 answer needs" : `${open.length} answers need`} you: ${names.join(", ")}` };
  }

  /** Writes the package's screening answers: the form's questions, then an answer for each. */
  async function writeAnswers(id: string): Promise<void> {
    const before = parts(id).get("answers")!;
    let costUsd = before.costUsd;
    let attempts = before.attempts;
    setPart(id, "answers", { state: "working", error: null });
    const r = row(id)!;
    const target = r.job.postings.find((p) => p.id === r.targetPostingId) ?? null;
    const form = await formQuestions(target, r.language, deps.fetch);
    // Kris's own answers stay when the questions are read again in the same language.
    const kept = r.screening && r.screening.language === r.language ? r.screening.answers.filter((a) => a.yours) : [];
    const answers: ScreeningAnswer[] = [];
    for (const q of form.questions) {
      if (stopped(id)) return;
      const mine = kept.find((a) => a.id === q.id && a.question === q.question);
      if (mine) { answers.push(mine); continue; }
      const a = await answerFor(row(id)!, q);
      costUsd += a.costUsd;
      attempts += a.calls;
      answers.push(a.answer);
    }
    // Stopped while the last draft was written: it's paid for, but not used.
    if (stopped(id)) { setPart(id, "answers", { attempts, costUsd }); return; }
    const state: ScreeningState = { from: form.from, site: form.from === "form" ? target?.site ?? "" : "", problem: form.problem, language: r.language, answers };
    db.prepare("UPDATE package SET screening = ? WHERE id = ?").run(JSON.stringify(state), id);
    setPart(id, "answers", { state: "done", attempts, costUsd, error: null });
  }

  /** Writes the answers again (new target posting or language); an approved answers step reopens. */
  function rewriteAnswers(id: string): void {
    const p = parts(id).get("answers")!;
    if (p.state === "working" || p.state === "waiting") return;
    setPart(id, "answers", { state: "waiting", error: null });
    generate(id);
  }

  const bankRule = () => deps.answers.list({ pageSize: 10_000 }).answers.find((a) => a.rule?.params?.kind === "salary") ?? null;

  /** The last salary Kris gave in another package, for salary's question. */
  function lastSalary(id: string): { amount: number; company: string } | null {
    let best: { amount: number; company: string; at: string } | null = null;
    for (const x of db.prepare("SELECT id, job, screening FROM package WHERE id != ? AND screening IS NOT NULL").all(id)) {
      const state = JSON.parse(String(x.screening)) as ScreeningState;
      for (const a of state.answers) {
        if (a.needs !== "salary" || !a.yours || !a.text || !a.at) continue;
        if (!best || a.at > best.at) best = { amount: Number(a.text), company: (JSON.parse(String(x.job)) as PackageJob).company, at: a.at };
      }
    }
    return best && { amount: best.amount, company: best.company };
  }

  /** The package's language as the answer bank names it. */
  const bankLanguage = (r: Row): AnswerLanguage => r.language;

  /** A question without the form's notes in brackets, for finding it in the bank. */
  const plainQuestion = (q: string) => q.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

  /** An option of the form that says the same as the bank's answer, ignoring case. */
  const optionFor = (q: FormQuestion, value: string) => q.options.find((o) => o.toLowerCase() === value.trim().toLowerCase()) ?? null;

  const blank = (q: FormQuestion): Omit<ScreeningAnswer, "origin" | "needs" | "text" | "note"> => ({
    id: q.id, question: q.question, required: q.required, type: q.type, options: q.options, limit: q.limit,
    pieceIds: [], bank: null, removed: [], companySpecific: false, yours: false, savedTo: null, at: null,
  });

  /** One question's answer, and what drafting it cost. */
  async function answerFor(r: Row, q: FormQuestion): Promise<{ answer: ScreeningAnswer; costUsd: number; calls: number }> {
    const base = blank(q);
    const done = (answer: ScreeningAnswer, costUsd = 0, calls = 0) => ({ answer, costUsd, calls });
    const needs = (need: ScreeningNeed, note: string, extra: Partial<ScreeningAnswer> = {}) => done({ ...base, origin: "needs-you", needs: need, text: "", note, ...extra });
    if (isSalaryQuestion(q.question)) return needs("salary", "Salary depends on the job, so you decide it each time. The number itself is never saved to the answer bank.");

    const language = bankLanguage(r);
    const match = deps.answers.find(plainQuestion(q.question), language);
    if (match) {
      const bank = { answerId: match.answerId };
      const fill = match.fill;
      if (fill.action === "ask") return needs("ask", `Your answer bank asks you each time${fill.rule ? `: ${fill.rule.text}` : ""}.`, { bank });
      if (fill.action === "leave-blank") {
        const value = q.required && fill.whenRequired ? (q.type === "select" ? optionFor(q, fill.whenRequired) ?? "" : fill.whenRequired) : "";
        return done({ ...base, bank, origin: "bank", needs: null, text: value, note: value ? "A voluntary question the form requires: answered \"Prefer not to say\"." : "Left blank: a voluntary question." });
      }
      if (fill.action === "fill") {
        if (q.type === "select") {
          const option = optionFor(q, fill.value);
          return option ? done({ ...base, bank, origin: "bank", needs: null, text: option, note: "From your answer bank." })
            : needs("choose", `Your answer bank says "${fill.value}", which isn't one of the form's options. Choose one.`, { bank });
        }
        if (fits(fill.value, q.limit)) return done({ ...base, bank, origin: "bank", needs: null, text: fill.value, note: "From your answer bank." });
        const trimmed = trimToFit(fill.value, q.limit);
        if (!trimmed) return needs("too-long", "Your answer bank's answer is longer than the form allows, even its first sentence. Shorten it here.", { bank });
        const n = trimmed.removed.length;
        return done({ ...base, bank, origin: "adapted", needs: null, text: trimmed.text, removed: trimmed.removed, note: `Your answer, trimmed by ${n === 1 ? "1 sentence" : `${n} sentences`} to fit. No facts added.` });
      }
      // The bank has it only in another language: a translation, for Kris to check.
      const other = fill.languages[0]!;
      const source = deps.answers.get(match.answerId)?.versions[other] ?? "";
      if (q.type === "long-text" || q.type === "text") {
        const d = await draft(r, q.question, q.limit, { language: other, text: source });
        if (!d.ok) return { answer: { ...base, bank, origin: "needs-you", needs: d.need, text: "", note: d.note }, costUsd: d.costUsd, calls: d.calls };
        return { answer: { ...base, bank, origin: "translated", needs: "translated", text: d.text, pieceIds: d.pieceIds, note: `Translated from your ${other === "bg" ? "Bulgarian" : "English"} answer: check it, then confirm.` }, costUsd: d.costUsd, calls: d.calls };
      }
      return needs("choose", `Your answer bank has this only in ${other === "bg" ? "Bulgarian" : "English"}. Choose an option.`, { bank });
    }

    if (isHeardQuestion(q.question)) {
      const first = [...r.job.postings].sort((a, b) => (a.firstSeenAt ?? "9999").localeCompare(b.firstSeenAt ?? "9999"))[0];
      const value = heardFrom(first, q.options);
      const when = first?.firstSeenAt ? ` on ${new Date(first.firstSeenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "";
      const seen = first ? (first.source.category === "email" ? `a ${first.source.label} alert` : first.site) : "";
      if (value) return done({ ...base, origin: "new", needs: null, text: value, note: `First seen in ${seen}${when}.`, heard: true });
    }
    if (q.type === "select") return needs("choose", "Not in your answer bank. Choose an option.");
    if (q.type === "text") return needs("missing", "Not in your answer bank. Answer it here; you can save it to the bank.");

    const d = await draft(r, q.question, q.limit, null);
    if (!d.ok) return { answer: { ...base, origin: "needs-you", needs: d.need, text: "", note: d.note }, costUsd: d.costUsd, calls: d.calls };
    return {
      answer: { ...base, origin: "new", needs: null, text: d.text, pieceIds: d.pieceIds, companySpecific: d.companySpecific, note: "Drafted from your profile." },
      costUsd: d.costUsd, calls: d.calls,
    };
  }

  function draftInput(r: Row, question: string, limit: AnswerLimit, translate: DraftAnswerInput["translate"]): DraftAnswerInput {
    const state = r.cvVersion;
    return {
      question,
      job: { title: r.job.title, company: r.job.company, requirements: r.job.requirements.map((q) => q.text) },
      language: r.language,
      limit,
      pieces: tailorInput(r).pieces,
      decisions: state ? decisionsOf(state.flags ?? [], (f) => flagView(f, requirementText(r, f)).title).map((d) => `${d.title}: ${d.decision}`) : [],
      translate,
    };
  }

  type Drafted =
    | { ok: true; text: string; pieceIds: string[]; companySpecific: boolean; costUsd: number; calls: number }
    | { ok: false; need: ScreeningNeed; note: string; costUsd: number; calls: number };

  /**
   * The drafter: one answer from the pieces (or a translation of the bank's), tried twice on failure,
   * within the cap. A stronger claim gives way to its honest wording; an answer the honesty rules
   * refuse, or one that can't be trimmed to the limit, is never offered.
   */
  async function draft(r: Row, question: string, limit: AnswerLimit, translate: DraftAnswerInput["translate"]): Promise<Drafted> {
    const input = draftInput(r, question, limit, translate);
    let costUsd = 0;
    let calls = 0;
    let error = "";
    for (let tries = 0; tries < packageRules.attempts; tries++) {
      let outcome;
      calls += 1;
      try {
        outcome = await deps.budget.call({ task: "draft-answer", estimateUsd: deps.writer.estimateCostUsd({ task: "draft-answer", input }) }, () => deps.writer.draftAnswer(input));
      } catch (err) {
        const billed = (err as { costUsd?: unknown } | null)?.costUsd;
        if (typeof billed === "number" && billed > 0) costUsd += billed;
        error = message(err);
        continue;
      }
      if (outcome.refused) return { ok: false, need: "budget", note: "Not drafted: this month's AI budget would be crossed. Write it yourself.", costUsd, calls: calls - 1 };
      costUsd += outcome.result.costUsd;
      const out = outcome.result.output;
      const profile = honestyProfile(r);
      const text = out.claim === "stronger" ? out.honest?.trim() ?? "" : out.text.trim();
      if (!text || checkWording(text, out.pieceIds, profile).length) {
        return { ok: false, need: "unsafe", note: "The draft claimed more than your profile backs, so it isn't offered. Write it yourself, or ask for another draft.", costUsd, calls };
      }
      const trimmed = fits(text, limit) ? { text } : trimToFit(text, limit);
      if (!trimmed) return { ok: false, need: "too-long", note: "The draft didn't fit the form's limit. Write it yourself, or ask for another draft.", costUsd, calls };
      const company = r.job.company.toLowerCase();
      const companySpecific = out.companySpecific || trimmed.text.toLowerCase().includes(company) || question.toLowerCase().includes(company);
      return { ok: true, text: trimmed.text, pieceIds: out.pieceIds, companySpecific, costUsd, calls };
    }
    return { ok: false, need: "failed", note: `The draft failed (${error}). Write it yourself, or ask for another draft.`, costUsd, calls };
  }

  function salaryView(r: Row): SalaryView {
    const range = monthlyRange(r.job.screening?.salary ?? null);
    const rule = bankRule();
    const params = rule?.rule?.params ?? null;
    const floor = params?.floor ?? null;
    const last = lastSalary(r.id);
    const suggested = suggestSalary(range, floor);
    const rangeText = range ? `${euros(range.low)}–${range.high.toLocaleString("en-GB")}${range.basis === "not-stated" ? "" : ` ${range.basis}`}` : null;
    const parts = [
      rangeText ? `Posting range ${rangeText}` : "The posting states no range",
      floor ? `your minimum ${euros(floor)}` : null,
      last ? `last asked at ${last.company}: ${euros(last.amount)}` : null,
    ].filter(Boolean);
    const suggestion = suggested !== null
      ? ` Suggested ${euros(suggested)} by your answer-bank rule (${rule?.rule?.text.toLowerCase() ?? "upper half of a stated range"}).`
      : rule ? " Your rule needs a stated range, so it has nothing to suggest." : "";
    return { range: rangeText, floor, last, suggested, rule: rule?.rule?.text ?? null, text: `${parts.join(" · ")}.${suggestion}` };
  }

  const originLabel = (a: ScreeningAnswer): string =>
    a.origin === "bank" ? "Answer bank" : a.origin === "adapted" ? "Answer bank · adapted" : a.origin === "translated" ? "Translated · check it"
      : a.origin === "needs-you" ? "Needs you" : a.heard ? "New · from your sources" : "New draft";

  function answersView(r: Row): ScreeningAnswersView | null {
    const s = r.screening;
    if (!s || parts(r.id).get("answers")!.state !== "done") return null;
    const pieces = byId();
    const link = (pid: string): PieceLink | null => { const p = pieces.get(pid); return p ? evidenceLabel(p) : null; };
    const questions = s.answers.map((a): ScreeningAnswerView => {
      const banked = a.bank ? deps.answers.get(a.bank.answerId) : null;
      const reusable = !a.companySpecific && (a.origin === "new" || a.origin === "needs-you" || a.origin === "translated") && a.needs !== "salary" && !a.heard;
      return {
        id: a.id, question: a.question, required: a.required, type: a.type, options: a.options, limit: a.limit,
        origin: a.origin, label: originLabel(a), text: a.text, words: wordCount(a.text), needsYou: !!a.needs && !a.yours, yours: a.yours,
        note: a.companySpecific ? `${a.note} Written for this company: not saved to the answer bank.` : a.note,
        changed: a.origin === "adapted" ? { removed: a.removed, note: "Your answer bank keeps the full version." } : null,
        pieces: a.pieceIds.map(link).filter((l): l is PieceLink => l !== null),
        salary: a.needs === "salary" ? salaryView(r) : null,
        bank: banked ? { answerId: banked.id, useCount: banked.useCount, lastUsedAt: banked.lastUsedAt } : null,
        save: { offered: reusable && !a.savedTo, note: a.companySpecific ? "Written for this company: not saved to the answer bank." : null, savedTo: a.savedTo },
        redraft: a.type === "long-text" && (a.origin === "new" || a.origin === "needs-you") && a.needs !== "salary" && !a.heard,
      };
    });
    const fromBank = s.answers.filter((a) => a.origin === "bank" || a.origin === "adapted").length;
    const drafts = s.answers.filter((a) => a.origin === "new" || a.origin === "translated").length;
    const needs = openAnswers(r).length;
    const where = s.from === "form" ? `from ${s.site}, in the form's order` : "most forms ask";
    const count = `${s.answers.length === 1 ? "1 question" : `${s.answers.length} questions`}`;
    return {
      from: s.from, site: s.site, problem: s.problem,
      summary: `${count} ${where} · ${fromBank} from your answer bank · ${drafts === 1 ? "1 new draft" : `${drafts} new drafts`} · ${needs} need${needs === 1 ? "s" : ""} you.`,
      questions,
      waiting: waitingAnswer(r),
    };
  }

  const saveScreening = (id: string, s: ScreeningState) => db.prepare("UPDATE package SET screening = ? WHERE id = ?").run(JSON.stringify(s), id);

  /** The answers with one question's answer replaced; an approved answers step reopens. */
  function putAnswer(r: Row, a: ScreeningAnswer): ChangeResult {
    saveScreening(r.id, { ...r.screening!, answers: r.screening!.answers.map((x) => (x.id === a.id ? a : x)) });
    reopenFrom(r, "answers");
    return { changed: true, package: view(row(r.id)!) };
  }

  function setAnswer(id: string, questionId: string, text: string): ChangeResult {
    const r = mustGet(id);
    const refuse = (reason: string): ChangeResult => ({ changed: false, reason, package: view(r) });
    const a = r.screening?.answers.find((x) => x.id === questionId);
    if (!a) return refuse("That question isn't in this package's screening answers.");
    let value = text.trim();
    if (!value && a.required) return refuse("The form requires an answer to this question.");
    if (a.needs === "salary" && value) {
      const n = Number(value.replace(/[€\s,.]/g, ""));
      if (!Number.isFinite(n) || n <= 0 || !/^[€\s\d,.]+$/.test(value)) return refuse("Give one number: the form takes a number, not a range.");
      value = String(n);
    }
    if (a.type === "select" && value) {
      const option = optionFor(a, value);
      if (!option) return refuse("Choose one of the form's options.");
      value = option;
    }
    if (!fits(value, a.limit)) {
      return refuse(a.limit.words !== null && wordCount(value) > a.limit.words
        ? `The form takes at most ${a.limit.words} words; this is ${wordCount(value)}.`
        : `The form takes at most ${a.limit.chars} characters; this is ${value.length}.`);
    }
    return putAnswer(r, { ...a, text: value, yours: true, at: clock.now().toISOString() });
  }

  async function redraftAnswer(id: string, questionId: string): Promise<ChangeResult> {
    const r = mustGet(id);
    const a = r.screening?.answers.find((x) => x.id === questionId);
    if (!a || a.type !== "long-text" || a.needs === "salary" || a.heard) return { changed: false, reason: "There's nothing to draft for that question.", package: view(r) };
    const d = await draft(r, a.question, a.limit, null);
    const p = parts(id).get("answers")!;
    setPart(id, "answers", { costUsd: p.costUsd + d.costUsd });
    if (!d.ok) return { changed: false, reason: d.note, package: view(row(id)!) };
    return putAnswer(row(id)!, {
      ...a, origin: "new", needs: null, text: d.text, pieceIds: d.pieceIds, companySpecific: d.companySpecific, removed: [], bank: null,
      note: "Drafted from your profile.", yours: false, savedTo: null, at: null,
    });
  }

  function saveAnswerToBank(id: string, questionId: string): ChangeResult {
    const r = mustGet(id);
    const refuse = (reason: string): ChangeResult => ({ changed: false, reason, package: view(r) });
    const a = r.screening?.answers.find((x) => x.id === questionId);
    if (!a) return refuse("That question isn't in this package's screening answers.");
    if (a.companySpecific) return refuse(`Written for ${r.job.company}: answers like this are written fresh for each job, so they aren't saved to the answer bank.`);
    if (a.needs === "salary") return refuse("Salary depends on the job, so the number is never saved to the answer bank.");
    if (a.origin === "bank" || a.origin === "adapted" || a.heard) return refuse("This answer comes from your answer bank or your sources already.");
    if (a.savedTo) return refuse("It's in your answer bank already.");
    if (!a.text) return refuse("Answer it first.");
    const saved = deps.answers.save(
      { question: plainQuestion(a.question), versions: { [bankLanguage(r)]: a.text }, category: "screening", kind: a.type === "select" ? "choice" : "text" },
      { from: `${r.job.company} package`, jobId: r.jobId },
    );
    if (!saved.saved) return refuse(saved.problems[0]!.message);
    saveScreening(id, { ...r.screening!, answers: r.screening!.answers.map((x) => (x.id === a.id ? { ...x, savedTo: saved.answer.id } : x)) });
    return { changed: true, package: view(row(id)!) };
  }

  async function draftAnswer(id: string, request: DraftAnswerRequest): Promise<DraftAnswerResult> {
    const r = mustGet(id);
    const question = request.question.trim();
    if (!question) return { drafted: false, reason: "Give the question to draft an answer for." };
    const limit = { words: request.maxWords ?? null, chars: request.maxChars ?? null };
    const d = await draft({ ...r, language: request.language ?? r.language }, question, limit, null);
    if (!d.ok) return { drafted: false, reason: d.note };
    const pieces = byId();
    return {
      drafted: true, text: d.text, companySpecific: d.companySpecific, costUsd: d.costUsd,
      pieces: d.pieceIds.map((pid) => pieces.get(pid)).filter((p): p is ProfilePiece => !!p).map(evidenceLabel),
    };
  }

  // ---- approving the package (#67) ---------------------------------------------------------

  const toApproved = (x: Record<string, unknown>): ApprovedPackage => {
    const snapshot = JSON.parse(String(x.snapshot)) as ApprovedPackage;
    const submitted = x.submitted_at == null ? null
      : { at: String(x.submitted_at), via: x.submitted_via as "extension" | "app", portalUrl: x.portal_url == null ? null : String(x.portal_url) };
    return { ...snapshot, state: submitted ? "submitted" : "approved", submitted };
  };

  function versionOf(id: string, version: number): ApprovedPackage | null {
    const x = db.prepare("SELECT * FROM package_version WHERE package_id = ? AND version = ?").get(id, version);
    return x ? toApproved(x) : null;
  }

  const entryAsSent = (e: { title: string; organisation: string; city: string | null; start: string; end: string | null }): CvEntryAsSent =>
    ({ title: e.title, organisation: e.organisation, place: e.city, start: e.start, end: e.end });

  /** The package as Apply and Track read it, frozen with its files at approval. */
  function snapshotOf(r: Row, version: number, at: string, files: { cv: FrozenFile; letter: FrozenFile | null }, accepted: AtsCheckId[]): ApprovedPackage {
    const plan = planOf(r);
    const pieces = byId();
    const target = r.job.postings.find((p) => p.id === r.targetPostingId);
    const checks = atsCheckOf(r)?.checks ?? [];
    const letter = currentLetter(r);
    const decisions = [
      ...decisionsOf(r.cvVersion?.flags ?? [], (f) => flagView(f, requirementText(r, f)).title).map(({ title, decision }) => ({ title, decision })),
      ...accepted.map((c) => ({ title: `ATS check: ${lower(atsCheckLabel[c])}`, decision: "Fails; approved knowing it does" })),
    ];
    return {
      id: r.id, jobId: r.jobId, version, state: "approved", approvedAt: at, submitted: null,
      job: { title: r.job.titleTranslation ?? r.job.title, company: r.job.company },
      targetPosting: { url: target?.url ?? "", site: target?.site ?? "", jobRef: target ? portalJobReference(target.url) : null },
      language: r.language,
      angle: r.angle,
      cv: {
        label: `${angleLabel[r.angle]} · ${r.job.company}`,
        file: files.cv,
        ats: { passed: checks.filter((c) => c.passed).length, total: checks.length, accepted },
        skills: plan.skills.map((sid) => plan.skillWords?.[sid] ?? pieces.get(sid)?.text ?? "").filter(Boolean),
        roles: plan.roles.map((x) => pieces.get(x.roleId)?.entry).filter((e) => !!e).map(entryAsSent),
        education: plan.education.map((x) => pieces.get(x)?.entry).filter((e) => !!e).map(entryAsSent),
      },
      letter: letter && files.letter ? { text: letterText(letter.content), file: files.letter } : null,
      answers: (r.screening?.answers ?? []).filter((a) => a.text).map((a) => ({ question: a.question, answer: a.text })),
      decisions,
    };
  }

  /**
   * Approves the package: every step approved and the ATS check passing (or its failing checks
   * accepted knowingly). The CV and letter PDFs are frozen by SHA-256 as the next version.
   */
  async function approvePackage(id: string, { acceptFailingChecks = false }: { acceptFailingChecks?: boolean } = {}): Promise<ApproveResult> {
    const r = mustGet(id);
    if (r.approvedVersion !== null) return { approved: true, package: view(r) };
    const block = blockOf(r, parts(id), "ats");
    const ats = atsBlock(r);
    const acceptable = acceptFailingChecks && ats && block?.reason === ats.reason;
    if (block && !acceptable) return { approved: false, reason: block.reason, blockedBy: block.by, flagId: block.flag ?? null, package: view(r) };
    const refuse = (reason: string): ApproveResult => ({ approved: false, reason, blockedBy: "ats", flagId: null, package: view(row(id)!) });
    const cvBytes = r.cvDraft ? await deps.packages.read(r.cvDraft.path) : null;
    if (!r.cvDraft || !cvBytes) return refuse("The CV's PDF isn't there to freeze. Print it again: undo and redo a change, or Retry the CV.");
    const letter = currentLetter(r);
    const letterFile = letter && r.letterFile?.draft === letter.number ? r.letterFile : null;
    const letterBytes = letterFile ? await deps.packages.read(letterFile.path) : null;
    if (letter && !letterBytes) return refuse("The cover letter's PDF isn't there to freeze. Show the draft again to print it.");

    const version = Number(db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM package_version WHERE package_id = ?").get(id)!.v);
    const freeze = async (fileName: string, bytes: Uint8Array): Promise<FrozenFile> => {
      const { path, copy } = await deps.packages.freeze(id, version, fileName, bytes);
      return { fileName, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength, path, copy };
    };
    const files = { cv: await freeze(r.cvDraft.fileName, cvBytes), letter: letterFile && letterBytes ? await freeze(letterFile.fileName, letterBytes) : null };
    const now = clock.now().toISOString();
    const current = row(id)!;
    const accepted = acceptable ? [...new Set([...current.atsAccepted, ...ats.failing])] : current.atsAccepted;
    const snapshot = snapshotOf(current, version, now, files, accepted);
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO package_version (package_id, version, approved_at, snapshot) VALUES (?, ?, ?, ?)").run(id, version, now, JSON.stringify(snapshot));
      db.prepare("UPDATE package SET approved = ?, approved_version = ?, ats_accepted = ? WHERE id = ?")
        .run(JSON.stringify({ ...current.approved, ats: now }), version, JSON.stringify(accepted), id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return { approved: true, package: view(row(id)!) };
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
      // Step 5's Approve is the package's: it freezes the files.
      if (step === "ats") return { approved: false, reason: "Approve the package to finish: approving it freezes the files.", blockedBy: "ats", flagId: null, package: view(r) };
      const now = clock.now().toISOString();
      db.prepare("UPDATE package SET approved = ?, reviewed_at = COALESCE(reviewed_at, ?) WHERE id = ?").run(JSON.stringify({ ...r.approved, [step]: now }), now, id);
      // The ATS check runs on the approved CV's PDF, on this laptop.
      if (step === "cv") setPart(id, "ats", { state: "done", error: null });
      // The bank's answers this package uses count as used once Kris approves them.
      if (step === "answers") for (const a of r.screening?.answers ?? []) if (a.bank && a.text) deps.answers.recordUse(a.bank.answerId);
      return { approved: true, package: view(row(id)!) };
    },

    setTarget(id, postingId) {
      const r = mustGet(id);
      if (!r.job.postings.some((p) => p.id === postingId)) return { changed: false, reason: "That posting isn't one of this job's.", package: view(r) };
      if (postingId !== r.targetPostingId) {
        db.prepare("UPDATE package SET target_posting_id = ? WHERE id = ?").run(postingId, id);
        reopenFrom(r, "target");
        // The questions come from the posting Kris applies through.
        rewriteAnswers(id);
      }
      return { changed: true, package: view(row(id)!) };
    },

    async setLanguage(id, language) {
      const r = mustGet(id);
      if (language !== r.language) {
        db.prepare("UPDATE package SET language = ? WHERE id = ?").run(language, id);
        reopenFrom(r, "target");
        // The CV is printed again in the new language, and the answers written again in it.
        if (parts(id).get("cv")!.state === "done") await renderCv(id);
        if (currentLetter(row(id)!)) await renderLetter(id);
        rewriteAnswers(id);
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
    redraftLetter,
    showLetterDraft,
    editLetter,
    writeLetterYourself,
    async letterFile(id) {
      const r = row(id);
      const file = r?.letterFile;
      if (!file || file.draft !== r.letterDraft) return null;
      const pdf = await deps.packages.read(file.path);
      return pdf ? { fileName: file.fileName, pdf } : null;
    },
    setAnswer,
    redraftAnswer,
    saveAnswerToBank,
    draftAnswer,
    approvePackage,

  };
}
