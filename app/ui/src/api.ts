import type {
  CheckResult, Decision, FactAnswer, FeedResult, FeedView, HealthReport, JobDetail, PassInput, SchedulerStatus, SourceCheck,
} from "@apply-kit/core";

export async function fetchFeed(view: FeedView, signal?: AbortSignal): Promise<FeedResult> {
  const res = await fetch(`/api/feed?view=${view}`, { signal });
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
  post<{ jobIds: string[] }>(`/api/decisions/${encodeURIComponent(id)}/undo`, jobIds ? { jobIds } : {});

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
