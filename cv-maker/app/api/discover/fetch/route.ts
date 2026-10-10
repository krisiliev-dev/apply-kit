import { aggregate } from "@/lib/discovery/aggregate";
import { readAllIngest } from "@/lib/discovery/ingestBuffer";
import type { DiscoveryPreferences, JobPosting } from "@/lib/discovery/types";
import { DEFAULT_DISCOVERY_PREFERENCES } from "@/lib/discovery/types";

// POST /api/discover/fetch
// Body: { prefs: DiscoveryPreferences, sinceMs?: number }
// Returns: { postings: JobPosting[], errors: [...], cacheHits: [...] }
//
// Scoring lives on the client (the user's CVs are in localStorage), so this
// route is purely an aggregator. We cache each source-key's postings for
// 15 minutes to avoid hammering the public APIs.

export const runtime = "nodejs";
export const maxDuration = 60;

const CACHE_TTL_MS = 15 * 60 * 1000;

type CacheEntry = {
  at: number;
  postings: JobPosting[];
};

// Module-level cache — mounted on globalThis so HMR / repeated module loads
// share it during dev.
const CACHE_KEY = "__cv_maker_discovery_fetch_cache__";
function getCache(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & {
    [CACHE_KEY]?: Map<string, CacheEntry>;
  };
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map();
  return g[CACHE_KEY];
}

type Body = {
  prefs?: Partial<DiscoveryPreferences>;
  sinceMs?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const prefs = mergePrefs(body.prefs);
  const sinceMs =
    typeof body.sinceMs === "number" && body.sinceMs > 0 ? body.sinceMs : 0;

  // Build the set of source keys this request cares about.
  const sourceKeys: string[] = [
    ...prefs.watchlist.greenhouse.map((s) => `greenhouse:${s}`),
    ...prefs.watchlist.lever.map((s) => `lever:${s}`),
    ...prefs.watchlist.ashby.map((s) => `ashby:${s}`),
    ...prefs.rssFeeds.map((f) => `rss:${f}`),
  ];
  if (prefs.trackHnHiring) sourceKeys.push("hn-hiring:latest");

  // Partition into "served from cache" vs "needs fetch". We build a reduced
  // prefs object containing only the misses so the aggregator doesn't re-hit
  // still-fresh sources.
  const cache = getCache();
  const now = Date.now();
  const cachedPostings: JobPosting[] = [];
  const cacheHits: string[] = [];
  const missPrefs: DiscoveryPreferences = {
    ...prefs,
    watchlist: { greenhouse: [], lever: [], ashby: [] },
    rssFeeds: [],
    trackHnHiring: false,
  };

  for (const slug of prefs.watchlist.greenhouse) {
    const key = `greenhouse:${slug}`;
    const entry = cache.get(key);
    if (entry && now - entry.at < CACHE_TTL_MS) {
      cachedPostings.push(...entry.postings);
      cacheHits.push(key);
    } else {
      missPrefs.watchlist.greenhouse.push(slug);
    }
  }
  for (const slug of prefs.watchlist.lever) {
    const key = `lever:${slug}`;
    const entry = cache.get(key);
    if (entry && now - entry.at < CACHE_TTL_MS) {
      cachedPostings.push(...entry.postings);
      cacheHits.push(key);
    } else {
      missPrefs.watchlist.lever.push(slug);
    }
  }
  for (const slug of prefs.watchlist.ashby) {
    const key = `ashby:${slug}`;
    const entry = cache.get(key);
    if (entry && now - entry.at < CACHE_TTL_MS) {
      cachedPostings.push(...entry.postings);
      cacheHits.push(key);
    } else {
      missPrefs.watchlist.ashby.push(slug);
    }
  }
  for (const feed of prefs.rssFeeds) {
    const key = `rss:${feed}`;
    const entry = cache.get(key);
    if (entry && now - entry.at < CACHE_TTL_MS) {
      cachedPostings.push(...entry.postings);
      cacheHits.push(key);
    } else {
      missPrefs.rssFeeds.push(feed);
    }
  }
  if (prefs.trackHnHiring) {
    const key = "hn-hiring:latest";
    const entry = cache.get(key);
    if (entry && now - entry.at < CACHE_TTL_MS) {
      cachedPostings.push(...entry.postings);
      cacheHits.push(key);
    } else {
      missPrefs.trackHnHiring = true;
    }
  }

  const result = await aggregate(missPrefs);

  // Bucket freshly-fetched postings back into cache entries, keyed by their
  // source key.
  bucketAndCache(result.postings, cache, now);

  // Ingestions from the extension — always include, since they're
  // user-initiated captures.
  const ingested = sinceMs > 0 ? readAllIngest() : readAllIngest();
  const ingestedSince = sinceMs > 0
    ? ingested.filter((p) => p.fetchedAt >= sinceMs)
    : ingested;

  // Combine + dedupe by id.
  const combined = [...cachedPostings, ...result.postings, ...ingestedSince];
  const seen = new Set<string>();
  const postings = combined.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return json({
    postings,
    errors: result.errors,
    cacheHits,
    sourceKeys,
  });
}

function bucketAndCache(
  postings: JobPosting[],
  cache: Map<string, CacheEntry>,
  at: number,
) {
  const bucketed = new Map<string, JobPosting[]>();
  for (const p of postings) {
    const key = sourceKeyOf(p);
    if (!key) continue;
    const arr = bucketed.get(key) ?? [];
    arr.push(p);
    bucketed.set(key, arr);
  }
  for (const [key, arr] of bucketed) {
    cache.set(key, { at, postings: arr });
  }
}

function sourceKeyOf(p: JobPosting): string | null {
  switch (p.source.kind) {
    case "greenhouse":
    case "lever":
    case "ashby":
      return `${p.source.kind}:${p.source.company}`;
    case "hn-hiring":
      return "hn-hiring:latest";
    case "rss":
      return `rss:${p.source.feedUrl}`;
    default:
      return null;
  }
}

function mergePrefs(partial: Partial<DiscoveryPreferences> | undefined): DiscoveryPreferences {
  const p = partial ?? {};
  return {
    ...DEFAULT_DISCOVERY_PREFERENCES,
    ...p,
    watchlist: {
      greenhouse: Array.isArray(p.watchlist?.greenhouse)
        ? p.watchlist.greenhouse
        : [],
      lever: Array.isArray(p.watchlist?.lever) ? p.watchlist.lever : [],
      ashby: Array.isArray(p.watchlist?.ashby) ? p.watchlist.ashby : [],
    },
    rssFeeds: Array.isArray(p.rssFeeds) ? p.rssFeeds : [],
    workAuth: Array.isArray(p.workAuth) ? p.workAuth : [],
    preferredLocations: Array.isArray(p.preferredLocations)
      ? p.preferredLocations
      : [],
    titleDenylist: Array.isArray(p.titleDenylist) ? p.titleDenylist : [],
    trackHnHiring: Boolean(p.trackHnHiring),
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
