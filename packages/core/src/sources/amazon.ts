// Amazon jobs search (unofficial: what amazon.jobs calls; robots.txt only disallows /internal).
// GET https://www.amazon.jobs/en/search.json?base_query=&result_limit=&offset=&sort=recent. No auth.
// Its location search (loc_query) doesn't actually filter, so a country is sent as
// normalized_country_code[] and every job's country_code is checked here as well.
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { field, keyPart, readJson, searchCap, splitShorthand, utcDate } from "./shared.ts";

export interface AmazonConfig {
  query: string;
  /** ISO 3166 alpha-3 country code ("BGR"), or "" for everywhere. */
  country: string;
}

interface AmazonJob {
  id_icims?: string;
  id?: string;
  title?: string;
  job_path?: string;
  normalized_location?: string;
  location?: string;
  country_code?: string;
  posted_date?: string;
  description?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
}

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export const amazon: SourceAdapter<AmazonConfig> = {
  kind: "amazon",
  category: "api",
  // A keyword search capped at its top results: missing from one Check never means gone.
  capped: true,
  label: "Amazon",

  parseConfig(raw) {
    const [query, country] = typeof raw === "string" ? splitShorthand(raw, 2) : [field(raw, "query") ?? "", field(raw, "country") ?? ""];
    if (!query) throw new Error(`An Amazon source needs a search like "security engineer|BGR", got ${JSON.stringify(raw)}`);
    if (country && !/^[a-z]{3}$/i.test(country)) throw new Error(`An Amazon source's country is a 3-letter code like "BGR", got ${JSON.stringify(country)}`);
    return { query, country: country!.toUpperCase() };
  },

  key: (c) => [c.query, c.country].filter(Boolean).map(keyPart).join("|"),
  defaultName: (c) => ["Amazon", c.query, c.country].filter(Boolean).join(" · "),

  async fetchPostings(config, { fetch }) {
    const params = new URLSearchParams({ base_query: config.query, result_limit: String(searchCap), offset: "0", sort: "recent" });
    if (config.country) params.append("normalized_country_code[]", config.country);
    const body = await readJson<{ error?: unknown; jobs?: AmazonJob[] }>(await fetch(`https://www.amazon.jobs/en/search.json?${params}`), "Amazon");
    if (body.error) throw new Error(`Amazon search failed: ${String(body.error)}`);
    if (!Array.isArray(body.jobs)) throw new Error("Amazon returned no job list");
    return body.jobs
      .filter((j) => !config.country || j.country_code?.toUpperCase() === config.country)
      .flatMap((j) => toPosting(j) ?? []);
  },
};

function toPosting(j: AmazonJob): FoundPosting | null {
  const id = j.id_icims || j.id;
  if (!id || !j.title || !j.job_path) return null;
  const sections = [
    j.description && `<p>${j.description}</p>`,
    j.basic_qualifications && `<h3>Basic qualifications</h3><p>${j.basic_qualifications}</p>`,
    j.preferred_qualifications && `<h3>Preferred qualifications</h3><p>${j.preferred_qualifications}</p>`,
  ].filter(Boolean);
  return {
    externalId: id,
    url: `https://www.amazon.jobs${j.job_path}`,
    title: j.title.trim(),
    // company_name is a legal entity ("AWS EMEA SARL (UK Branch)"); the Feed shows the employer.
    company: "Amazon",
    location: j.normalized_location?.trim() || j.location?.trim() || null,
    salary: null,
    postedAt: parsePostedDate(j.posted_date),
    descriptionHtml: sections.length ? sections.join("\n") : null,
  };
}

/** "May 19, 2026" → midnight UTC that day. */
function parsePostedDate(text: string | undefined): string | null {
  const m = /^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/i.exec(text?.trim() ?? "");
  if (!m) return null;
  const month = months.indexOf(m[1]!.toLowerCase());
  return month < 0 ? null : utcDate(Number(m[3]), month + 1, Number(m[2]));
}
