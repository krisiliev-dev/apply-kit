import type { CheckResult, FactAnswer, FeedResult, FeedView, JobDetail } from "@apply-kit/core";

export async function fetchFeed(view: FeedView, signal?: AbortSignal): Promise<FeedResult> {
  const res = await fetch(`/api/feed?view=${view}`, { signal });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as FeedResult;
}

export async function checkNow(): Promise<CheckResult> {
  const res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as CheckResult;
}

const jobPath = (id: string) => `/api/jobs/${encodeURIComponent(id)}`;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The service answered ${res.status}`);
  }
  return (await res.json()) as T;
}

const post = (url: string, body: unknown = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function fetchJob(id: string, signal?: AbortSignal): Promise<JobDetail> {
  return json(await fetch(jobPath(id), { signal }));
}

/** Asks the service to read the Job's posting now; resolves when the read has finished or failed. */
export async function readJob(id: string): Promise<JobDetail> {
  return json(await post(`${jobPath(id)}/read`));
}

export async function confirmFact(id: string, key: string, answer: FactAnswer): Promise<JobDetail> {
  return json(await post(`${jobPath(id)}/facts/${encodeURIComponent(key)}`, { answer }));
}
