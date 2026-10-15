// The preparation engine: Prepare's deep module, beside the discovery engine and sharing its
// database, clock, settings and AI budget. It will own the master profile, angles, answer bank,
// voice, imports, the coach interview and packages (spec #51); each ticket adds its operations here.
import { createHash } from "node:crypto";
import { migrate } from "../schema.ts";
import type { BudgetInfo } from "../budget.ts";
import { defaultSearchSettings, type SearchSettings } from "../search-settings.ts";
import { defaultAnswers } from "./answer-defaults.ts";
import { createAnswerStore, type Answer, type AnswerChange, type AnswerInput, type AnswerLanguage, type AnswerList, type AnswerMatch, type AnswerQuery, type AnswerOrigin, type PortalEditInput, type SaveAnswerResult } from "./answers.ts";
import { createContactStore, type Contact, type ContactDetails, type PhotoInput, type SaveContactResult } from "./contact.ts";
import { createImportStore, type ImportInput, type ImportMerge, type ImportRun, type ImportStatus, type ResolveResult, type StartImportResult, type UnreadableChoice } from "./import.ts";
import { createAngleStore, type AngleChoice, type AnglePosting, type AngleView, type SaveAngleInput, type SaveAngleResult } from "./angles.ts";
import { createSetupStore, experienceOf, maxYearsFor, type ConfirmGroupResult, type DraftFilter, type DraftsToCheck, type SearchSuggestion, type SetupProgress, type SetupStep, type SetupSummary } from "./setup.ts";
import { createVoiceStore, type VoiceContext, type VoiceContextRequest, type VoiceEditInput, type VoiceLearning, type VoiceSample, type VoiceSampleFile, type VoiceSend, type VoiceView } from "./voice.ts";
import { createInterviewStore, type FinishInterviewResult, type InterviewChange, type InterviewView, type SkippedQuestion } from "./interview.ts";
import type { Angle } from "../fit/angles.ts";
import { createProfileStore, type DisputeChoice, type DeletedPiece, type PieceInput, type ProfilePiece, type PieceList, type PieceOrigin, type PieceQuery, type ProfileSummary, type SavePieceResult } from "./profile.ts";

/** The whole profile as one portable file: every piece with its source, the contact details and photo. */
export interface ProfileExport {
  format: "apply-kit master profile";
  version: 1;
  exportedAt: string;
  contact: Omit<Contact, "photo"> & { photo: (NonNullable<Contact["photo"]> & { base64: string }) | null };
  pieces: ProfilePiece[];
  /** Every source pieces came from (a file, a conversation, Kris by hand), with how many pieces each gave. */
  sources: { from: string; pieces: number }[];
}

import { checkAts, type AtsCheck, type AtsKeyword } from "../documents/ats.ts";
import { documentFileName, type FileNameParts } from "../documents/file-names.ts";
import type { DocumentToRender } from "../documents/content.ts";
import { demoDocument, demoFileName, type DemoOptions } from "../documents/demo.ts";
import type { PdfText, PreparationDeps } from "./ports.ts";
import {
  createPackageStore, type ApproveResult, type ChangeResult, type DraftAnswerRequest, type DraftAnswerResult, type FlagChoice, type LearnedPiece, type PackageChip, type PackageJob, type PackageStep, type PackageView,
  type PrepareStatus, type StartPackageResult, type AtsFix,
} from "./packages.ts";
import type { DocumentLanguage } from "../documents/content.ts";
import type { ApprovedPackage, FrozenFile, MarkSubmittedResult, PackageForApply, ProfileForApply, SubmittedVia } from "./contracts.ts";

export interface DraftRequest {
  packageId: string;
  document: DocumentToRender;
  /** What the file is named after: Kris's name (Latin), the company and the role. */
  fileName: FileNameParts;
  /** The target posting's keywords, for the ATS check (CV only). */
  keywords?: AtsKeyword[];
}

export interface DocumentDraft {
  /** ASCII, "Name_CV_Company_Role.pdf". */
  fileName: string;
  /** Where the draft is, relative to the data folder. */
  path: string;
  pdf: Uint8Array;
  sha256: string;
  size: number;
  /** Read from the PDF itself. */
  pages: number;
  /** Set when the content ran past one page: reported, never fixed by shrinking type or margins. */
  overflow: { pages: number; linesAfterFirstPage: number } | null;
  /** The text read back from the PDF, the way a parser reads it. */
  text: PdfText;
  /** The parse check over that text; CVs only (null for a cover letter). */
  ats: AtsCheck | null;
}

export interface PreparationEngine {
  /** This month's AI spending against the cap, shared with Discover, so Prepare can say when a part must wait. */
  budget(): BudgetInfo;

