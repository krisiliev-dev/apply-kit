import type { JobPosting } from "../types";
import { stableId } from "../id";

// SmartRecruiters public Posting API — no auth, no ToS issue.
//   https://api.smartrecruiters.com/v1/companies/{companyId}/postings
// Used by Bosch (companyId "BoschGroup") and many enterprises.
//
// Source ref format: "<companyId>" or "<companyId>:<country>" to filter by
// country (e.g. "BoschGroup:bg"). source.company is the stable companyId (the
// expiry key); the human company name comes from the API.

export function parseRef(ref: string): { companyId: string; country?: string } {
  const [id, country] = (ref || "").split(":");
  return {
    companyId: (id || "").trim(),
    country: country && country.trim() ? country.trim().toLowerCase() : undefined,
  };
}

type SrPosting = {
  id?: string;
  uuid?: string;
  name?: string;
  releasedDate?: string;
  company?: { name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
};

export async function fetchPostings(ref: string): Promise<JobPosting[]> {
  const { companyId, country } = parseRef(ref);
  if (!companyId) return [];
  const params = new URLSearchParams({ limit: "100" });
  if (country) params.set("country", country);

  let data: { content?: SrPosting[] };
  try {
    const res = await fetch(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings?${params}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return [];
    data = (await res.json()) as { content?: SrPosting[] };
  } catch {
    return [];
  }

  const now = Date.now();
  const content = Array.isArray(data.content) ? data.content : [];
  return content
    .map((p): JobPosting | null => {
      const id = p.id || p.uuid;
      const title = (p.name || "").trim();
      if (!id || !title) return null;
      const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(companyId)}/${id}`;
      const loc = p.location
        ? [p.location.city, p.location.region, p.location.country]
            .filter(Boolean)
            .join(", ") || (p.location.remote ? "Remote" : undefined)
        : undefined;
      return {
        id: stableId(["smartrecruiters", url]),
        source: { kind: "smartrecruiters", company: companyId },
        url,
        title,
        company: (p.company && p.company.name) || companyId,
        location: loc,
        postedAt: p.releasedDate ? Date.parse(p.releasedDate) || undefined : undefined,
        fetchedAt: now,
      };
    })
    .filter((p): p is JobPosting => p !== null);
}
