import type {
  LearnedAdjustment, RuleChange, SearchSettings, CoverageHistory, CoverageInput, CoverageResult, PairedDevice,
  AddLinkResult, PastedPosting, CheckResult, CompanyDetection, Decision, NewSource, RemovalPreview, SourceInfo, FactAnswer, FeedResult, FeedSort, FeedView, HealthReport, JobDetail, PassInput, SchedulerStatus, SourceCheck,
  ImportInputProblem, ImportMerge, ImportStatus, UnreadableAction,
  WatchlistSeed, AngleView, SaveAngleInput, SaveAngleResult, Contact, ContactDetails, DeletedPiece, PieceInput, PieceList, PieceQuery, ProfilePiece, ProfileSummary, SaveContactResult, SavePieceResult,
  ConfirmGroupResult, DisputeChoice, DraftFilter, DraftsToCheck, SearchSuggestion, SetupProgress, SetupStep, SetupSummary,
  Angle, FinishInterviewResult, InterviewChange, InterviewView,
  Answer, AnswerChange, AnswerInput, AnswerList, AnswerQuery, SaveAnswerResult, VoiceView,
  ApproveResult, ChangeResult, DocumentLanguage, FeedJob, PackageChip, PackageStep, PackageView, PrepareStatus, StartPackageResult,
  FlagChoice, LearnedPiece, AtsFix,
  MarkResult, AddApplicationInput, AddApplicationResult, ApplicationDetail, ApplicationEvent, ApplicationList, AttachedCv, ApplicationContact, ApplicationSummary, GroupKey, JobChoice, JobMarker, Status, TrackStats,
  EmailAnswer, EmailToMatch, TrackMailbox, StatusFilter, SinceLastVisit,
  FollowUp, FollowUpDraft, FollowUpSettings, NeedsYou, Interview, InterviewInput, PrepSheet,
  Withdrawal, Withdrawals, OfferDetails, OfferView, RejectionReason, RejectionView,
} from "@apply-kit/core";

/** A Feed row as the service sends it: the Job with its package chip, if it has a package. */
export type FeedRow = FeedJob & { package?: PackageChip | null };

/** How the Feed is listed: the sort, and whether relocation Jobs follow the main list. */
export interface FeedOptions {
  sort: FeedSort;
  relocation: boolean;
}

/** The Feed with what Track knows about each listed Job (keyed by Job id). */
export type TrackedFeed = FeedResult & { markers: Record<string, JobMarker> };

export async function fetchFeed(view: FeedView, options: FeedOptions, signal?: AbortSignal): Promise<TrackedFeed> {
  const q = new URLSearchParams({ view, sort: options.sort, ...(options.relocation && { relocation: "1" }) });
  const res = await fetch(`/api/feed?${q}`, { signal });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as TrackedFeed;
}

/** Whether a check is running (progress, time estimate) and how the last one went. */
export async function fetchCheckStatus(signal?: AbortSignal): Promise<SchedulerStatus> {
  const res = await fetch("/api/check", { signal });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as SchedulerStatus;
}

/** Starts a check (or joins the running one) and returns its status straight away. */
export async function checkNow(): Promise<SchedulerStatus> {
  const res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as SchedulerStatus;
}

/** Starts (or joins) a check and resolves with its result once every Source has finished. */
export async function checkAndWait(pollMs = 1_000): Promise<CheckResult> {
  let status = await checkNow();
  while (status.checking) {
    await new Promise((r) => setTimeout(r, pollMs));
    status = await fetchCheckStatus();
  }
  if (!status.lastCheck) throw new Error("The check finished without a result");
  return status.lastCheck;
}

export async function fetchSources(signal?: AbortSignal): Promise<HealthReport> {
  const res = await fetch("/api/sources", { signal });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as HealthReport;
}

/** "Try now" for one Source. */
export async function checkSource(sourceId: string): Promise<SourceCheck> {
  const res = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/check`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as SourceCheck;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as T;
}

export const saveJobs = (jobIds: string[]) => post<Decision>("/api/jobs/save", { jobIds });
export const passJobs = (jobIds: string[], input: PassInput) => post<Decision>("/api/jobs/pass", { jobIds, ...input });
export const reopenJobs = (jobIds: string[]) => post<Decision>("/api/jobs/reopen", { jobIds });
export const undoDecision = (id: string, jobIds?: string[]) =>
  post<{ jobIds: string[]; sourceIds: string[] }>(`/api/decisions/${encodeURIComponent(id)}/undo`, jobIds ? { jobIds } : {});

const jobPath = (id: string) => `/api/jobs/${encodeURIComponent(id)}`;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The service answered ${res.status}`);
  }
  return (await res.json()) as T;
}

