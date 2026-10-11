// schema.org JobPosting in JSON-LD → Postings. DOM-free and pure, so the service (pasted links) and
// the extension (page capture) read job pages the same way. Most career sites and job systems embed
// one JobPosting per job page for search engines.
import { decodeEntities } from "../extraction/text.ts";
import { cleanText, countryName, formatLocation, formatSalary, place, toIsoUtc } from "../sources/normalise.ts";

/** One JobPosting as the page states it, normalised like any Source's postings. */
export interface LdJobPosting {
  /** The posting's own id (often the job system's requisition id), or null. */
  identifier: string | null;
  url: string;
  title: string;
  /** The hiring organisation, or null when the page doesn't say. */
  company: string | null;
  location: string | null;
  salary: string | null;
  postedAt: string | null;
  /** When the posting stops being valid (an expiry signal), or null. */
  validThrough: string | null;
  employmentType: string | null;
  descriptionHtml: string | null;
}

type Node = Record<string, unknown>;

const isObject = (v: unknown): v is Node => v !== null && typeof v === "object" && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string | null => {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const t = cleanText(decodeEntities(v));
  return t || null;
};

/** Every node in a JSON-LD document: arrays and `@graph`s flattened. */
function flatten(v: unknown, out: Node[] = []): Node[] {
  for (const item of asArray(v)) {
    if (!isObject(item)) continue;
    out.push(item);
    if (item["@graph"]) flatten(item["@graph"], out);
  }
  return out;
}

const isJobPosting = (n: Node) => asArray(n["@type"]).some((t) => t === "JobPosting" || t === "schema:JobPosting");

/**
 * Every JobPosting in the page's JSON-LD script texts. A script that isn't valid JSON is skipped.
 * Links are resolved against `pageUrl`, which is also the fallback link.
 */
export function jobPostingsFromLd(jsonTexts: string[], pageUrl: string): LdJobPosting[] {
  const out: LdJobPosting[] = [];
  for (const text of jsonTexts) {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      continue;
    }
    for (const node of flatten(doc)) if (isJobPosting(node)) {
      const posting = toPosting(node, pageUrl);
      if (posting) out.push(posting);
    }
  }
  return out;
}

function toPosting(n: Node, pageUrl: string): LdJobPosting | null {
  const title = str(n.title) ?? str(n.name);
  if (!title) return null;
  const description = typeof n.description === "string" ? n.description : null;
  return {
    identifier: identifierOf(n.identifier),
    url: resolve(str(n.url) ?? str(n.sameAs), pageUrl),
    title,
    company: organisation(n.hiringOrganization),
    location: locationOf(n),
    salary: salaryOf(n.baseSalary ?? n.estimatedSalary),
    postedAt: toIsoUtc(str(n.datePosted)),
    validThrough: toIsoUtc(str(n.validThrough)),
    employmentType: asArray(n.employmentType).map(str).filter(Boolean).join(", ") || null,
    // Descriptions are HTML, often entity-escaped once more ("&lt;p&gt;").
    descriptionHtml: description ? (/&lt;\/?[a-z]/i.test(description) ? decodeEntities(description) : description) : null,
  };
}

function resolve(link: string | null, pageUrl: string): string {
  if (!link) return pageUrl;
  try {
    const u = new URL(link, pageUrl);
    return /^https?:$/.test(u.protocol) ? u.href : pageUrl;
  } catch {
    return pageUrl;
  }
}

function identifierOf(v: unknown): string | null {
  for (const id of asArray(v)) {
    const value = isObject(id) ? str(id.value) ?? str(id["@id"]) : str(id);
    if (value) return value;
  }
  return null;
}

function organisation(v: unknown): string | null {
  for (const org of asArray(v)) {
    const name = isObject(org) ? str(org.name) : str(org);
    if (name) return name;
  }
  return null;
}

function locationOf(n: Node): string | null {
  const places = asArray(n.jobLocation).map((loc) => {
    if (!isObject(loc)) return str(loc);
    const a = isObject(loc.address) ? loc.address : typeof loc.address === "string" ? { addressLocality: loc.address } : null;
    if (!a) return str(loc.name);
    const country = isObject(a.addressCountry) ? str(a.addressCountry.name) : str(a.addressCountry);
    const region = str(a.addressRegion);
    return place(str(a.addressLocality), str(a.addressLocality) ? null : region, countryName(country) ?? country);
  });
  const remote = asArray(n.jobLocationType).some((t) => typeof t === "string" && /telecommute/i.test(t));
  // Remote jobs name where applicants may live instead of an office.
  if (remote && places.every((p) => !p)) {
    for (const r of asArray(n.applicantLocationRequirements)) {
      places.push(isObject(r) ? str(r.name) : str(r));
    }
  }
  return formatLocation(places, remote ? "remote" : null);
}

const periods: Record<string, string> = { HOUR: "hour", DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };

function salaryOf(v: unknown): string | null {
  const amount = asArray(v).find(isObject);
  if (!amount) return null;
  const currency = str(amount.currency);
  const value = amount.value;
  const num = (x: unknown) => {
    const n = typeof x === "number" ? x : typeof x === "string" ? Number(x.replace(/[\s,]/g, "")) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  if (isObject(value)) {
    const unit = str(value.unitText)?.toUpperCase();
    const min = num(value.minValue) ?? num(value.value);
    const max = num(value.maxValue) ?? (num(value.minValue) == null ? null : num(value.value));
    return formatSalary({ min, max: max ?? min, currency, period: unit ? periods[unit] ?? unit.toLowerCase() : null });
  }
  const single = num(value);
  return single == null ? null : formatSalary({ min: single, max: single, currency, period: null });
}