  /**
   * Adds a piece (no id) or saves an edit to one, after the honesty checks. A refused piece comes back
   * with every problem, each tied to its field, and one-click honest fixes where there are any.
   * Kris's own pieces are confirmed; import, the coach and packages pass where theirs came from.
   */
  savePiece(input: PieceInput, origin?: PieceOrigin): SavePieceResult;
  /**
   * Deletes a piece. Pieces under a deleted role stay, tied to no role. Packages already approved or
   * submitted keep their files as they are.
   */
  deletePiece(id: string): DeletedPiece;
  /** How many pieces Profile holds, and what waits for Kris in each section (for the nav badge). */
  profileSummary(): ProfileSummary;
  /** Contact details and links, the same in every CV, letter and portal. Empty until Kris saves them. */
  contact(): Contact;
  saveContact(details: ContactDetails): SaveContactResult;
  /** Keeps a JPEG or PNG photo (replacing the one before); it goes only into packages where Kris switches it on. */
  setPhoto(photo: PhotoInput): Promise<SaveContactResult>;
  removePhoto(): Promise<Contact>;
  /** Everything in Profile, for the one-click JSON export. */
  exportProfile(): Promise<ProfileExport>;
  /**
   * Kris checked a drafted piece and it's true: it becomes confirmed, once it has what a confirmed
   * piece needs (months, where a number comes from); otherwise it comes back with the problems.
   */
  confirmPiece(id: string): SavePieceResult;
  /**
   * Imports old CVs (PDF, DOCX, TXT), the LinkedIn export, a GitHub profile and a portfolio page:
   * files are copied into the file store, their text is read on this laptop, and only that text goes
   * to the writer. Sources are read one after another; each one's pieces are in Profile, unconfirmed,
   * as soon as it finishes, with near-duplicates merged into the piece already there. `done` resolves
   * once every source has finished, couldn't be read, or waits for the budget.
   */
  startImport(input: ImportInput): Promise<StartImportResult>;
  /** An import's progress and results (the latest one without an id); null if there's none. */
  importStatus(id?: string): ImportStatus | null;
  /** Stops reading: sources not started are cancelled, a draft in progress is dropped, finished pieces stay. */
  cancelImport(id: string): ImportStatus | null;
  /** Reads the sources that waited for the budget, or were cancelled or interrupted. */
  resumeImport(id: string): ImportRun | null;
  /** What to do with a source that couldn't be read: text recognition, a text version, try again, or skip. */
  resolveUnreadable(itemId: string, choice: UnreadableChoice): Promise<ResolveResult>;
  /** Every source an import merged into a piece already there ("See merges"). */
  importMerges(id: string): ImportMerge[];
  // ---------- Setup (#55): check drafts, resume, search and done ----------

  /** The check-drafts list: pieces under the filter grouped by role, with the filter counts. */
  draftsToCheck(show?: DraftFilter): DraftsToCheck;
  /** "Confirm N unflagged": confirms a role's unconfirmed pieces; flagged ones are never confirmed in bulk. */
  confirmDrafts(groupId: string): ConfirmGroupResult;
  /** Kris picked the version that's true of a piece whose sources disagree, or left it to the coach interview. */
  resolveDispute(id: string, choice: DisputeChoice): SavePieceResult;
  /** A drafted piece is wrong: it leaves the profile, and can be restored from Discarded. Null if there's no such piece. */
  discardPiece(id: string): ProfilePiece | null;
  restorePiece(id: string): ProfilePiece | null;
  /** Undoes a Confirm: the piece waits to be checked again. */
  unconfirmPiece(id: string): ProfilePiece | null;
  /** Where Kris is in setup (or stopped), with the counts, so Setup reopens there. */
  setupProgress(): SetupProgress;
  setSetupStep(step: SetupStep): SetupProgress;
  /** "Skip setup": a quick start; Setup stays where it was, to come back to. */
  skipSetup(): SetupProgress;
  /**
   * "Your search": the search settings Kris saved, or, until she saves any, the defaults with the
   * years asked filled from her role dates; and the experience they were read from.
   */
  searchSuggestion(): SearchSuggestion;
  /** Setup's finish: the pieces, the angles (and the thinnest), the answer bank and the voice. */
  setupSummary(): SetupSummary;

  // ---------- Coach interview (#57) ----------

  /**
   * Starts the coach interview, or resumes it at the question it was on: setup's (no angle), or a
   * short one about a thin angle. The coach phrases the question in the background.
   */
  startInterview(angle?: Angle | null): InterviewView;
  /** The interview ("setup" or "angle:<angle>"): its scope, transcript, what it wrote and where it is. */
  interview(id?: string): InterviewView;
  /** Kris's answer: saved at once (not sent yet), then sent to the coach in the background. */
  answerInterview(id: string, text: string): InterviewChange;
  /** "I don't remember": a fine answer; the coach moves on and writes nothing. */
  dontRemember(id: string): InterviewChange;
  /** "Skip this question": kept, so a package can ask it if a job needs it. */
  skipQuestion(id: string): InterviewChange;
  /** "Pause, finish later": the interview reopens at the same question. */
  pauseInterview(id: string): InterviewView;
  /** "Try now": sends what waits for the coach again (after a timeout, or once the budget allows). */
  retryInterview(id: string): InterviewChange;
  /** Kris's decision on a near-the-line piece: keep her own wording ("honest") or the stronger one. */
  decideInterviewPiece(itemId: string, choice: "honest" | "stronger"): InterviewChange;
  /** Removes something the interview wrote: a new piece is deleted, an updated one goes back to what it said. */
  removeInterviewItem(itemId: string): InterviewChange;
  /** Edits a standard answer the interview wrote, before it goes to the answer bank. */
  editInterviewAnswer(itemId: string, text: string): InterviewChange;
  /**
   * "Finish and confirm N pieces": confirms what the interview wrote, in one list, and puts its
   * standard answers in the answer bank. Refused while a near-the-line piece has no decision.
   */
  finishInterview(id: string): FinishInterviewResult;
  /** Waits until the coach isn't writing. */
  interviewSettled(): Promise<void>;
  /** Questions Kris skipped, for packages to ask when a job needs them. */
  skippedQuestions(): SkippedQuestion[];