const postJson = (url: string, body: unknown = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A Job with what Track knows: its Application and the History with its company. */
export type TrackedJob = JobDetail & { track: JobMarker | null };

export async function fetchJob(id: string, signal?: AbortSignal): Promise<TrackedJob> {
  return json(await fetch(jobPath(id), { signal }));
}

/** Asks the service to read the Job's posting now; resolves when the read has finished or failed. */
export async function readJob(id: string): Promise<JobDetail> {
  return json(await postJson(`${jobPath(id)}/read`));
}

export async function confirmFact(id: string, key: string, answer: FactAnswer): Promise<JobDetail> {
  return json(await postJson(`${jobPath(id)}/facts/${encodeURIComponent(key)}`, { answer }));
}

const sourcePath = (id: string) => `/api/sources/${encodeURIComponent(id)}`;

/**
 * Finds which job system a company uses (a name or a careers link). `onProgress` gets a fresh
 * snapshot as each job system answers; resolves with the finished detection.
 */
export async function detectCompany(input: string, onProgress: (d: CompanyDetection) => void, signal?: AbortSignal): Promise<CompanyDetection> {
  const res = await fetch("/api/companies/detect", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }), signal,
  });
  if (!res.ok || !res.body) return json(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let last: CompanyDetection | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffered += value;
    const lines = buffered.split("\n");
    buffered = done ? "" : lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as CompanyDetection | { error: string };
      if ("error" in msg) throw new Error(msg.error);
      last = msg;
      onProgress(msg);
    }
    if (done) break;
  }
  if (!last?.finished) throw new Error("Detection stopped before it finished");
  return last;
}

export async function addSource(source: NewSource): Promise<SourceInfo> {
  return json(await postJson("/api/sources", source));
}

/** The Sofia starter watchlist against the watchlist: feeds on it or not, and companies without a feed. */
export async function fetchStarterWatchlist(signal?: AbortSignal): Promise<WatchlistSeed> {
  return json(await fetch("/api/watchlist/starter", { signal }));
}

/** Adds every starter-watchlist feed not added before, in one step. */
export async function seedStarterWatchlist(): Promise<WatchlistSeed> {
  return json(await postJson("/api/watchlist/starter"));
}

export async function pauseSource(id: string): Promise<SourceInfo> {
  return json(await postJson(`${sourcePath(id)}/pause`));
}

export async function resumeSource(id: string): Promise<SourceInfo> {
  return json(await postJson(`${sourcePath(id)}/resume`));
}

export async function previewRemoval(id: string, signal?: AbortSignal): Promise<RemovalPreview> {
  return json(await fetch(`${sourcePath(id)}/removal`, { signal }));
}

export async function removeSource(id: string): Promise<{ sourceId: string; decision: Decision }> {
  return json(await postJson(`${sourcePath(id)}/remove`));
}

/** Records a coverage check and answers with what was found and missing; a refused check throws its reason. */
export async function recordCoverageCheck(input: CoverageInput): Promise<CoverageResult> {
  return json(await postJson("/api/coverage", input));
}

export async function fetchCoverageHistory(signal?: AbortSignal): Promise<CoverageHistory> {
  return json(await fetch("/api/coverage", { signal }));
}

export async function fetchCoverageCheck(id: string, signal?: AbortSignal): Promise<CoverageResult> {
  return json(await fetch(`/api/coverage/${encodeURIComponent(id)}`, { signal }));
}

/** "Close 34 SumUp jobs": Kris confirms a Source's unusual drop. Undo with undoDecision. */
export async function confirmDrop(id: string): Promise<Decision> {
  return json(await postJson(`${sourcePath(id)}/confirm-drop`));
}

/** "Make target": one of the Job's Postings becomes the one Kris applies through. */
export async function makeTarget(jobId: string, postingId: string): Promise<JobDetail> {
  return json(await postJson(`${jobPath(jobId)}/target`, { postingId }));
}

/** Kris's search settings (the dealbreakers form). */
export async function fetchSearchSettings(signal?: AbortSignal): Promise<SearchSettings> {
  return json(await fetch("/api/settings/search", { signal }));
}

export async function saveSearchSettings(settings: SearchSettings): Promise<SearchSettings> {
  return json(await fetch("/api/settings/search", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings),
  }));
}

/** "Show this job": hidden Jobs back to New; undo the Decision to hide them again. */
export const unhideJobs = (jobIds: string[], learn = false) => post<Decision>("/api/jobs/unhide", { jobIds, learn });

/** Every learned ranking adjustment, newest first (undone ones marked). */
export async function fetchAdjustments(signal?: AbortSignal): Promise<LearnedAdjustment[]> {
  return json(await fetch("/api/adjustments", { signal }));
}

export async function undoAdjustment(id: string): Promise<LearnedAdjustment> {
  return json(await postJson(`/api/adjustments/${encodeURIComponent(id)}/undo`));
}

/** "Boost new {company} {angle} jobs" from a Job. */
export async function boostJob(jobId: string): Promise<LearnedAdjustment> {
  return json(await postJson(`${jobPath(jobId)}/boost`));
}

/** "Not a dealbreaker for me" on one hidden reason (its key): changes the rule behind it. */
export async function notADealbreaker(jobId: string, reason: string): Promise<{ change: RuleChange; settings: SearchSettings }> {
  return json(await postJson(`${jobPath(jobId)}/not-a-dealbreaker`, { reason }));
}

export async function fetchRuleChanges(signal?: AbortSignal): Promise<RuleChange[]> {
  return json(await fetch("/api/rule-changes", { signal }));
}

export async function undoRuleChange(id: string): Promise<{ change: RuleChange; settings: SearchSettings }> {
  return json(await postJson(`/api/rule-changes/${encodeURIComponent(id)}/undo`));
}

/** "Not the same job? Split": the Posting leaves the Job; answers with both Jobs' ids (this one first). */
export async function splitPosting(jobId: string, postingId: string): Promise<{ jobIds: [string, string] }> {
  return json(await postJson(`${jobPath(jobId)}/split`, { postingId }));
}

