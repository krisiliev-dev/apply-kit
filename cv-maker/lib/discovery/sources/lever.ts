import type { JobPosting } from "../types";
import { stableId } from "../id";

// Lever public postings API:
//   GET https://api.lever.co/v0/postings/<slug>?mode=json
// Returns an array of postings:
//   { id, text, hostedUrl, applyUrl, createdAt, categories: {...}, descriptionPlain, ... }

type LeverPosting = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
    department?: string;
  };
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  salaryDescriptionPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string };
};

export async function fetchPostings(slug: string): Promise<JobPosting[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    if (res.status === 404 || res.status === 429) return [];
    return [];
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const now = Date.now();
  return (data as LeverPosting[]).map<JobPosting>((p) => {
    const postedAt = typeof p.createdAt === "number" ? p.createdAt : undefined;
    const description =
      p.descriptionPlain ?? stripHtml(p.description) ?? p.additionalPlain;
    const salary = formatSalary(p.salaryRange) ?? p.salaryDescriptionPlain;
    return {
      id: stableId(["lever", p.hostedUrl, postedAt ?? ""]),
      source: { kind: "lever", company: slug },
      url: p.hostedUrl,
      title: p.text,
      company: humanizeSlug(slug),
      location: p.categories?.location,
      salary,
      description,
      postedAt,
      fetchedAt: now,
    };
  });
}

function formatSalary(
  range: LeverPosting["salaryRange"],
): string | undefined {
  if (!range || (range.min == null && range.max == null)) return undefined;
  const cur = range.currency ? `${range.currency} ` : "";
  if (range.min != null && range.max != null) {
    return `${cur}${range.min}–${range.max}`;
  }
  return `${cur}${range.min ?? range.max}`;
}

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
