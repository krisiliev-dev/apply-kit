// Teamtailor RSS: GET {company}.teamtailor.com/jobs.rss (or {custom careers domain}/jobs.rss). No auth.
// 100 items by default; we ask for per_page=200 and page with `offset` until a short page. The channel
// title is the company. Locations are tt:location elements (tt:city is Latin; tt:name may be Cyrillic).
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { cleanText, formatLocation, humanizeSlug, place, toIsoUtc, type Workplace } from "./normalise.ts";
import { parseXml, textOf } from "./xml.ts";

export interface TeamtailorConfig {
  /** "{company}.teamtailor.com" or the company's own careers domain. */
  host: string;
}

interface TeamtailorItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: unknown;
  description?: unknown;
  remoteStatus?: unknown;
  "tt:locations"?: { "tt:location"?: Record<string, unknown>[] } | "";
}

const companySlug = /^[a-z0-9][a-z0-9-]*$/i;
const hostName = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const perPage = 200;
/** Teamtailor's default page size: a page shorter than this is certainly the last. */
const shortPage = 100;
const maxPages = 20;

export const teamtailor: SourceAdapter<TeamtailorConfig> = {
  kind: "teamtailor",
  category: "ats",
  label: "Teamtailor",

  parseConfig(raw) {
    const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const given = typeof raw === "string" ? raw : obj.host ?? obj.company;
    const text = typeof given === "string" ? given.trim() : "";
    const url = /^(?:https?:\/\/)?([^/?#\s]+)(?:\/(?:jobs(?:\.rss)?)?\/?)?$/i.exec(text);
    const candidate = url ? url[1]!.toLowerCase() : "";
    const host = companySlug.test(candidate) ? `${candidate}.teamtailor.com` : hostName.test(candidate) ? candidate : null;
    if (!host) {
      throw new Error(`A Teamtailor source needs a Teamtailor company name like "superhosting" or its careers site link, got ${JSON.stringify(raw)}`);
    }
    return { host };
  },

  key: (c) => c.host.replace(/\.teamtailor\.com$/, ""),
  defaultName: (c) => (c.host.endsWith(".teamtailor.com") ? humanizeSlug(c.host.split(".")[0]!) : c.host),

  async fetchPostings(config, { fetch }) {
    const byGuid = new Map<string, FoundPosting>();
    for (let page = 0; ; page++) {
      if (page === maxPages) throw new Error(`Teamtailor feed "${config.host}" has more than ${maxPages} pages`);
      const offset = byGuid.size ? `&offset=${byGuid.size}` : "";
      const res = await fetch(`https://${config.host}/jobs.rss?per_page=${perPage}${offset}`);
      if (!res.ok) throw new Error(`Teamtailor answered ${res.status} for "${config.host}"`);
      const doc = parseXml(await res.text(), ["item", "tt:location"]);
      const channel = (doc.rss as { channel?: { title?: unknown; item?: TeamtailorItem[] } } | undefined)?.channel;
      if (!channel) throw new Error(`Teamtailor "${config.host}" answered with something that is not an RSS feed`);
      const items = channel.item ?? [];
      const company = cleanText(textOf(channel.title)) || teamtailor.defaultName(config);
      const before = byGuid.size;
      for (const item of items) {
        const p = toPosting(item, company);
        if (p) byGuid.set(p.externalId, p);
      }
      if (items.length < shortPage || byGuid.size === before) break;
    }
    return [...byGuid.values()];
  },
};

const workplaces: Record<string, Workplace> = { fully: "remote", remote: "remote", hybrid: "hybrid" };

function toPosting(item: TeamtailorItem, company: string): FoundPosting | null {
  const url = cleanText(textOf(item.link));
  const externalId = cleanText(textOf(item.guid)) || url;
  if (!externalId || !url) return null;
  const locations = (item["tt:locations"] || {})["tt:location"] ?? [];
  return {
    externalId,
    url,
    title: cleanText(textOf(item.title)),
    company,
    location: formatLocation(
      locations.map((l) => place(textOf(l["tt:city"]) || textOf(l["tt:name"]), textOf(l["tt:country"]))),
      workplaces[cleanText(textOf(item.remoteStatus)).toLowerCase()] ?? null,
    ),
    salary: null,
    postedAt: toIsoUtc(textOf(item.pubDate)),
    descriptionHtml: textOf(item.description).trim() || null,
  };
}
