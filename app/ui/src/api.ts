import type { CheckResult, FeedResult, FeedView, HealthReport, SourceCheck } from "@apply-kit/core";

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
