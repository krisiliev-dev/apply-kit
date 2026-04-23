import type { JobPosting } from "../types";
import { stableId } from "../id";

// Greenhouse public Job Board API:
//   GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
// Returns { jobs: [{ id, title, absolute_url, location: { name }, content, updated_at, metadata? }] }.
// Content is HTML — we strip tags for a plain-text description.

type GhBoardJob = {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  updated_at?: string;
  metadata?: Array<{ name?: string; value?: unknown }>;
  company_name?: string;
};

type GhBoardResponse = {
  jobs?: GhBoardJob[];
};

export async function fetchPostings(slug: string): Promise<JobPosting[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // 15-min freshness is enforced by the caller; no revalidate here.
  });
  if (!res.ok) {
    // 404 = unknown board, 429 = rate-limited. Return empty — caller records
    // the attempt in lastFetchAt and the user can retry later.
    if (res.status === 404 || res.status === 429) return [];
    return [];
  }

  let data: GhBoardResponse;
  try {
    data = (await res.json()) as GhBoardResponse;
  } catch {
    return [];
  }

  const now = Date.now();
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];

  return jobs.map<JobPosting>((j) => {
    const postedAt = j.updated_at ? Date.parse(j.updated_at) : undefined;
    const salary = findMetadataValue(j.metadata, ["salary", "compensation"]);
    const description = htmlToText(j.content);
    return {
      id: stableId(["greenhouse", j.absolute_url, postedAt ?? ""]),
      source: { kind: "greenhouse", company: slug },
      url: j.absolute_url,
      title: j.title,
      company: j.company_name || humanizeSlug(slug),
      location: j.location?.name,
      salary,
      description,
      postedAt: Number.isFinite(postedAt) ? postedAt : undefined,
      fetchedAt: now,
    };
  });
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function findMetadataValue(
  metadata: GhBoardJob["metadata"],
  nameContains: string[],
): string | undefined {
  if (!Array.isArray(metadata)) return undefined;
  for (const m of metadata) {
    const name = (m.name ?? "").toLowerCase();
    if (nameContains.some((n) => name.includes(n))) {
      if (typeof m.value === "string") return m.value;
      if (Array.isArray(m.value)) return m.value.filter(Boolean).join(", ");
      if (m.value != null) return String(m.value);
    }
  }
  return undefined;
}

function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  // Greenhouse ships content HTML-escaped inside JSON. We decode a handful of
  // the common entities and strip tags — good enough for keyword matching.
  const decoded = html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return decoded
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
