// Reed jobseeker API (needs a key; REED_API_KEY). GET https://www.reed.co.uk/api/1.0/search
// with Basic auth: the key as user name, empty password. UK jobs only; up to 100 per request.
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { checkKeyAccepted, escapeHtml, keyPart, parseSearch, readJson, requireSetting, searchCap, utcDate } from "./shared.ts";

export interface ReedConfig {
  keywords: string;
  location: string;
}

interface ReedJob {
  jobId?: number;
  employerName?: string;
  jobTitle?: string;
  locationName?: string;
  minimumSalary?: number | null;
  maximumSalary?: number | null;
  currency?: string | null;
  date?: string;
  jobDescription?: string;
  jobUrl?: string;
}

export const reed: SourceAdapter<ReedConfig> = {
  kind: "reed",
  category: "api",
  label: "Reed",

  parseConfig: (raw) => parseSearch(raw, "Reed", "security|London"),
  key: (c) => [c.keywords, c.location].filter(Boolean).map(keyPart).join("|"),
  defaultName: (c) => ["Reed", c.keywords, c.location].filter(Boolean).join(" · "),

  async fetchPostings(config, ctx) {
    const key = requireSetting(ctx, "REED_API_KEY", "Reed");
    const params = new URLSearchParams({ keywords: config.keywords });
    if (config.location) params.set("locationName", config.location);
    params.set("resultsToTake", String(searchCap));
    params.set("resultsToSkip", "0");
    const res = await ctx.fetch(`https://www.reed.co.uk/api/1.0/search?${params}`, {
      headers: { authorization: `Basic ${btoa(`${key}:`)}`, accept: "application/json" },
    });
    checkKeyAccepted(res, "REED_API_KEY", "Reed");
    const body = await readJson<{ results?: ReedJob[] }>(res, "Reed");
    if (!Array.isArray(body.results)) throw new Error("Reed returned no results list");
    return body.results.flatMap((j) => toPosting(j) ?? []);
  },
};

function toPosting(j: ReedJob): FoundPosting | null {
  if (j.jobId == null || !j.jobTitle || !j.jobUrl) return null;
  const description = j.jobDescription?.trim();
  return {
    externalId: String(j.jobId),
    url: j.jobUrl,
    title: j.jobTitle.trim(),
    company: j.employerName?.trim() || "Company not stated",
    location: j.locationName?.trim() || null,
    salary: salaryText(j),
    postedAt: parseDayMonthYear(j.date),
    // A snippet of plain text; the full description is on the job page.
    descriptionHtml: description ? `<p>${escapeHtml(description)}</p>` : null,
  };
}

function salaryText(j: ReedJob): string | null {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
  const cur = j.currency?.trim() || "GBP";
  const min = j.minimumSalary ?? null;
  const max = j.maximumSalary ?? null;
  if (min && max) return min === max ? `${cur} ${fmt(min)}` : `${cur} ${fmt(min)}–${fmt(max)}`;
  if (min) return `From ${cur} ${fmt(min)}`;
  if (max) return `Up to ${cur} ${fmt(max)}`;
  return null;
}

/** "08/10/2026" (day first) → midnight UTC. */
function parseDayMonthYear(text: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text?.trim() ?? "");
  return m ? utcDate(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}