/** "Paste a job link", optionally with the job's text Kris pasted when the page couldn't be read. */
export async function addJobLink(link: string, pasted?: PastedPosting): Promise<AddLinkResult> {
  return json(await postJson("/api/jobs/link", pasted ? { link, pasted } : { link }));
}

/** A one-time code for pairing the Chrome extension (Settings → Chrome extension). */
export async function startPairing(): Promise<{ code: string; expiresAt: string }> {
  return json(await postJson("/api/pairing"));
}

export async function fetchPairedDevices(signal?: AbortSignal): Promise<PairedDevice[]> {
  return json(await fetch("/api/pairing/devices", { signal }));
}

export async function unpairDevice(id: string): Promise<void> {
  await json(await postJson(`/api/pairing/devices/${encodeURIComponent(id)}/unpair`));
}

// ---------- Profile (#53) ----------

/** What Profile holds and what waits for Kris per section; the counts add up to the nav badge. */
export async function fetchProfileSummary(signal?: AbortSignal): Promise<ProfileSummary> {
  return json(await fetch("/api/profile/summary", { signal }));
}

export async function fetchPieces(query: PieceQuery, signal?: AbortSignal): Promise<PieceList> {
  const q = new URLSearchParams({ ...(query.kind && { kind: query.kind }), ...(query.angle && { angle: query.angle }), ...(query.search?.trim() && { q: query.search.trim() }) });
  return json(await fetch(`/api/profile/pieces?${q}`, { signal }));
}

export async function fetchPiece(id: string, signal?: AbortSignal): Promise<ProfilePiece> {
  return json(await fetch(`/api/profile/pieces/${encodeURIComponent(id)}`, { signal }));
}

/** Saves a piece; a refused one resolves with its problems and fixes (it doesn't throw). */
export async function savePiece(input: PieceInput): Promise<SavePieceResult> {
  const res = await postJson("/api/profile/pieces", input);
  return res.status === 422 ? ((await res.json()) as SavePieceResult) : json(res);
}

export async function deletePiece(id: string): Promise<DeletedPiece> {
  return json(await postJson(`/api/profile/pieces/${encodeURIComponent(id)}/delete`));
}

export async function fetchContact(signal?: AbortSignal): Promise<Contact> {
  return json(await fetch("/api/profile/contact", { signal }));
}

/** Saves contact details; refused ones resolve with their problems. */
export async function saveContact(details: ContactDetails): Promise<SaveContactResult> {
  const res = await fetch("/api/profile/contact", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(details) });
  return res.status === 422 ? ((await res.json()) as SaveContactResult) : json(res);
}

export async function uploadPhoto(file: File): Promise<SaveContactResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const res = await fetch("/api/profile/photo", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, base64: btoa(binary) }),
  });
  return res.status === 422 ? ((await res.json()) as SaveContactResult) : json(res);
}

export async function removePhoto(): Promise<Contact> {
  return json(await postJson("/api/profile/photo/remove"));
}

/** The one-click export downloads from here. */
export const profileExportUrl = "/api/profile/export";

// ---------- Answer bank (#56) ----------

export async function fetchAnswers(query: AnswerQuery, signal?: AbortSignal): Promise<AnswerList> {
  const q = new URLSearchParams({
    ...(query.category && { category: query.category }),
    ...(query.notUsedIn90Days && { stale: "1" }),
    ...(query.search?.trim() && { q: query.search.trim() }),
    ...(query.page && query.page > 1 && { page: String(query.page) }),
  });
  return json(await fetch(`/api/profile/answers?${q}`, { signal }));
}

export async function fetchAnswer(id: string, signal?: AbortSignal): Promise<{ answer: Answer; history: AnswerChange[] }> {
  return json(await fetch(`/api/profile/answers/${encodeURIComponent(id)}`, { signal }));
}

/** Saves an answer; a refused one resolves with its problems (it doesn't throw). */
export async function saveAnswer(input: AnswerInput): Promise<SaveAnswerResult> {
  const res = await postJson("/api/profile/answers", input);
  return res.status === 422 ? ((await res.json()) as SaveAnswerResult) : json(res);
}

export async function deleteAnswer(id: string): Promise<{ deleted: true }> {
  return json(await postJson(`/api/profile/answers/${encodeURIComponent(id)}/delete`));
}

/** Keep new: the portal's version replaces the bank's (which stays in the history). Keep old: nothing changes. */
export async function resolvePortalEdit(id: string, keep: "keep-new" | "keep-old"): Promise<Answer> {
  return json(await postJson(`/api/profile/answers/${encodeURIComponent(id)}/portal-edit`, { keep }));
}

// ---------- Angles (#58) ----------

export async function fetchAngles(signal?: AbortSignal): Promise<AngleView[]> {
  return json(await fetch("/api/profile/angles", { signal }));
}

