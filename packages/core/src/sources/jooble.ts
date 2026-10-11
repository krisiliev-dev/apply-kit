// Jooble REST API (needs a key; JOOBLE_API_KEY). POST https://jooble.org/api/{key} with
// {keywords, location, page}. The key sits in the URL, so request URLs never appear in errors.
// Known quirk: "Sofia" finds nothing, so search "Bulgaria"; with no location results flood with US roles.
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { checkKeyAccepted, keyPart, parseSearch, readJson, requireSetting, searchCap } from "./shared.ts";

export interface JoobleConfig {
  keywords: string;
  location: string;
}

interface JoobleJob {
  id?: number | string;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  link?: string;
  company?: string;
  updated?: string;
}

const maxPages = 5;

export const jooble: SourceAdapter<JoobleConfig> = {
  kind: "jooble",
  category: "aggregator",
  label: "Jooble",

  parseConfig: (raw) => parseSearch(raw, "Jooble", "security|Bulgaria"),
  key: (c) => [c.keywords, c.location].filter(Boolean).map(keyPart).join("|"),
  defaultName: (c) => ["Jooble", c.keywords, c.location].filter(Boolean).join(" · "),

  async fetchPostings(config, ctx) {
    const key = requireSetting(ctx, "JOOBLE_API_KEY", "Jooble");
    const out = new Map<string, FoundPosting>();
    for (let page = 1; page <= maxPages && out.size < searchCap; page++) {
      const res = await ctx.fetch(`https://jooble.org/api/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keywords: config.keywords, location: config.location, page: String(page) }),
      });
      checkKeyAccepted(res, "JOOBLE_API_KEY", "Jooble");
      const body = await readJson<{ totalCount?: number; jobs?: JoobleJob[] }>(res, "Jooble");
      if (!Array.isArray(body.jobs)) throw new Error("Jooble returned no job list");
      for (const j of body.jobs) {
        const p = toPosting(j);
        if (p && out.size < searchCap) out.set(p.externalId, p);
      }
      if (body.jobs.length === 0 || out.size >= Number(body.totalCount ?? 0)) break;
    }
    return [...out.values()];
  },
};

function toPosting(j: JoobleJob): FoundPosting | null {
  if (!j.title || !j.link) return null;
  // Jooble ids are larger than a JSON number holds exactly, so read the id from the link's text.
  const externalId = /\/desc\/(-?\d+)/.exec(j.link)?.[1] ?? (j.id != null ? String(j.id) : j.link);
  return {
    externalId,
    url: j.link,
    title: j.title.trim(),
    company: j.company?.trim() || "Company not stated",
    location: j.location?.trim() || null,
    salary: j.salary?.trim() || null,
    postedAt: parseUpdated(j.updated),
    descriptionHtml: j.snippet?.trim() || null,
  };
}

/** "2026-10-09T00:00:00.0000000" (no zone, 7 fraction digits) → ISO 8601 UTC. */
function parseUpdated(text: string | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(text?.trim() ?? "");
  if (!m) return null;
  const d = new Date(`${m[1]}.${(m[2] ?? "0").padEnd(3, "0").slice(0, 3)}${m[3] ?? "Z"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
