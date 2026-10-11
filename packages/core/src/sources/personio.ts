// Personio XML feed: GET {account}.jobs.personio.de/xml (some accounts are on .jobs.personio.com).
// No auth, no pagination. Root <workzag-jobs>, one <position> per job. The feed has no job URL; the
// public page is {host}/job/{id}.
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { cleanText, formatLocation, humanizeSlug, joinHtml, toIsoUtc } from "./normalise.ts";
import { parseXml, textOf } from "./xml.ts";

export interface PersonioConfig {
  /** "{account}.jobs.personio.de" or "{account}.jobs.personio.com". */
  host: string;
}

interface PersonioPosition {
  id?: unknown;
  name?: unknown;
  subcompany?: unknown;
  office?: unknown[];
  additionalOffices?: { office?: unknown[] } | "";
  createdAt?: unknown;
  jobDescriptions?: { jobDescription?: { name?: unknown; value?: unknown }[] } | "";
}

const accountName = /^[a-z0-9][a-z0-9-]*$/i;

export const personio: SourceAdapter<PersonioConfig> = {
  kind: "personio",
  category: "ats",
  label: "Personio",

  parseConfig(raw) {
    const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const given = typeof raw === "string" ? raw : obj.host ?? obj.account;
    const text = typeof given === "string" ? given.trim().toLowerCase() : "";
    const url = /^(?:https?:\/\/)?([a-z0-9-]+)\.jobs\.personio\.(de|com)(?:[/?#].*)?$/.exec(text);
    const host = url ? `${url[1]}.jobs.personio.${url[2]}` : accountName.test(text) ? `${text}.jobs.personio.de` : null;
    if (!host) {
      throw new Error(`A Personio source needs a Personio account name like "personio" or its jobs.personio.de link, got ${JSON.stringify(raw)}`);
    }
    return { host };
  },

  key: (c) => c.host.replace(/\.jobs\.personio\.de$/, ""),
  defaultName: (c) => humanizeSlug(c.host.split(".")[0]!),

  async fetchPostings(config, { fetch }) {
    const res = await fetch(`https://${config.host}/xml`);
    if (!res.ok) throw new Error(`Personio answered ${res.status} for "${config.host}"`);
    const doc = parseXml(await res.text(), ["position", "office", "jobDescription"]);
    if (!("workzag-jobs" in doc)) throw new Error(`Personio "${config.host}" answered with something that is not a Personio jobs feed`);
    const positions = ((doc["workzag-jobs"] || {}) as { position?: PersonioPosition[] }).position ?? [];
    const fallback = personio.defaultName(config);
    return positions.flatMap((p) => {
      const id = cleanText(textOf(p.id));
      if (!id) return [];
      return [toPosting(p, id, `https://${config.host}/job/${id}`, fallback)];
    });
  },
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toPosting(p: PersonioPosition, id: string, url: string, fallbackCompany: string): FoundPosting {
  const offices = [...(p.office ?? []), ...((p.additionalOffices || {}).office ?? [])].map(textOf);
  const sections = (p.jobDescriptions || {}).jobDescription ?? [];
  return {
    externalId: id,
    url,
    title: cleanText(textOf(p.name)),
    company: cleanText(textOf(p.subcompany)) || fallbackCompany,
    location: formatLocation(offices),
    salary: null,
    postedAt: toIsoUtc(textOf(p.createdAt)),
    descriptionHtml: joinHtml(sections.map((s) => {
      const body = textOf(s.value).trim();
      return body ? `<h3>${escapeHtml(cleanText(textOf(s.name)))}</h3>\n${body}` : null;
    })),
  };
}
