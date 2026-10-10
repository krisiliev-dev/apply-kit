import type { JobPosting } from "../types";
import { stableId } from "../id";

// Ashby public job board API:
//   GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
// Some boards reject includeCompensation=true with 400. We fall back to false.
// Response shape: { jobs: [{ id, title, locationName, publishedDate, jobUrl,
//   descriptionHtml, descriptionPlain, compensation?, ...}] }

type AshbyJob = {
  id: string;
  title: string;
  locationName?: string;
  publishedDate?: string;
  jobUrl: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: {
    summaryComponents?: Array<{ compensationTierSummary?: string }>;
    compensationTierSummary?: string;
  };
};

type AshbyResponse = {
  jobs?: AshbyJob[];
  organizationName?: string;
};

export async function fetchPostings(slug: string): Promise<JobPosting[]> {
  const base = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
  let res = await fetch(`${base}?includeCompensation=true`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    // Retry without compensation for boards that reject the flag.
    res = await fetch(`${base}?includeCompensation=false`, {
      headers: { accept: "application/json" },
    });
  }
  if (!res.ok) {
    if (res.status === 404 || res.status === 429) return [];
    return [];
  }

  let data: AshbyResponse;
  try {
    data = (await res.json()) as AshbyResponse;
  } catch {
    return [];
  }
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const company = data.organizationName || humanizeSlug(slug);
  const now = Date.now();

  return jobs.map<JobPosting>((j) => {
    const postedAt = j.publishedDate ? Date.parse(j.publishedDate) : undefined;
    const description =
      j.descriptionPlain ??
      (j.descriptionHtml
        ? j.descriptionHtml
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        : undefined);
    const salary = extractAshbyCompensation(j.compensation);
    return {
      id: stableId(["ashby", j.jobUrl, postedAt ?? ""]),
      source: { kind: "ashby", company: slug },
      url: j.jobUrl,
      title: j.title,
      company,
      location: j.locationName,
      salary,
      description,
      postedAt: Number.isFinite(postedAt) ? postedAt : undefined,
      fetchedAt: now,
    };
  });
}

function extractAshbyCompensation(
  c: AshbyJob["compensation"],
): string | undefined {
  if (!c) return undefined;
  if (typeof c.compensationTierSummary === "string") {
    return c.compensationTierSummary;
  }
  const parts = c.summaryComponents
    ?.map((s) => s.compensationTierSummary)
    .filter((s): s is string => typeof s === "string");
  return parts && parts.length > 0 ? parts.join(" · ") : undefined;
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
