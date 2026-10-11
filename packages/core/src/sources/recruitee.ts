// Recruitee offers API: GET {company}.recruitee.com/api/offers/ (or {custom careers domain}/api/offers/).
// No auth, no pagination (every published offer). An offer's own `location` can mislead ("Remote job"
// for a hybrid Sofia role), so locations come from `locations[]` and the remote/hybrid flags.
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { cleanText, formatLocation, formatSalary, humanizeSlug, joinHtml, place, toIsoUtc, type Workplace } from "./normalise.ts";

export interface RecruiteeConfig {
  /** The careers site host: "{company}.recruitee.com" or the company's own careers domain. */
  host: string;
}

interface RecruiteeOffer {
  id: number;
  title: string;
  company_name?: string | null;
  careers_url: string;
  city?: string | null;
  country?: string | null;
  locations?: { city?: string | null; country?: string | null }[] | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  published_at?: string | null;
  description?: string | null;
  requirements?: string | null;
  salary?: { min?: number | string | null; max?: number | string | null; period?: string | null; currency?: string | null } | null;
}

const companySlug = /^[a-z0-9][a-z0-9-]*$/i;
const hostName = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export const recruitee: SourceAdapter<RecruiteeConfig> = {
  kind: "recruitee",
  category: "ats",
  label: "Recruitee",

  parseConfig(raw) {
    const given = typeof raw === "string" ? raw : (raw as { company?: unknown; host?: unknown } | null)?.host ?? (raw as { company?: unknown } | null)?.company;
    const text = typeof given === "string" ? given.trim() : "";
    const url = /^(?:https?:\/\/)?([^/?#\s]+)\/?(?:api\/offers\/?)?$/i.exec(text);
    const candidate = url ? url[1]!.toLowerCase() : "";
    const host = companySlug.test(candidate) ? `${candidate}.recruitee.com` : hostName.test(candidate) ? candidate : null;
    if (!host) {
      throw new Error(`A Recruitee source needs a Recruitee company name like "accedia" or its careers site link, got ${JSON.stringify(raw)}`);
    }
    return { host };
  },

  key: (c) => c.host.replace(/\.recruitee\.com$/, ""),
  defaultName: (c) => humanizeSlug(c.host.endsWith(".recruitee.com") ? c.host.split(".")[0]! : c.host),

  async fetchPostings(config, { fetch }) {
    const res = await fetch(`https://${config.host}/api/offers/`);
    if (!res.ok) throw new Error(`Recruitee answered ${res.status} for "${config.host}"`);
    const body = (await res.json()) as { offers?: RecruiteeOffer[] };
    if (!Array.isArray(body.offers)) throw new Error(`Recruitee site "${config.host}" returned no offers list`);
    const fallback = recruitee.defaultName(config);
    return body.offers.map((o) => toPosting(o, fallback));
  },
};

const amount = (x: number | string | null | undefined) => (x == null || x === "" || Number.isNaN(Number(x)) ? null : Number(x));

function toPosting(o: RecruiteeOffer, fallbackCompany: string): FoundPosting {
  const workplace: Workplace = o.hybrid ? "hybrid" : o.remote ? "remote" : null;
  const places = o.locations?.length ? o.locations.map((l) => place(l.city, l.country)) : [place(o.city, o.country)];
  return {
    externalId: String(o.id),
    url: o.careers_url,
    title: cleanText(o.title),
    company: cleanText(o.company_name) || fallbackCompany,
    location: formatLocation(places, workplace),
    salary: o.salary ? formatSalary({ min: amount(o.salary.min), max: amount(o.salary.max), currency: o.salary.currency, period: o.salary.period }) : null,
    postedAt: toIsoUtc(o.published_at),
    descriptionHtml: joinHtml([o.description, o.requirements]),
  };
}
