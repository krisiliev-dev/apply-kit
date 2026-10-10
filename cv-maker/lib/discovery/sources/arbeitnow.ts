import type { JobPosting } from "../types";
import { stableId } from "../id";

// Arbeitnow free Job Board API — public, no auth. EU + remote jobs sourced
// from ATSes. We fetch the recent feed and (optionally) filter by a keyword.
//
// Source ref: a keyword filter (e.g. "security"), or "" / "*" for everything.

type AnJob = {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  location?: string;
  tags?: string[];
  created_at?: number;
};

export function parseRef(ref: string): { keyword: string } {
  const k = (ref || "").trim();
  return { keyword: k === "*" ? "" : k };
}

export async function fetchPostings(ref: string): Promise<JobPosting[]> {
  const { keyword } = parseRef(ref);
  let data: { data?: AnJob[] };
  try {
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    data = (await res.json()) as { data?: AnJob[] };
  } catch {
    return [];
  }

  const now = Date.now();
  const kw = keyword.toLowerCase();
  const jobs = Array.isArray(data.data) ? data.data : [];
  return jobs
    .filter((j) => {
      if (!kw) return true;
      const hay = `${j.title ?? ""} ${(j.tags ?? []).join(" ")} ${j.description ?? ""}`.toLowerCase();
      return hay.includes(kw);
    })
    .map((j): JobPosting | null => {
      const url = (j.url || "").trim();
      const title = (j.title || "").trim();
      if (!url || !title) return null;
      return {
        id: stableId(["arbeitnow", url]),
        source: { kind: "arbeitnow", query: ref },
        url,
        title,
        company: (j.company_name || "").trim() || "via Arbeitnow",
        location: j.remote ? `Remote${j.location ? ` (${j.location})` : ""}` : j.location || undefined,
        postedAt: typeof j.created_at === "number" ? j.created_at * 1000 : undefined,
        fetchedAt: now,
      };
    })
    .filter((p): p is JobPosting => p !== null);
}