/** Saves a summary line, a lead order, or both; a refused save resolves with its problems. */
export async function saveAngle({ angle, ...change }: SaveAngleInput): Promise<SaveAngleResult> {
  const res = await fetch(`/api/profile/angles/${angle}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
  return res.status === 422 ? ((await res.json()) as SaveAngleResult) : json(res);
}

// ---------- Import (#54) ----------

/** A file as the service takes it: its name and its bytes in base64. */
export interface UploadFile {
  fileName: string;
  base64: string;
}

export async function toUpload(file: File): Promise<UploadFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { fileName: file.name, base64: btoa(s) };
}

export type StartImportAnswer = { started: true; status: ImportStatus } | { started: false; problems: ImportInputProblem[] };

export async function startImport(input: { files: UploadFile[]; linkedIn: UploadFile | null; github: string; portfolio: string }): Promise<StartImportAnswer> {
  const res = await postJson("/api/import", input);
  if (res.status === 422) return (await res.json()) as StartImportAnswer;
  return { started: true, status: await json<ImportStatus>(res) };
}

/** The latest import, or null before the first. */
export async function fetchLatestImport(signal?: AbortSignal): Promise<ImportStatus | null> {
  const res = await fetch("/api/import", { signal });
  return res.status === 204 ? null : json(res);
}

export async function fetchImport(id: string, signal?: AbortSignal): Promise<ImportStatus> {
  return json(await fetch(`/api/import/${encodeURIComponent(id)}`, { signal }));
}

export const cancelImport = async (id: string): Promise<ImportStatus> => json(await postJson(`/api/import/${encodeURIComponent(id)}/cancel`));
export const resumeImport = async (id: string): Promise<ImportStatus> => json(await postJson(`/api/import/${encodeURIComponent(id)}/resume`));

export async function fetchImportMerges(id: string, signal?: AbortSignal): Promise<ImportMerge[]> {
  return json(await fetch(`/api/import/${encodeURIComponent(id)}/merges`, { signal }));
}

/** What to do with a file that couldn't be read. */
export async function resolveImportItem(itemId: string, action: UnreadableAction, file?: UploadFile): Promise<ImportStatus> {
  return json(await postJson(`/api/import/items/${encodeURIComponent(itemId)}`, { action, ...(file && { file }) }));
}

/** Confirms a drafted piece; a refusal comes back with what it still needs. */
export async function confirmPiece(id: string): Promise<SavePieceResult> {
  const res = await postJson(`/api/profile/pieces/${encodeURIComponent(id)}/confirm`);
  if (res.status === 422) return (await res.json()) as SavePieceResult;
  return json(res);
}

// ---------- Learned during packages (#64) ----------

export const fetchLearned = async (signal?: AbortSignal): Promise<LearnedPiece[]> => json(await fetch("/api/profile/learned", { signal }));
/** "Confirm the N unflagged": never a near-the-line piece. */
export const confirmLearned = async (): Promise<{ confirmed: number; refused: { pieceId: string; message: string }[] }> =>
  json(await postJson("/api/profile/learned/confirm"));
/** A near-the-line learned piece: keep its suggested honest version, confirmed. */
export async function keepHonestVersion(pieceId: string): Promise<SavePieceResult> {
  const res = await postJson(`/api/profile/learned/${encodeURIComponent(pieceId)}/honest`);
  return res.status === 422 ? ((await res.json()) as SavePieceResult) : json(res);
}

// ---------- Setup (#55) ----------

export const fetchSetup = async (signal?: AbortSignal): Promise<SetupProgress> => json(await fetch("/api/setup", { signal }));
export async function setSetupStep(step: SetupStep): Promise<SetupProgress> {
  return json(await fetch("/api/setup/step", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ step }) }));
}
export const skipSetup = async (): Promise<SetupProgress> => json(await postJson("/api/setup/skip"));
export async function fetchDrafts(show: DraftFilter, signal?: AbortSignal): Promise<DraftsToCheck> {
  return json(await fetch(`/api/setup/drafts?show=${show}`, { signal }));
}
export const confirmDrafts = async (groupId: string): Promise<ConfirmGroupResult> =>
  json(await postJson(`/api/setup/drafts/groups/${encodeURIComponent(groupId)}/confirm`));
/** Picks the true version of a disputed piece, or leaves it to the interview; a refusal resolves with why. */
export async function resolveDispute(id: string, choice: DisputeChoice): Promise<SavePieceResult> {
  const res = await postJson(`/api/setup/drafts/${encodeURIComponent(id)}/dispute`, choice);
  return res.status === 422 ? ((await res.json()) as SavePieceResult) : json(res);
}
export const discardPiece = async (id: string): Promise<ProfilePiece> => json(await postJson(`/api/setup/drafts/${encodeURIComponent(id)}/discard`));
export const restorePiece = async (id: string): Promise<ProfilePiece> => json(await postJson(`/api/setup/drafts/${encodeURIComponent(id)}/restore`));
export const unconfirmPiece = async (id: string): Promise<ProfilePiece> => json(await postJson(`/api/setup/drafts/${encodeURIComponent(id)}/unconfirm`));
export const fetchSearchSuggestion = async (signal?: AbortSignal): Promise<SearchSuggestion> => json(await fetch("/api/setup/search", { signal }));
export const fetchSetupSummary = async (signal?: AbortSignal): Promise<SetupSummary> => json(await fetch("/api/setup/summary", { signal }));
// ---------- Coach interview (#57) ----------

const interviewPath = (id: string) => `/api/interviews/${encodeURIComponent(id)}`;
/** A refusal (422) resolves with its reason; anything else not OK throws. */
const refusalOk = async <T>(res: Response): Promise<T> => (res.status === 422 ? ((await res.json()) as T) : json<T>(res));

export async function fetchInterview(angle: Angle | null, signal?: AbortSignal): Promise<InterviewView> {
  return json(await fetch(`/api/interview${angle ? `?angle=${angle}` : ""}`, { signal }));
}
/** Starts the interview, or resumes it at the same question. */
export const startInterview = async (angle: Angle | null): Promise<InterviewView> => json(await postJson("/api/interview/start", { angle }));
export const answerInterview = async (id: string, text: string): Promise<InterviewChange> => refusalOk(await postJson(`${interviewPath(id)}/answer`, { text }));
export const dontRemember = async (id: string): Promise<InterviewChange> => refusalOk(await postJson(`${interviewPath(id)}/dont-remember`));
export const skipQuestion = async (id: string): Promise<InterviewChange> => refusalOk(await postJson(`${interviewPath(id)}/skip`));
export const retryInterview = async (id: string): Promise<InterviewChange> => refusalOk(await postJson(`${interviewPath(id)}/retry`));
export const pauseInterview = async (id: string): Promise<InterviewView> => json(await postJson(`${interviewPath(id)}/pause`));
export const finishInterview = async (id: string): Promise<FinishInterviewResult> => refusalOk(await postJson(`${interviewPath(id)}/finish`));
export const decideInterviewPiece = async (itemId: string, choice: "honest" | "stronger"): Promise<InterviewChange> =>
  refusalOk(await postJson(`/api/interview/items/${encodeURIComponent(itemId)}/decide`, { choice }));
export const removeInterviewItem = async (itemId: string): Promise<InterviewChange> =>
  refusalOk(await postJson(`/api/interview/items/${encodeURIComponent(itemId)}/remove`));
export async function editInterviewAnswer(itemId: string, text: string): Promise<InterviewChange> {
  return refusalOk(await fetch(`/api/interview/items/${encodeURIComponent(itemId)}/answer`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }));
}

// ---------- Voice (#59) ----------

export async function fetchVoice(signal?: AbortSignal): Promise<VoiceView> {
  return json(await fetch("/api/profile/voice", { signal }));
}
export const addVoiceSamples = async (files: UploadFile[]): Promise<VoiceView> => json(await postJson("/api/profile/voice/samples", { files }));
export const replaceVoiceSample = async (id: string, file: UploadFile): Promise<VoiceView> =>
  json(await postJson(`/api/profile/voice/samples/${encodeURIComponent(id)}/replace`, { file }));
export const removeVoiceSample = async (id: string): Promise<VoiceView> => json(await postJson(`/api/profile/voice/samples/${encodeURIComponent(id)}/remove`));
export const removeVoiceRule = async (id: string): Promise<VoiceView> => json(await postJson(`/api/profile/voice/rules/${encodeURIComponent(id)}/remove`));
export async function setVoiceLearning(fromEdits: boolean): Promise<VoiceView> {
  return json(await fetch("/api/profile/voice/learning", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ fromEdits }) }));
}

// ---------- Packages (#62) ----------

const packagePath = (id: string) => `/api/packages/${encodeURIComponent(id)}`;
const put = (url: string, body: unknown) =>
  fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
/** A refusal (422) resolves with its reason; anything else not OK throws. */
const orRefusal = async <T>(res: Response): Promise<T> => (res.status === 422 ? ((await res.json()) as T) : json<T>(res));

/** What the Job's Prepare button shows: whether a package can start (or why not) and its package chip. */
export async function fetchPrepareStatus(jobId: string, signal?: AbortSignal): Promise<PrepareStatus> {
  return json(await fetch(`${jobPath(jobId)}/prepare`, { signal }));
}

/** Starts the Job's package (or returns the one it has); a package that can't start resolves with the reason. */
export async function startPackage(jobId: string): Promise<StartPackageResult> {
  return orRefusal(await postJson(`${jobPath(jobId)}/package`));
}

export async function fetchPackage(id: string, signal?: AbortSignal): Promise<PackageView> {
  return json(await fetch(packagePath(id), { signal }));
}

export async function approveStep(id: string, step: PackageStep): Promise<ApproveResult> {
  return orRefusal(await postJson(`${packagePath(id)}/steps/${step}/approve`));
}

export const setTargetPosting = async (id: string, postingId: string): Promise<ChangeResult> => orRefusal(await put(`${packagePath(id)}/target`, { postingId }));
export const setPackageLanguage = async (id: string, language: DocumentLanguage): Promise<ChangeResult> => orRefusal(await put(`${packagePath(id)}/language`, { language }));
export const setPackagePhoto = async (id: string, on: boolean): Promise<ChangeResult> => orRefusal(await put(`${packagePath(id)}/photo`, { on }));
export const stopGenerating = async (id: string): Promise<PackageView> => json(await postJson(`${packagePath(id)}/stop`));
export const undoCvChange = async (id: string, changeId: string): Promise<ChangeResult> => orRefusal(await postJson(`${packagePath(id)}/cv/changes/${encodeURIComponent(changeId)}/undo`));
export const redoCvChange = async (id: string, changeId: string): Promise<ChangeResult> => orRefusal(await postJson(`${packagePath(id)}/cv/changes/${encodeURIComponent(changeId)}/redo`));
export const fitCv = async (id: string, choice: string): Promise<ChangeResult> => orRefusal(await postJson(`${packagePath(id)}/cv/fit`, { choice }));
/** Kris's decision on a flag: one of its options, or her own wording (a refusal resolves with why). */
export const decideFlag = async (id: string, flagId: string, choice: FlagChoice): Promise<ChangeResult> =>
  orRefusal(await postJson(`${packagePath(id)}/cv/flags/${encodeURIComponent(flagId)}/decide`, choice));
/** Kris's answer to a gap's question, for the coach. */
export const answerGap = async (id: string, flagId: string, answer: string): Promise<ChangeResult> =>
  orRefusal(await postJson(`${packagePath(id)}/cv/flags/${encodeURIComponent(flagId)}/answer`, { answer }));
export const retryPart = async (id: string, part: PackageStep): Promise<ChangeResult> => orRefusal(await postJson(`${packagePath(id)}/parts/${part}/retry`));

// ---------- Screening answers (#66) ----------

const answerPath = (id: string, questionId: string) => `${packagePath(id)}/answers/${encodeURIComponent(questionId)}`;
/** Kris's answer to a screening question (a refusal resolves with why: over the limit, not an option, not one number). */
export const setScreeningAnswer = async (id: string, questionId: string, text: string): Promise<ChangeResult> => orRefusal(await put(answerPath(id, questionId), { text }));
export const redraftScreeningAnswer = async (id: string, questionId: string): Promise<ChangeResult> => orRefusal(await postJson(`${answerPath(id, questionId)}/redraft`));
export const saveScreeningAnswerToBank = async (id: string, questionId: string): Promise<ChangeResult> => orRefusal(await postJson(`${answerPath(id, questionId)}/save`));

/** The CV's draft PDF; `version` (its SHA-256) makes a re-printed CV load afresh. */
export const packageCvUrl = (id: string, version: string, download = false) =>
  `${packagePath(id)}/cv.pdf?v=${version.slice(0, 12)}${download ? "&download=1" : ""}`;

// The cover letter (#65): a new draft with an instruction, Kris's edits, paging, writing it herself, and its draft PDF.
export const redraftLetter = async (id: string, instruction: string): Promise<ChangeResult> => orRefusal(await postJson(`${packagePath(id)}/letter/drafts`, { instruction }));
export const editLetter = async (id: string, draft: number, text: string): Promise<ChangeResult> => orRefusal(await put(`${packagePath(id)}/letter/drafts/${draft}`, { text }));
export const showLetterDraft = async (id: string, draft: number): Promise<ChangeResult> => orRefusal(await put(`${packagePath(id)}/letter/current`, { draft }));
export const writeLetterYourself = async (id: string): Promise<ChangeResult> => orRefusal(await postJson(`${packagePath(id)}/letter/own`));
/** The letter's draft PDF; `version` (its SHA-256) makes a re-printed letter load afresh. */
export const packageLetterUrl = (id: string, version: string, download = false) =>
  `${packagePath(id)}/letter.pdf?v=${version.slice(0, 12)}${download ? "&download=1" : ""}`;

// ---------- The ATS check and approval (#67) ----------

/** Approve package: freezes the files. `acceptFailingChecks` approves knowing the failing checks fail. */
export const approvePackage = async (id: string, acceptFailingChecks = false): Promise<ApproveResult> =>
  orRefusal(await postJson(`${packagePath(id)}/approve`, { acceptFailingChecks }));
/** The ATS check's fix: the facts asked for, saved to the master profile too when `updateProfile`. */
export const fixAts = async (id: string, fix: AtsFix): Promise<ChangeResult> => orRefusal(await postJson(`${packagePath(id)}/ats/fix`, fix));
/** "Redraft these lines" after a profile change. */
export const redraftChangedLines = async (id: string): Promise<ChangeResult> => orRefusal(await postJson(`${packagePath(id)}/cv/redraft-changed`));
/** An approved file, exactly as frozen. */
export const frozenFileUrl = (id: string, which: "cv" | "letter", download = false) =>
  `${packagePath(id)}/files/${which}.pdf${download ? "?download=1" : ""}`;

// ---------- Applications (Track) ----------

/** Every Application grouped by Status. `all` lists the groups to show in full (Applied and Closed show 5 otherwise). */
export async function fetchApplications(all: GroupKey[] = [], signal?: AbortSignal): Promise<ApplicationList> {
  return fetchApplicationList({ all }, signal);
}

/** What Applications asks the list for: search, filters, groups shown in full and where each paged group starts. */
export interface ApplicationListParams {
  all?: GroupKey[];
  /** Page groups over 25 rows. */
  paged?: boolean;
  at?: Partial<Record<GroupKey, number>>;
  q?: string;
  status?: StatusFilter | null;
  angle?: Angle | null;
  /** Applied in the last N days. */
  within?: number | null;
}

export async function fetchApplicationList(p: ApplicationListParams, signal?: AbortSignal): Promise<ApplicationList> {
  const q = new URLSearchParams();
  if (p.all?.length) q.set("all", p.all.join(","));
  if (p.paged) q.set("paged", "1");
  const at = Object.entries(p.at ?? {}).filter(([, n]) => n);
  if (at.length) q.set("at", at.map(([k, n]) => `${k}:${n}`).join(","));
  if (p.q?.trim()) q.set("q", p.q.trim());
  if (p.status) q.set("status", p.status);
  if (p.angle) q.set("angle", p.angle);
  if (p.within) q.set("within", String(p.within));
  const qs = q.toString();
  return json(await fetch(`/api/applications${qs ? `?${qs}` : ""}`, { signal }));
}

/** Records a visit to Applications: "Since your last visit" (Status changes made by email). */
export async function visitApplications(): Promise<SinceLastVisit> {
  return json(await postJson("/api/applications/visit"));
}

/** Jobs to pick from in Add application (passed and closed too). */
export async function findJobsToApply(q: string, signal?: AbortSignal): Promise<JobChoice[]> {
  return json(await fetch(`/api/applications/jobs?q=${encodeURIComponent(q)}`, { signal }));
}

/** "Add application": added (201), already open for that Job (200), or invalid with the field named (422). */
export async function addApplication(input: AddApplicationInput): Promise<AddApplicationResult> {
  const res = await postJson("/api/applications", input);
  if (res.status === 422) return (await res.json()) as AddApplicationResult;
  return json(res);
}

export async function setApplicationStatus(id: string, status: Status): Promise<{ application: ApplicationSummary; event: ApplicationEvent; cancelled: FollowUp | null }> {
  return json(await postJson(`/api/applications/${encodeURIComponent(id)}/status`, { status }));
}

/**
 * The Job page's "Mark as submitted" (an application sent outside the extension): the same fill-engine
 * call the panel makes. A mark that created nothing resolves with its reason.
 */
export async function markPackageSubmitted(packageId: string): Promise<MarkResult> {
  const res = await postJson(`/api/packages/${encodeURIComponent(packageId)}/submitted`);
  return res.status === 422 ? ((await res.json()) as MarkResult) : json(res);
}

/** Undo after marking: the Application goes and the package is approved again. Rejects with the reason when refused. */
export async function undoMarkSubmitted(applicationId: string): Promise<{ packageId: string }> {
  return json(await postJson(`/api/applications/${encodeURIComponent(applicationId)}/submitted/undo`));
}

export async function undoApplicationEvent(eventId: string): Promise<{ application: ApplicationSummary | null; event: ApplicationEvent }> {
  return json(await postJson(`/api/applications/events/${encodeURIComponent(eventId)}/undo`));
}

const applicationPath = (id: string) => `/api/applications/${encodeURIComponent(id)}`;

/** One Application in full (its page). Rejects with "No such application" when there isn't one. */
export async function fetchApplication(id: string, signal?: AbortSignal): Promise<ApplicationDetail> {
  return json(await fetch(applicationPath(id), { signal }));
}

export async function addApplicationNote(id: string, text: string): Promise<{ event: ApplicationEvent }> {
  return json(await postJson(`${applicationPath(id)}/notes`, { text }));
}

export async function addApplicationContact(id: string, value: string): Promise<{ contacts: ApplicationContact[] }> {
  return json(await postJson(`${applicationPath(id)}/contacts`, { value }));
}

/** Attaches the CV sent (a PDF file) with the label it counts under as the CV version. */
export async function attachApplicationCv(id: string, file: File, label: string): Promise<{ cv: AttachedCv; event: ApplicationEvent }> {
  const q = new URLSearchParams({ name: file.name, label });
  return json(await fetch(`${applicationPath(id)}/cv?${q}`, { method: "PUT", headers: { "content-type": "application/pdf" }, body: file }));
}

/** Where the attached CV opens. */
export const applicationCvUrl = (id: string) => `${applicationPath(id)}/cv`;

/** Where a file of the Package as sent opens: its CV PDF or letter, exactly as approved. */
export const packageFileUrl = (id: string, which: "cv" | "letter") => `${applicationPath(id)}/package/${which}`;

/** The CV versions sent so far, for "Pick a CV version". */
export async function fetchCvVersions(signal?: AbortSignal): Promise<string[]> {
  return json(await fetch("/api/applications/cv-versions", { signal }));
}

/** "Pick a CV version": one sent before, without a file. */
export async function pickCvVersion(id: string, label: string): Promise<{ event: ApplicationEvent }> {
  return json(await postJson(`${applicationPath(id)}/cv-version`, { label }));
}

/** The Stats strip's numbers. */
export async function fetchApplicationStats(signal?: AbortSignal): Promise<TrackStats> {
  return json(await fetch("/api/applications/stats", { signal }));
}

/** Emails waiting in Needs you for you to say which Application they're about. */
export async function fetchEmailsToMatch(signal?: AbortSignal): Promise<EmailToMatch[]> {
  return json(await fetch("/api/applications/emails", { signal }));
}

/** Your answer to an email to match. Rejects with the reason in words (no choice: "Choose where this email belongs first."). */
export async function answerEmail(emailId: string, answer: EmailAnswer): Promise<{ application: ApplicationSummary | null; event: ApplicationEvent | null }> {
  return json(await postJson(`/api/applications/emails/${encodeURIComponent(emailId)}/answer`, answer));
}

/** "Mark Applied, dated …?" for a confirmation about an approved package: mark it Applied, or not this package. */
export async function answerPackageConfirmation(emailId: string, answer: "mark-applied" | "not-this"): Promise<{ application: ApplicationSummary | null; event: ApplicationEvent | null }> {
  return json(await postJson(`/api/applications/emails/${encodeURIComponent(emailId)}/package`, { answer }));
}

/** Undoes "Mark Applied": the Application is taken off and the question comes back. */
export async function undoPackageConfirmation(emailId: string): Promise<void> {
  await json(await postJson(`/api/applications/emails/${encodeURIComponent(emailId)}/package/undo`));
}

/** "Looks right" on the moved-by-email banner. */
export async function confirmEmailMove(eventId: string): Promise<void> {
  await json(await postJson(`/api/applications/events/${encodeURIComponent(eventId)}/looks-right`));
}

/** The job mailbox's state, for Applications' banners. */
export async function fetchTrackMailbox(signal?: AbortSignal): Promise<TrackMailbox> {
  return json(await fetch("/api/applications/mailbox", { signal }));
}

// ---------- Follow-ups and Needs you (Track) ----------

/** Needs you: follow-ups due, most urgent first, the count for the badge, and Coming up. */
export async function fetchNeedsYou(signal?: AbortSignal): Promise<NeedsYou> {
  return json(await fetch("/api/applications/needs-you", { signal }));
}

/** Tells the top bar that what needs the user changed, so its Applications badge counts again. */
export function needsYouChanged(): void {
  window.dispatchEvent(new Event("needs-you-changed"));
}

const followUpPath = (id: string) => `/api/follow-ups/${encodeURIComponent(id)}`;

/** One follow-up to write: its outline, text as typed, and Open in Mail's recipient and subject. */
export async function fetchFollowUp(id: string, signal?: AbortSignal): Promise<FollowUpDraft> {
  return json(await fetch(followUpPath(id), { signal }));
}

/** Keeps the text as typed. */
export async function saveFollowUpText(id: string, text: string): Promise<{ followUp: FollowUp }> {
  return json(await fetch(`${followUpPath(id)}/text`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), keepalive: true,
  }));
}

/** Marks it sent (from the user's own mail), skips it, or snoozes it: an Event, undone like any other. */
export async function followUpAction(id: string, action: "sent" | "skip" | "snooze"): Promise<{ followUp: FollowUp; event: ApplicationEvent }> {
  return json(await postJson(`${followUpPath(id)}/${action}`));
}

/** The thank-you note's topic: one thing discussed. Returns the outline built from it. */
export async function saveFollowUpTopic(id: string, topic: string): Promise<{ followUp: FollowUp; outline: string[] }> {
  return json(await fetch(`${followUpPath(id)}/topic`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic }),
  }));
}

// ---------- Offers and closing (Track #34) ----------

const putJson = (url: string, body: unknown) => fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** "I accepted this offer…" (and Accepted in any Status select): Accepted, with a withdrawal to send for each other open one. */
export async function acceptOffer(id: string): Promise<{ application: ApplicationSummary; event: ApplicationEvent; withdrawals: Withdrawal[] }> {
  return json(await postJson(`${applicationPath(id)}/accept`));
}

/** The withdrawals of the offer accepted: still to send, and sent. */
export async function fetchWithdrawals(signal?: AbortSignal): Promise<Withdrawals> {
  return json(await fetch("/api/applications/withdrawals", { signal }));
}

/** "I declined it…": Withdrawn, with the reason "declined offer". */
export async function declineOffer(id: string): Promise<{ application: ApplicationSummary; event: ApplicationEvent }> {
  return json(await postJson(`${applicationPath(id)}/decline`));
}

/** The optional reply declining the offer, drafted in the user's voice. */
export async function fetchDeclineDraft(id: string, signal?: AbortSignal): Promise<FollowUpDraft> {
  return json(await fetch(`${applicationPath(id)}/decline-draft`, { signal }));
}

export async function saveOfferDetails(id: string, details: OfferDetails): Promise<{ offer: OfferView }> {
  return json(await putJson(`${applicationPath(id)}/offer`, details));
}

export async function saveRejectionNote(id: string, note: { lesson: string | null; reason: RejectionReason | null }): Promise<{ rejection: RejectionView }> {
  return json(await putJson(`${applicationPath(id)}/rejection`, note));
}

// ---------- Interviews and the prep sheet (Track #33) ----------

/** Adds an interview by hand, or edits one (with its id). Times are "YYYY-MM-DDTHH:mm" in its time zone. */
export async function saveInterview(applicationId: string, input: InterviewInput & { interviewId?: string }): Promise<{ interview: Interview; event: ApplicationEvent }> {
  return json(await postJson(`${applicationPath(applicationId)}/interviews`, input));
}

/** The interview's calendar file. */
export const interviewIcsUrl = (interviewId: string) => `/api/interviews/${encodeURIComponent(interviewId)}/ics`;

export async function fetchPrepSheet(applicationId: string, signal?: AbortSignal): Promise<PrepSheet | null> {
  return ((await json(await fetch(`${applicationPath(applicationId)}/prep`, { signal }))) as { sheet: PrepSheet | null }).sheet;
}

/** Builds the prep sheet (once, within the AI budget). A refusal throws with the service's words. */
export async function buildPrepSheet(applicationId: string): Promise<PrepSheet> {
  return ((await json(await postJson(`${applicationPath(applicationId)}/prep`))) as { sheet: PrepSheet }).sheet;
}

export async function markPractised(applicationId: string, questionId: string, practised: boolean): Promise<PrepSheet> {
  return ((await json(await postJson(`${applicationPath(applicationId)}/prep/${encodeURIComponent(questionId)}/practised`, { practised }))) as { sheet: PrepSheet }).sheet;
}

export async function addPrepStory(applicationId: string, questionId: string, text: string): Promise<PrepSheet> {
  return ((await json(await postJson(`${applicationPath(applicationId)}/prep/${encodeURIComponent(questionId)}/story`, { text }))) as { sheet: PrepSheet }).sheet;
}

/** The follow-up delays. */
export async function fetchFollowUpSettings(signal?: AbortSignal): Promise<FollowUpSettings> {
  return json(await fetch("/api/settings/follow-ups", { signal }));
}

export async function saveFollowUpSettings(settings: FollowUpSettings): Promise<FollowUpSettings> {
  return json(await fetch("/api/settings/follow-ups", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings),
  }));
}
