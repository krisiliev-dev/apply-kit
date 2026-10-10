import type { DiscoveryPreferences, JobPosting } from "./types";
import { fetchPostings as fetchGreenhouse } from "./sources/greenhouse";
import { fetchPostings as fetchLever } from "./sources/lever";
import { fetchPostings as fetchAshby } from "./sources/ashby";
import { fetchPostings as fetchHnHiring } from "./sources/hnHiring";
import { fetchPostings as fetchRss } from "./sources/rss";

// Server-side aggregator.
//
// Each source is invoked in parallel. A single source failing never stops
// the whole batch — we log errors to the result summary and keep going.
//
// 15-minute cache per source key is enforced by the route handler (simple
// in-memory Map). This function itself is stateless.

export type AggregateResult = {
  postings: JobPosting[];
  errors: Array<{ sourceKey: string; message: string }>;
};

type FetchTask = {
  sourceKey: string;
  run: () => Promise<JobPosting[]>;
};

export async function aggregate(
  prefs: DiscoveryPreferences,
): Promise<AggregateResult> {
  const tasks: FetchTask[] = [];

  for (const slug of prefs.watchlist.greenhouse) {
    tasks.push({
      sourceKey: `greenhouse:${slug}`,
      run: () => fetchGreenhouse(slug),
    });
  }
  for (const slug of prefs.watchlist.lever) {
    tasks.push({
      sourceKey: `lever:${slug}`,
      run: () => fetchLever(slug),
    });
  }
  for (const slug of prefs.watchlist.ashby) {
    tasks.push({
      sourceKey: `ashby:${slug}`,
      run: () => fetchAshby(slug),
    });
  }
  for (const feed of prefs.rssFeeds) {
    tasks.push({
      sourceKey: `rss:${feed}`,
      run: () => fetchRss(feed),
    });
  }
  if (prefs.trackHnHiring) {
    tasks.push({
      sourceKey: "hn-hiring:latest",
      run: () => fetchHnHiring(),
    });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  const postings: JobPosting[] = [];
  const errors: AggregateResult["errors"] = [];

  settled.forEach((res, i) => {
    const key = tasks[i].sourceKey;
    if (res.status === "fulfilled") {
      postings.push(...res.value);
    } else {
      errors.push({
        sourceKey: key,
        message:
          res.reason instanceof Error
            ? res.reason.message
            : String(res.reason),
      });
    }
  });

  // Dedupe by id — the same posting can appear in multiple sources (rare but
  // possible, e.g. a mirrored board).
  const seen = new Set<string>();
  const deduped = postings.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return { postings: deduped, errors };
}
