import type { JobPosting } from "../types";
import { stableId } from "../id";

// Workday public CXS API — no auth. From a careers URL like
//   https://a1group.wd3.myworkdayjobs.com/bg-BG/A1_Jobs
// derive the JSON endpoint
//   https://a1group.wd3.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs  (POST)
//
// source.company is the stable tenant (the expiry key); the display company
// name is the source's label (passed in) or the tenant.

export function parseRef(
  ref: string,
): { origin: string; tenant: string; site: string } | null {
  try {
    const u = new URL(ref);
    const tenant = u.hostname.split(".")[0];
    const segs = u.pathname.split("/").filter(Boolean); // e.g. ["bg-BG","A1_Jobs"]
    const site = segs[segs.length - 1];
    if (!tenant || !site) return null;
    return { origin: u.origin, tenant, site };
  } catch {
    return null;
  }
}

type WdPosting = { title?: string; locationsText?: string; externalPath?: string };

export async function fetchPostings(
  ref: string,
  displayName?: string,
): Promise<JobPosting[]> {
  const p = parseRef(ref);
  if (!p) return [];
  const endpoint = `${p.origin}/wday/cxs/${p.tenant}/${p.site}/jobs`;
  const out: JobPosting[] = [];
  const now = Date.now();
  const company = displayName || p.tenant;

  try {
    for (let offset = 0; offset < 100; offset += 20) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ limit: 20, offset, searchText: "", appliedFacets: {} }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) break;
      const data = (await res.json()) as { total?: number; jobPostings?: WdPosting[] };
      const jobs = Array.isArray(data.jobPostings) ? data.jobPostings : [];
      if (jobs.length === 0) break;
      for (const j of jobs) {
        const title = (j.title || "").trim();
        if (!title) continue;
        const url = `${p.origin}/${p.site}${j.externalPath || ""}`;
        out.push({
          id: stableId(["workday", url]),
          source: { kind: "workday", company: p.tenant },
          url,
          title,
          company,
          location: j.locationsText || undefined,
          fetchedAt: now,
        });
      }
      if (jobs.length < 20) break;
      if (typeof data.total === "number" && offset + 20 >= data.total) break;
    }
  } catch {
    // return whatever we collected
  }
  return out;
}
