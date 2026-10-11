import type { FeedResult, FeedView } from "@apply-kit/core";

export async function fetchFeed(view: FeedView, signal?: AbortSignal): Promise<FeedResult> {
  const res = await fetch(`/api/feed?view=${view}`, { signal });
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as FeedResult;
}
