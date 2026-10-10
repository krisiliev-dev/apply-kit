import type { JobPosting } from "../types";
import { stableId } from "../id";

// Jooble aggregator API (free key from jooble.org/api/about). Jooble crawls
// company portals + job boards across 69 countries incl. Bulgaria, so it
// overlaps the jobs.bg-type market (it does NOT carry LinkedIn — no aggregator
// does). Requires JOOBLE_API_KEY in .env.local.
//
// Source ref: "<keywords>" or "<keywords>|<location>", e.g.
//   "cyber security|Sofia"  /  "security engineer|Bulgaria"

export function parseRef(ref: string): { keywords: string; location?: string } {
  const [keywords, location] = (ref || "").split("|");
  return {
    keywords: (keywords || "").trim(),
    location: location && location.trim() ? location.trim() : undefined,
  };
}

type JoobleJob = {
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  link?: string;
  company?: string;
  updated?: string;
  type?: string;
};

export async function fetchPostings(ref: string): Promise<JobPosting[]> {
  const key = process.env.JOOBLE_API_KEY;
  if (!key) {
    throw new Error("JOOBLE_API_KEY not set in .env.local (free key at jooble.org/api/about).");
  }
  const { keywords, location } = parseRef(ref);
  let data: { jobs?: JoobleJob[] };
  try {
    const res = await fetch(`https://jooble.org/api/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords, location, page: "1" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    data = (await res.json()) as { jobs?: JoobleJob[] };
  } catch {
    return [];
  }

  const now = Date.now();
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs
    .map((j): JobPosting | null => {
      const url = (j.link || "").trim();
      const title = (j.title || "").trim();
      if (!url || !title) return null;
      return {
        id: stableId(["jooble", url]),
        source: { kind: "jooble", query: ref },
        url,
        title,
        company: (j.company || "").trim() || j.source || "via Jooble",
        location: (j.location || "").trim() || undefined,
        salary: (j.salary || "").trim() || undefined,
        description: j.snippet ? j.snippet.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : undefined,
        postedAt: j.updated ? Date.parse(j.updated) || undefined : undefined,
        fetchedAt: now,
      };
    })
    .filter((p): p is JobPosting => p !== null);
}
