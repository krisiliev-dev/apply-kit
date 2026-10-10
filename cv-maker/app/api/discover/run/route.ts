import { aggregate } from "@/lib/discovery/aggregate";
import { fetchPostings as fetchCareerPage } from "@/lib/discovery/sources/careerpage";
import { fetchPostings as fetchDevBg, isDevBg } from "@/lib/discovery/sources/devbg";
import {
  fetchPostings as fetchSmartRecruiters,
  parseRef as srParseRef,
} from "@/lib/discovery/sources/smartrecruiters";
import {
  fetchPostings as fetchWorkday,
  parseRef as wdParseRef,
} from "@/lib/discovery/sources/workday";
import { fetchPostings as fetchJooble } from "@/lib/discovery/sources/jooble";
import { fetchPostings as fetchArbeitnow } from "@/lib/discovery/sources/arbeitnow";
import {
  fetchReed,
  fetchRemotive,
  fetchJobicy,
  fetchThemuse,
  fetchFindwork,
  fetchEures,
} from "@/lib/discovery/sources/jobapis";
import {
  effectivePrefs,
  expireMissing,
  ingestPostings,
  listPostings,
  listSources,
  readDiscoveryPrefs,
  touchSourcesCrawled,
} from "@/lib/doc/serverStore";
import type { DiscoverySource, JobPosting } from "@/lib/discovery/types";

// POST /api/discover/run
//
// Crawls everything enabled — ATS slugs/RSS/HN via the aggregator, plus the
// "direct" sources (careerpage/board via JSON-LD/dev.bg crawler, and the
// SmartRecruiters/Workday ATS APIs) — merges fresh postings into the pool,
// then expires postings whose source was crawled but that no longer appear.
// Backs the MCP `run_discovery` tool and the /discover refresh button.

export const runtime = "nodejs";
export const maxDuration = 300;

const ATS_RSS_KINDS = new Set(["greenhouse", "lever", "ashby", "rss"]);
const DIRECT_KINDS = new Set([
  "careerpage",
  "board",
  "smartrecruiters",
  "workday",
  "jooble",
  "arbeitnow",
  "reed",
  "remotive",
  "jobicy",
  "themuse",
  "findwork",
  "eures",
]);

const JOBAPI_FETCHERS: Record<string, (ref: string) => Promise<JobPosting[]>> = {
  reed: fetchReed,
  remotive: fetchRemotive,
  jobicy: fetchJobicy,
  themuse: fetchThemuse,
  findwork: fetchFindwork,
  eures: fetchEures,
};

function crawlDirect(s: DiscoverySource): Promise<JobPosting[]> {
  if (s.kind === "smartrecruiters") return fetchSmartRecruiters(s.ref);
  if (s.kind === "workday") return fetchWorkday(s.ref, s.label);
  if (s.kind === "jooble") return fetchJooble(s.ref);
  if (s.kind === "arbeitnow") return fetchArbeitnow(s.ref);
  const jobapi = JOBAPI_FETCHERS[s.kind];
  if (jobapi) return jobapi(s.ref);
  return isDevBg(s.ref) ? fetchDevBg(s.ref) : fetchCareerPage(s.ref);
}

function directKeyFor(s: DiscoverySource): string {
  if (s.kind === "smartrecruiters") return `smartrecruiters:${srParseRef(s.ref).companyId}`;
  if (s.kind === "workday") {
    const p = wdParseRef(s.ref);
    return `workday:${p ? p.tenant : s.ref}`;
  }
  if (s.kind === "jooble") return `jooble:${s.ref}`;
  if (s.kind === "arbeitnow") return `arbeitnow:${s.ref}`;
  if (JOBAPI_FETCHERS[s.kind]) return `jobapi:${s.kind}:${s.ref}`;
  return `careerpage:${s.ref}`;
}

export async function POST() {
  try {
    const [prefs, sources] = await Promise.all([
      readDiscoveryPrefs(),
      listSources(),
    ]);
    const eff = effectivePrefs(prefs, sources);

    // ATS slugs / RSS / HN via the aggregator.
    const atsResult = await aggregate(eff);

    // Direct sources, crawled in parallel; one failing never stops the batch.
    const directSources = sources.filter(
      (s) => s.enabled && DIRECT_KINDS.has(s.kind),
    );
    const directSettled = await Promise.allSettled(
      directSources.map(crawlDirect),
    );
    const directPostings: JobPosting[] = [];
    const directErrors: Array<{ sourceKey: string; message: string }> = [];
    const directKeys: string[] = [];
    directSettled.forEach((r, i) => {
      const key = directKeyFor(directSources[i]);
      directKeys.push(key);
      if (r.status === "fulfilled") directPostings.push(...r.value);
      else
        directErrors.push({
          sourceKey: key,
          message: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
    });

    const fresh = [...atsResult.postings, ...directPostings];
    const added = await ingestPostings(fresh);

    // Expiry — scope to source keys actually crawled this run.
    const crawledKeys = new Set<string>([
      ...eff.watchlist.greenhouse.map((s) => `greenhouse:${s}`),
      ...eff.watchlist.lever.map((s) => `lever:${s}`),
      ...eff.watchlist.ashby.map((s) => `ashby:${s}`),
      ...eff.rssFeeds.map((f) => `rss:${f}`),
      ...directKeys,
    ]);
    if (eff.trackHnHiring) crawledKeys.add("hn-hiring:latest");
    const liveIds = new Set(fresh.map((p) => p.id));
    const closed = await expireMissing(crawledKeys, liveIds);

    const all = await listPostings();
    await touchSourcesCrawled(
      sources
        .filter((s) => s.enabled && (ATS_RSS_KINDS.has(s.kind) || DIRECT_KINDS.has(s.kind)))
        .map((s) => s.id),
    );

    return Response.json({
      fetched: fresh.length,
      added,
      closed,
      total: all.length,
      open: all.filter((p) => !p.closedAt).length,
      errors: [...atsResult.errors, ...directErrors],
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Run failed." },
      { status: 500 },
    );
  }
}
