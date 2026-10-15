import type {
  LearnedAdjustment, RuleChange, SearchSettings, CoverageHistory, CoverageInput, CoverageResult, PairedDevice,
  AddLinkResult, PastedPosting, CheckResult, CompanyDetection, Decision, NewSource, RemovalPreview, SourceInfo, FactAnswer, FeedResult, FeedSort, FeedView, HealthReport, JobDetail, PassInput, SchedulerStatus, SourceCheck,
  WatchlistSeed, AddApplicationInput, AddApplicationResult, ApplicationDetail, ApplicationEvent, ApplicationList, AttachedCv, Contact, ApplicationSummary, GroupKey, JobChoice, JobMarker, Status, TrackStats,
  EmailAnswer, EmailToMatch, TrackMailbox, StatusFilter, Angle, SinceLastVisit,
  FollowUp, FollowUpDraft, FollowUpSettings, NeedsYou,
} from "@apply-kit/core";

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

export async function addApplicationContact(id: string, value: string): Promise<{ contacts: Contact[] }> {
  return json(await postJson(`${applicationPath(id)}/contacts`, { value }));
}

/** Attaches the CV sent (a PDF file) with the label it counts under as the CV version. */
export async function attachApplicationCv(id: string, file: File, label: string): Promise<{ cv: AttachedCv; event: ApplicationEvent }> {
  const q = new URLSearchParams({ name: file.name, label });
  return json(await fetch(`${applicationPath(id)}/cv?${q}`, { method: "PUT", headers: { "content-type": "application/pdf" }, body: file }));
}

/** Where the attached CV opens. */
export const applicationCvUrl = (id: string) => `${applicationPath(id)}/cv`;

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

/** The follow-up delays. */
export async function fetchFollowUpSettings(signal?: AbortSignal): Promise<FollowUpSettings> {
  return json(await fetch("/api/settings/follow-ups", { signal }));
}

export async function saveFollowUpSettings(settings: FollowUpSettings): Promise<FollowUpSettings> {
  return json(await fetch("/api/settings/follow-ups", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings),
  }));
}
