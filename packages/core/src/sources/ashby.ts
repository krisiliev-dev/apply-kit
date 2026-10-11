// Ashby public job posting API: GET api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true.
// No auth, no pagination. The board name is case-sensitive (as in jobs.ashbyhq.com/{board}). The live
// response has no company name, `location` (not locationName) and `publishedAt` (not publishedDate).
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { cleanText, formatLocation, humanizeSlug, toIsoUtc, type Workplace } from "./normalise.ts";

export interface AshbyConfig {
  board: string;
  /** Ashby doesn't say the company's name; this is used when given. */
  company?: string;
}

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  location?: string | null;
  secondaryLocations?: { location?: string | null }[] | null;
  isListed?: boolean;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  publishedAt?: string | null;
  descriptionHtml?: string | null;
  compensation?: { compensationTierSummary?: string | null; scrapeableCompensationSalarySummary?: string | null } | null;
}

const boardName = /^[a-z0-9][a-z0-9._-]*$/i;

export const ashby: SourceAdapter<AshbyConfig> = {
  kind: "ashby",
  category: "ats",
  label: "Ashby",

  parseConfig(raw) {
    const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const given = typeof raw === "string" ? raw : obj.board;
    let board = typeof given === "string" ? given.trim() : "";
    const url = /^(?:https?:\/\/)?jobs\.ashbyhq\.com\/([^/?#]+)/i.exec(board);
    if (url) board = url[1]!;
    if (!boardName.test(board)) {
      throw new Error(`An Ashby source needs an Ashby board name like "Dext-Careers" or its jobs.ashbyhq.com link, got ${JSON.stringify(raw)}`);
    }
    const company = typeof obj.company === "string" && obj.company.trim() ? cleanText(obj.company) : undefined;
    return { board, ...(company ? { company } : {}) };
  },

  key: (c) => c.board,
  defaultName: (c) => c.company ?? humanizeSlug(c.board),

  async fetchPostings(config, { fetch }) {
    const base = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(config.board)}`;
    let res = await fetch(`${base}?includeCompensation=true`);
    // Some boards refuse the compensation flag; the postings are still worth having without pay.
    if (res.status === 400) res = await fetch(`${base}?includeCompensation=false`);
    if (!res.ok) throw new Error(`Ashby answered ${res.status} for board "${config.board}"`);
    const body = (await res.json()) as { jobs?: AshbyJob[] };
    if (!Array.isArray(body.jobs)) throw new Error(`Ashby board "${config.board}" returned no jobs list`);
    const company = ashby.defaultName(config);
    return body.jobs.filter((j) => j.isListed !== false).map((j) => toPosting(j, company));
  },
};

function toPosting(j: AshbyJob, company: string): FoundPosting {
  const type = j.workplaceType?.toLowerCase();
  const workplace: Workplace = type === "remote" ? "remote" : type === "hybrid" ? "hybrid" : !type && j.isRemote ? "remote" : null;
  return {
    externalId: j.id,
    url: j.jobUrl,
    title: cleanText(j.title),
    company,
    location: formatLocation([j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)], workplace),
    salary: cleanText(j.compensation?.compensationTierSummary ?? j.compensation?.scrapeableCompensationSalarySummary) || null,
    postedAt: toIsoUtc(j.publishedAt),
    descriptionHtml: j.descriptionHtml?.trim() || null,
  };
}
