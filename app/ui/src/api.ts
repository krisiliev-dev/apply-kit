import type {
  LearnedAdjustment, RuleChange, SearchSettings, CoverageHistory, CoverageInput, CoverageResult, PairedDevice,
  AddLinkResult, PastedPosting, CheckResult, CompanyDetection, Decision, NewSource, RemovalPreview, SourceInfo, FactAnswer, FeedResult, FeedSort, FeedView, HealthReport, JobDetail, PassInput, SchedulerStatus, SourceCheck,
  ImportInputProblem, ImportMerge, ImportStatus, UnreadableAction,
  WatchlistSeed, AngleView, SaveAngleInput, SaveAngleResult, Contact, ContactDetails, DeletedPiece, PieceInput, PieceList, PieceQuery, ProfilePiece, ProfileSummary, SaveContactResult, SavePieceResult,
  ConfirmGroupResult, DisputeChoice, DraftFilter, DraftsToCheck, SearchSuggestion, SetupProgress, SetupStep, SetupSummary,
  Answer, AnswerChange, AnswerInput, AnswerList, AnswerQuery, SaveAnswerResult, VoiceView,
  ApproveResult, ChangeResult, DocumentLanguage, FeedJob, PackageChip, PackageStep, PackageView, PrepareStatus, StartPackageResult,
} from "@apply-kit/core";

/** A Feed row as the service sends it: the Job with its package chip, if it has a package. */
export type FeedRow = FeedJob & { package?: PackageChip | null };

/** How the Feed is listed: the sort, and whether relocation Jobs follow the main list. */
export interface FeedOptions {
  sort: FeedSort;
  relocation: boolean;
}

export async function fetchFeed(view: FeedView, options: FeedOptions, signal?: AbortSignal): Promise<FeedResult> {
  const q = new URLSearchParams({ view, sort: options.sort, ...(options.relocation && { relocation: "1" }) });
  const res = await fetch(`/api/feed?${q}`, { signal });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as FeedResult;
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

export async function fetchJob(id: string, signal?: AbortSignal): Promise<JobDetail> {
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
export const retryPart = async (id: string, part: PackageStep): Promise<ChangeResult> => orRefusal(await postJson(`${packagePath(id)}/parts/${part}/retry`));

/** The CV's draft PDF; `version` (its SHA-256) makes a re-printed CV load afresh. */
export const packageCvUrl = (id: string, version: string, download = false) =>
  `${packagePath(id)}/cv.pdf?v=${version.slice(0, 12)}${download ? "&download=1" : ""}`;