  /** One piece, for editing; null once it's deleted. */
  piece(id: string): ProfilePiece | null;
  /** The master profile grouped by role (roles, then education, then pieces tied to neither), filtered. */
  listPieces(query?: PieceQuery): PieceList;

  // ---------- Answer bank (Profile, and the contract Apply #40 reads) ----------

  /**
   * Adds an answer (no id) or saves an edit to one. Profile leaves `origin` out; Apply passes where a
   * new answer came from (the job and the portal). A refused answer comes back with its problems.
   */
  saveAnswer(input: AnswerInput, origin?: AnswerOrigin): SaveAnswerResult;
  /** The answer bank's table: filtered, searched and paged, with the filter counts and the portal edits waiting for Kris. */
  listAnswers(query?: AnswerQuery): AnswerList;
  /** Deletes an answer and its history; false if it was already gone. Approved packages keep their answers. */
  deleteAnswer(id: string): boolean;
  /** One answer, for editing; null once it's deleted. */
  answer(id: string): Answer | null;
  /**
   * The bank's answer to a form's question, in a language: matched on the question or any of its
   * wordings, with how confident the match is, or null when nothing matches well enough. Only a
   * "fill" answer carries a value; "ask each time", "leave blank" and a missing language never do.
   */
  findAnswer(question: string, language: AnswerLanguage): AnswerMatch | null;
  /** Counts a use of an answer (Apply filled it, or a package used it) and remembers when. */
  recordAnswerUse(id: string): void;
  /**
   * Kris changed a filled answer in a portal: it waits in Profile as "keep new or old" with both
   * versions shown. False when there's nothing to ask (no such answer, or the same text).
   */
  recordPortalEdit(id: string, edit: PortalEditInput): boolean;
  /** Keep new: the portal's version replaces the bank's, which stays in the history. Keep old: nothing changes. */
  resolvePortalEdit(id: string, keep: "keep-new" | "keep-old"): Answer | null;
  /** What changed in an answer and where, newest first. */
  answerHistory(id: string): AnswerChange[];

  /**
   * Prints a document from its fixed template, keeps it as the package's draft of that document,
   * and reads it back: page count, overflow and (for a CV) the ATS check come from the PDF itself.
   */
  draftDocument(request: DraftRequest): Promise<DocumentDraft>;
  /** The three angles (developer, security, design), each with its summary line, leads and whether it's thin. */
  angles(): AngleView[];
  /**
   * Saves an angle's summary line, its lead order (piece ids, first leads), or both. Only confirmed
   * pieces of that angle can lead. The next package for a Job of this angle starts from them.
   */
  saveAngle(input: SaveAngleInput): SaveAngleResult;
  /**
   * The angle a package for this Job starts from: the closest one by Discover's angle keywords and
   * the tags of Kris's confirmed pieces, with the reason.
   */
  closestAngle(posting: AnglePosting): AngleChoice;
  /** Drafts one of the fictional demo profile's documents (package "demo"), for checking the template. */
  demoDocument(options: DemoOptions): Promise<DocumentDraft>;

  // ---------- Voice (Profile › Voice, and drafts: the cover letter here, Track's follow-ups) ----------

  /** Profile › Voice: the samples, the rules learned (with their evidence), the edits and the learning switch. */
  voice(): VoiceView;
  /**
   * Keeps samples of Kris's writing (PDF, DOCX, TXT) on this laptop: the file in the file store, its
   * text read here. One that can't be read says why and how to fix it; the others still count.
   */
  addVoiceSamples(files: VoiceSampleFile[]): Promise<VoiceSample[]>;
  /** Replace: a new file in an (unreadable) sample's place. Null if there's no such sample. */
  replaceVoiceSample(id: string, file: VoiceSampleFile): Promise<VoiceSample | null>;
  /** Deletes a sample and its copy; drafts send nothing more from it. False if it was gone already. */
  removeVoiceSample(id: string): Promise<boolean>;
  /**
   * Learns voice rules from what's new (unread parts of samples, edits not yet learned from), within
   * the monthly budget. No call sends more than VOICE_EXCERPT_WORDS words of Kris's writing, and each
   * call's excerpts are recorded. The service runs it after samples are added and periodically;
   * a run already going is joined, not started twice.
   */
  learnVoice(): Promise<VoiceLearning>;
  /** Every call that sent Kris's writing to the model, newest first, with exactly what it sent. */
  voiceSends(): VoiceSend[];
  /** Takes a voice rule out of use; it won't come back unless Kris's writing shows it again. False if it's gone already. */
  removeVoiceRule(id: string): boolean;

  // Drafting with the voice (the cover letter; Track's follow-ups through `VoiceForDrafts`). Local only.

