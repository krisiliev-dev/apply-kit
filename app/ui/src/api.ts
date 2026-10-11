import type { CheckResult, Decision, FeedResult, JobDetail, FeedView, HealthReport, PassInput, SchedulerStatus, SourceCheck } from "@apply-kit/core";

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

/** One Job with its Postings; null if there's no such Job. */
export async function fetchJob(jobId: string, signal?: AbortSignal): Promise<JobDetail | null> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as JobDetail;
}

export const makeTarget = (jobId: string, postingId: string) =>
  post<JobDetail>(`/api/jobs/${encodeURIComponent(jobId)}/target`, { postingId });
export const splitPosting = (jobId: string, postingId: string) =>
  post<{ jobIds: [string, string] }>(`/api/jobs/${encodeURIComponent(jobId)}/split`, { postingId });