  /**
   * What a draft in this language sends to sound like Kris: the rules in use and at most
   * VOICE_EXCERPT_WORDS words of excerpts. Recorded (under the context's id) as it's handed out, so
   * the draft can show what left the machine.
   */
  voiceContext(request: VoiceContextRequest): VoiceContext;
  /**
   * Kris edited a draft (a letter, an answer, a follow-up): kept as a before/after pair to learn the
   * voice from, periodically. False when learning from edits is paused or nothing changed.
   */
  recordVoiceEdit(edit: VoiceEditInput): boolean;
  /** The "Learn from my edits" switch: paused, edits aren't recorded as evidence. */
  setVoiceLearning(fromEdits: boolean): VoiceView;
  /**
   * What the Job page's Prepare button shows: whether a package can start (with the reason when it
   * can't: a closed job, a posting not read, no master profile) and the Job's package, if it has one.
   */
  prepareStatus(job: PackageJob): PrepareStatus;
  /**
   * Starts the Job's package (one per Job: a Job that has one gets it back): the closest angle, the
   * company's own page as target, the posting's language. Parts are written in the background
   * within the monthly AI budget; leaving is safe.
   */
  startPackage(job: PackageJob): StartPackageResult;
  package(id: string): PackageView | null;
  packageForJob(jobId: string): PackageView | null;
  /** The package chip per Job that has a package ("Continue package · step 2 of 5", "Package ready"), for the Feed. */
  packageChips(jobIds: string[]): Record<string, PackageChip>;
  /** Waits until nothing is being written for the package, then returns it. */
  packageSettled(id: string): Promise<PackageView | null>;
  /**
   * Approves a step. Steps approve in order (reading ahead is free); a step whose part isn't written
   * can't be approved. A refusal says why and names the step that blocks it.
   */
  approveStep(id: string, step: PackageStep): ApproveResult;
  /** Chooses the posting to apply through; reopens the steps already approved. */
  setTargetPosting(id: string, postingId: string): ChangeResult;
  /** Switches the package's language; for now this prints the CV again. Reopens the steps already approved. */
  setPackageLanguage(id: string, language: DocumentLanguage): Promise<ChangeResult>;
  /** Shows or hides the photo on the CV (off by default); prints it again and reopens the CV step. */
  setPackagePhoto(id: string, on: boolean): Promise<ChangeResult>;
  /** Stops generating: finished parts stay, unfinished ones show as stopped, ready to retry. */
  stopGenerating(id: string): PackageView;
  /** Writes a failed, stopped or unwritten part again. */
  retryPart(id: string, part: PackageStep): ChangeResult;
  /**
   * Undoes one change the tailoring made to the master profile's CV: the line it replaced comes
   * back, the CV is printed again, and an approved CV step reopens. Redo puts the change back.
   */
  undoCvChange(id: string, changeId: string): Promise<ChangeResult>;
  redoCvChange(id: string, changeId: string): Promise<ChangeResult>;
  /**
   * For a CV that runs onto a second page: one of the ways offered to tighten it (an undoable
   * change, printed again), or "keep-two-pages". Type and margins never shrink.
   */
  fitCv(id: string, choiceId: string): Promise<ChangeResult>;
  /** The CV's current draft PDF, for the preview and the draft download. */
  packageCv(id: string): Promise<{ fileName: string; pdf: Uint8Array } | null>;

  // ---------- Flags, gap questions and learned pieces (#64) ----------

  /**
   * Kris's decision on a flag of the CV version: one of its options (none is pre-selected, and the
   * stronger wording is never one), or her own wording, checked against the profile first. A
   * wording is printed on the CV; an approved CV step reopens. A decision can be changed.
   */
  decideFlag(id: string, flagId: string, choice: FlagChoice): Promise<ChangeResult>;
  /**
   * "I have experience the profile doesn't know about": Kris's answer to a gap's question goes to
   * the coach, which writes a piece from it. The piece waits in Profile, unconfirmed and used only
   * in this package; the line drafted from it comes back as a new flag before the CV changes.
   */
  answerGap(id: string, flagId: string, answer: string): Promise<ChangeResult>;
  // ---------- The cover letter (#65) ----------

  /**
   * "Write draft N": a new letter with Kris's instruction ("Shorter", "Name the Kubernetes security
   * gap"), within the cap. Earlier drafts are kept and paged; a failure keeps the draft there is.
   */
  redraftLetter(id: string, instruction: string): Promise<ChangeResult>;
  /** Pages to another draft: it becomes the letter (printed, and the one approved). An approved letter step reopens. */
  showLetterDraft(id: string, draft: number): Promise<ChangeResult>;
  /**
   * Kris's text for a letter draft (greeting, paragraphs and closing, separated by blank lines):
   * saved and printed. A sentence she changed is hers (no longer highlighted, held to the whole
   * profile). Her changes to the writer's draft are voice evidence unless learning from edits is
   * paused. An approved letter step reopens.
   */
  editLetter(id: string, draft: number, text: string): Promise<ChangeResult>;
  /** "Write it myself": an empty draft with the letterhead, greeting and closing; earlier drafts are kept. */
  writeLetterYourself(id: string): Promise<ChangeResult>;
  /** The letter's draft PDF (the draft shown, with the CV's letterhead), for the preview and the draft download. */
  packageLetter(id: string): Promise<{ fileName: string; pdf: Uint8Array } | null>;

  /** Profile › Learned during packages: pieces learned from answers in packages, waiting for Kris, newest first. */
  learnedPieces(): LearnedPiece[];
  /** A near-the-line learned piece: its suggested honest version becomes the piece, confirmed. */
  keepHonestVersion(pieceId: string): SavePieceResult;
  /** "Confirm the N unflagged": confirms the learned pieces that aren't near the line, never the ones that are. */
  confirmLearnedPieces(): { confirmed: number; refused: { pieceId: string; message: string }[] };

  // ---------- Screening answers (#66) ----------

  /**
   * Kris's answer to a screening question: her salary number, one of the form's options, or her own
   * words (checked against the form's limit). It counts as hers, so Approve stops waiting for it; an
   * approved answers step reopens.
   */
  setScreeningAnswer(id: string, questionId: string, text: string): ChangeResult;
  /** "Write another draft" for a paragraph question: the drafter writes it again from the profile. */
  redraftScreeningAnswer(id: string, questionId: string): Promise<ChangeResult>;
  /** "Save to answer bank": a reusable answer becomes a screening answer in the bank. A company-specific one is never saved. */
  saveScreeningAnswerToBank(id: string, questionId: string): ChangeResult;
  /**
   * The drafter (Apply's needs-you questions, and the screening-answers step): an answer to a question
   * for the package's Job, in its language (or the one asked), within a word or character limit,
   * resting only on profile pieces (returned), honesty-checked and within the monthly cap.
   */
  draftAnswer(id: string, request: DraftAnswerRequest): Promise<DraftAnswerResult>;

  // ---------- The ATS check and approval (#67) ----------

  /**
   * "Approve package", step 5's Approve: only when every step is approved and the ATS check passes,
   * or Kris accepts its failing checks knowingly. The CV and letter PDFs are frozen by SHA-256 (and
   * copied to the Packages folder) as the next approved version, which never changes after. Editing
   * any part afterwards reopens its step and the package needs approving again.
   */
  approvePackage(id: string, options?: { acceptFailingChecks?: boolean }): Promise<ApproveResult>;
  /**
   * The ATS check's fix, which asks for facts rather than guess them: the contact details the CV
   * lacks, saved to the master profile when Kris ticks it (so it doesn't come back) or used in this
   * package only. The CV is printed again and checked again; its approval stays.
   */
  fixAts(id: string, fix: AtsFix): Promise<ChangeResult>;
  /**
   * "Redraft these lines", for "Your profile changed since this draft": the CV's lines that use a
   * piece changed in Profile take the piece's new wording (no model call), the CV is printed again
   * and its step reopens. Refused for an approved package, which never changes.
   */
  redraftChangedLines(id: string): Promise<ChangeResult>;
  /**
   * A frozen file of an approved version (the one approved now by default), exactly as approved:
   * its name, SHA-256, size, where it is (and its copy in the Packages folder) and its bytes. Null
   * when there's no such approved version or file. Never a draft.
   */
  packageFile(id: string, which: "cv" | "letter", version?: number): Promise<(FrozenFile & { bytes: Uint8Array }) | null>;

  // ---------- The contract for Apply (#38, #39, #41; docs/contracts.md) ----------

  /**
   * The approved package for a Job (or by id), the way Apply fills from it; a draft, or a package
   * reopened by an edit, answers "not approved yet" and is never returned for filling.
   */
  packageForApply(query: { jobId: string } | { packageId: string }): PackageForApply;
  /** Every package approved now, newest first: what Apply matches a portal's job against. */
  approvedPackages(): ApprovedPackage[];
  /** The master profile as a portal's form asks for it: contact details split for forms, roles, education, skills. */
  profileForApply(): ProfileForApply;
  /**
   * Track recorded the submission (Apply's "Mark as submitted", or the Job page's): the approved
   * version becomes "submitted", once. A second mark returns the first with `alreadyMarked`; a draft
   * is refused. Later edits make a new version; the submitted one never changes.
   */
  markPackageSubmitted(id: string, how: { via: SubmittedVia; portalUrl: string | null; at?: string }): MarkSubmittedResult;
  /** Undoes the mark (Apply's Undo): the version is approved again, waiting for an Application. Null if it wasn't marked. */
  undoPackageSubmitted(id: string): ApprovedPackage | null;

  // ---------- The contract for Track (#35; docs/contracts.md) ----------

  /** The package as sent: the version submitted, else the one approved now. Null for a package never approved. Never changes once submitted. */
  packageSnapshot(id: string): ApprovedPackage | null;
  /** Packages approved and not marked submitted: a confirmation email for one becomes a Needs-you question in Track. */
  approvedWithoutApplication(): ApprovedPackage[];
  /** A piece from another feature (an interview story): an unconfirmed achievement waiting in Profile, with its source. */
  addUnconfirmedPiece(piece: { text: string; source: string }): { id: string };
}

/** What Track reads from Prepare: the package as sent, approved packages not yet submitted, adding a piece, and the voice. */
export type PrepareForTrack = Pick<PreparationEngine,
  | "packageSnapshot" | "approvedWithoutApplication" | "packageFile" | "markPackageSubmitted" | "undoPackageSubmitted"
  | "addUnconfirmedPiece" | "voiceContext" | "recordVoiceEdit"
>;

/**
 * What Apply's fill engine reads from Prepare (read-only, except adding to the answer bank):
 * the master profile, approved packages with their frozen files, the answer bank and the drafter,
 * and marking a package submitted. See docs/contracts.md.
 */
export type PrepareForApply = Pick<PreparationEngine,
  | "profileForApply" | "packageForApply" | "approvedPackages" | "packageFile"
  | "findAnswer" | "saveAnswer" | "recordAnswerUse" | "recordPortalEdit" | "draftAnswer" | "markPackageSubmitted" | "undoPackageSubmitted"
>;

/** The voice as drafting features use it (the cover letter here, Track's follow-ups): read the context, record edits. */
export type VoiceForDrafts = Pick<PreparationEngine, "voiceContext" | "recordVoiceEdit">;

export function createPreparationEngine(deps: PreparationDeps): PreparationEngine {
  migrate(deps.db);
  const profile = createProfileStore(deps);
  const contact = createContactStore(deps);
  const imports = createImportStore(deps, profile);
  const angles = createAngleStore({ db: deps.db, clock: deps.clock, pieces: () => profile.all() });
  const answers = createAnswerStore(deps);
  const voice = createVoiceStore(deps);
  const setup = createSetupStore({ db: deps.db, clock: deps.clock, profile });
  /** A change made while checking drafts counts as Kris being in Setup. */
  const touched = <T>(value: T): T => { setup.touch(); return value; };
  /** Kris's search settings, once she saved any (the discovery engine keeps them in the same database). */
  const savedSettings = () => {
    const stored = deps.db.prepare("SELECT value FROM search_settings WHERE id = 1").get();
    return stored ? (JSON.parse(String(stored.value)) as SearchSettings) : null;
  };
  const salaryFloor = () => (savedSettings() ?? defaultSearchSettings).minMonthlySalaryEur || null;
  const seedAnswers = () => answers.seed(defaultAnswers(contact.get(), salaryFloor()));
  seedAnswers();

  async function draftDocument({ packageId, document, fileName: parts, keywords }: DraftRequest): Promise<DocumentDraft> {
    const fileName = documentFileName(document.kind, parts);
    const { pdf } = await deps.renderer.render(document);
    const { path } = await deps.packages.saveDraft(packageId, document.kind, fileName, pdf);
    const text = await deps.pdfReader.read(pdf);
    const pages = text.pages.length;
    const linesAfterFirstPage = text.pages.slice(1).reduce((n, p) => n + p.lines.length, 0);
    return {
      fileName,
      path,
      pdf,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      size: pdf.byteLength,
      pages,
      overflow: pages > 1 ? { pages, linesAfterFirstPage } : null,
      text,
      ats: document.kind === "cv" ? checkAts({ text, document, fileName, keywords }) : null,
      };
  }

  const interview = createInterviewStore({
    db: deps.db, clock: deps.clock, budget: deps.budget, writer: deps.writer, profile,
    findAnswer: (question, language) => answers.find(question, language),
    saveAnswer: (input, origin) => answers.save(input, origin),
  });

  const packages = createPackageStore({
    ...deps,
    pieces: () => profile.all(),
    savePiece: (input, origin) => profile.save(input, origin),
    skipped: () => interview.skipped(),
    contact: () => contact.get(),
    saveContact(details) {
      const result = contact.save(details);
      if (result.saved) seedAnswers();
      return result;
    },
    closestAngle: (posting) => angles.closest(posting),
    draftDocument,
    voice: {
      context: (request) => voice.context(request),
      saveEdit: (edit, previous) => voice.saveEdit(edit, previous),
      learnedFrom: () => voice.view().learnedFrom,
      sourceLabel: (source) => voice.sourceLabel(source),
    },
    answers,
  });

  return {
    startInterview: (angle) => touched(interview.start(angle ?? null)),
    interview: (id = "setup") => interview.view(id),
    answerInterview: (id, text) => touched(interview.answer(id, text)),
    dontRemember: (id) => touched(interview.dontRemember(id)),
    skipQuestion: (id) => touched(interview.skip(id)),
    pauseInterview: (id) => touched(interview.pause(id)),
    retryInterview: (id) => interview.retry(id),
    decideInterviewPiece: (itemId, choice) => touched(interview.decide(itemId, choice)),
    removeInterviewItem: (itemId) => touched(interview.remove(itemId)),
    editInterviewAnswer: (itemId, text) => touched(interview.editAnswer(itemId, text)),
    finishInterview: (id) => touched(interview.finish(id)),
    interviewSettled: () => interview.settled(),
    skippedQuestions: () => interview.skipped(),
    prepareStatus: (job) => packages.status(job),
    startPackage: (job) => packages.start(job),
    package: (id) => packages.get(id),
    packageForJob: (jobId) => packages.forJob(jobId),
    packageChips: (jobIds) => packages.chips(jobIds),
    packageSettled: (id) => packages.settled(id),
    approveStep: (id, step) => packages.approve(id, step),
    setTargetPosting: (id, postingId) => packages.setTarget(id, postingId),
    setPackageLanguage: (id, language) => packages.setLanguage(id, language),
    setPackagePhoto: (id, on) => packages.setPhoto(id, on),
    stopGenerating: (id) => packages.stop(id),
    retryPart: (id, part) => packages.retry(id, part),
    undoCvChange: (id, changeId) => packages.undoChange(id, changeId),
    redoCvChange: (id, changeId) => packages.redoChange(id, changeId),
    fitCv: (id, choiceId) => packages.fitCv(id, choiceId),
    packageCv: (id) => packages.cvFile(id),
    decideFlag: (id, flagId, choice) => packages.decideFlag(id, flagId, choice),
    answerGap: (id, flagId, answer) => packages.answerGap(id, flagId, answer),
    learnedPieces: () => packages.learned(),
    redraftLetter: (id, instruction) => packages.redraftLetter(id, instruction),
    showLetterDraft: (id, draft) => packages.showLetterDraft(id, draft),
    editLetter: (id, draft, text) => packages.editLetter(id, draft, text),
    packageLetter: (id) => packages.letterFile(id),
    writeLetterYourself: (id) => packages.writeLetterYourself(id),
    setScreeningAnswer: (id, questionId, text) => packages.setAnswer(id, questionId, text),
    redraftScreeningAnswer: (id, questionId) => packages.redraftAnswer(id, questionId),
    saveScreeningAnswerToBank: (id, questionId) => packages.saveAnswerToBank(id, questionId),
    draftAnswer: (id, request) => packages.draftAnswer(id, request),
    approvePackage: (id, options) => packages.approvePackage(id, options),
    fixAts: (id, fix) => packages.fixAts(id, fix),
    redraftChangedLines: (id) => packages.redraftChangedLines(id),
    packageFile: (id, which, version) => packages.frozenFile(id, which, version),
    packageForApply: (query) => packages.forApply(query),
    approvedPackages: () => packages.approvedList(),
    markPackageSubmitted: (id, how) => packages.markSubmitted(id, how),
    undoPackageSubmitted: (id) => packages.undoSubmitted(id),
    packageSnapshot: (id) => packages.snapshot(id),
    approvedWithoutApplication: () => packages.withoutApplication(),
    addUnconfirmedPiece({ text, source }) {
      const saved = profile.save({ kind: "achievement", text }, { from: source, quote: text, status: "unconfirmed" });
      if (!saved.saved) throw new Error(saved.problems[0]!.message);
      return { id: saved.piece.id };
    },
    profileForApply() {
      const c = contact.get();
      const words = c.nameLatin.trim().split(/\s+/).filter(Boolean);
      const phone = /^(\+\d{1,3})[\s-]*(.+)$/.exec(c.phone.trim());
      const link = (host: RegExp) => c.links.find((l) => host.test(l)) ?? null;
      const pieces = profile.all().filter((p) => p.status === "confirmed");
      const byEnd = (a: ProfilePiece, b: ProfilePiece) => (b.entry!.end ?? "9999").localeCompare(a.entry!.end ?? "9999") || b.entry!.start.localeCompare(a.entry!.start);
      const entries = (kind: "role" | "education") => pieces.filter((p) => p.kind === kind && p.entry).sort(byEnd)
        .map((p) => ({ title: p.entry!.title, organisation: p.entry!.organisation, place: p.entry!.city, start: p.entry!.start, end: p.entry!.end, text: p.text }));
      return {
        contact: {
          givenName: words.slice(0, -1).join(" ") || words[0] || "", familyName: words.length > 1 ? words[words.length - 1]! : "", fullName: words.join(" "),
          fullNameCyrillic: c.nameCyrillic.trim() || null, email: c.email,
          phone: c.phone.trim() ? { countryCode: phone?.[1] ?? "", national: phone?.[2] ?? c.phone.trim(), full: c.phone.trim() } : null,
          city: c.city, country: c.country,
          linkedin: link(/linkedin\.com/i), github: link(/github\.com/i), portfolio: c.links.find((l) => !/linkedin\.com|github\.com/i.test(l)) ?? null,
        },
        roles: entries("role").map(({ text, ...e }) => ({ ...e, description: text })),
        education: entries("education").map((e) => ({ title: e.title, organisation: e.organisation, place: e.place, start: e.start, end: e.end, field: null })),
        skills: pieces.filter((p) => p.kind === "skill").map((p) => p.text),
      };
    },
    keepHonestVersion(pieceId) {
      const learned = packages.learned().find((l) => l.piece.id === pieceId);
      const refuse = (message: string): SavePieceResult => ({ saved: false, problems: [{ field: "text", message, fixes: [] }] });
      if (!learned?.nearTheLine?.honest) return refuse("There's no suggested honest version for this piece.");
      const p = learned.piece;
      const revised = profile.revise(p.id, { id: p.id, kind: p.kind, text: learned.nearTheLine.honest, entry: p.entry, belongsTo: p.belongsTo, tags: p.tags, angles: p.angles, numberSource: p.numberSource }, { ...p.source, status: "unconfirmed" });
      return revised.saved ? profile.confirm(p.id) : revised;
    },
    confirmLearnedPieces() {
      let confirmed = 0;
      const refused: { pieceId: string; message: string }[] = [];
      for (const l of packages.learned()) {
        if (l.piece.status !== "unconfirmed") continue;
        const r = profile.confirm(l.piece.id);
        if (r.saved) confirmed++;
        else refused.push({ pieceId: l.piece.id, message: r.problems[0]!.message });
      }
      return { confirmed, refused };
    },
    budget: () => deps.budget.info(),
    draftDocument,
    demoDocument: (options) => draftDocument({ packageId: "demo", document: demoDocument(options), fileName: demoFileName }),
    angles: () => angles.list(),
    saveAngle: (input) => angles.save(input),
    closestAngle: (posting) => angles.closest(posting),
    savePiece: (input, origin) => profile.save(input, origin),
    deletePiece: (id) => profile.remove(id),
    confirmPiece: (id) => touched(profile.confirm(id)),
    startImport: (input) => imports.start(input),
    importStatus: (id) => imports.status(id),
    cancelImport: (id) => imports.cancel(id),
    resumeImport: (id) => imports.resume(id),
    resolveUnreadable: (itemId, choice) => imports.resolve(itemId, choice),
    importMerges: (id) => imports.merges(id),
    piece: (id) => profile.get(id),
    draftsToCheck: (show) => setup.drafts(show),
    confirmDrafts: (groupId) => setup.confirmGroup(groupId),
    resolveDispute: (id, choice) => touched(profile.resolveDispute(id, choice)),
    discardPiece: (id) => touched(profile.discard(id)),
    restorePiece: (id) => touched(profile.restore(id)),
    unconfirmPiece: (id) => touched(profile.unconfirm(id)),
    setupProgress: () => setup.progress(),
    setSetupStep: (step) => setup.goTo(step),
    skipSetup: () => setup.skip(),
    searchSuggestion() {
      const saved = savedSettings();
      const experience = experienceOf(profile.all(), deps.clock.now());
      if (saved) return { settings: saved, saved: true, experience };
      const base = defaultSearchSettings;
      const maxYearsRequired = experience ? maxYearsFor(experience) : base.dealbreakers.maxYearsRequired;
      return { settings: { ...base, dealbreakers: { ...base.dealbreakers, maxYearsRequired } }, saved: false, experience };
    },
    setupSummary() {
      const views = angles.list();
      const v = voice.view();
      const thinnest = views.reduce((a, b) => (b.available < a.available ? b : a), views[0]!);
      return {
        pieces: setup.progress().counts,
        angles: { count: views.length, thinnest: thinnest?.label ?? null },
        answerBank: answers.list().counts.all,
        voice: { samples: v.samples.filter((x) => !x.problem).length, rules: v.rules.length },
      };
    },
    listPieces: (query) => profile.list(query),
    profileSummary() {
      const s = profile.summary();
      const needsYou = { ...s.needsYou, answerBank: answers.needsYou() };
      return { ...s, needsYou, needsYouTotal: Object.values(needsYou).reduce((a, b) => a + b, 0), learned: packages.learned().length };
    },
    saveAnswer: (input, origin) => answers.save(input, origin),
    answer: (id) => answers.get(id),
    deleteAnswer: (id) => answers.remove(id),
    listAnswers: (query) => answers.list(query),
    findAnswer: (question, language) => answers.find(question, language),
    recordAnswerUse: (id) => answers.recordUse(id),
    recordPortalEdit: (id, edit) => answers.recordPortalEdit(id, edit),
    resolvePortalEdit: (id, keep) => answers.resolvePortalEdit(id, keep),
    answerHistory: (id) => answers.history(id),
    voice: () => voice.view(),
    addVoiceSamples: (files) => voice.add(files),
    replaceVoiceSample: (id, file) => voice.replace(id, file),
    removeVoiceSample: (id) => voice.remove(id),
    learnVoice: () => voice.learn(),
    voiceSends: () => voice.sends(),
    removeVoiceRule: (id) => voice.removeRule(id),
    voiceContext: (request) => voice.context(request),
    recordVoiceEdit: (edit) => voice.recordEdit(edit),
    setVoiceLearning: (on) => voice.setLearning(on),
    contact: () => contact.get(),
    saveContact(details) {
      const result = contact.save(details);
      if (result.saved) seedAnswers();
      return result;
    },
    setPhoto: (photo) => contact.setPhoto(photo),
    removePhoto: () => contact.removePhoto(),
    async exportProfile() {
      const { photo, ...details } = contact.get();
      const bytes = photo ? await deps.files.get(photo.sha256) : null;
      const pieces = profile.all();
      const sources = new Map<string, number>();
      for (const p of pieces) sources.set(p.source.from, (sources.get(p.source.from) ?? 0) + 1);
      return {
        format: "apply-kit master profile",
        version: 1,
        exportedAt: deps.clock.now().toISOString(),
        contact: { ...details, photo: photo && bytes ? { ...photo, base64: Buffer.from(bytes).toString("base64") } : null },
        pieces,
        sources: [...sources].map(([from, n]) => ({ from, pieces: n })),
      };
    },
  };
}
