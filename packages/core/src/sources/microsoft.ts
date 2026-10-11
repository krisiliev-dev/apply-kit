// Microsoft careers search (unofficial: what apply.careers.microsoft.com calls; robots.txt allows /api/pcsx).
// GET /api/pcsx/search?domain=microsoft.com&query=&location=&start=&sort_by=timestamp. No auth.
// Pages are fixed at 10; a check reads the newest results up to the search cap.
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { field, keyPart, readJson, searchCap, splitShorthand } from "./shared.ts";

export interface MicrosoftConfig {
  query: string;
  /** Place as Microsoft's search takes it ("Dublin"), or "" for everywhere. */
  location: string;
}

interface MicrosoftPosition {
  id?: number | string;
  name?: string;
  locations?: string[];
  postedTs?: number;
  positionUrl?: string;
}

interface MicrosoftResponse {
  status?: number;
  error?: { message?: string };
  data?: { count?: number; positions?: MicrosoftPosition[] } | null;
}

const origin = "https://apply.careers.microsoft.com";
const pageSize = 10;

export const microsoft: SourceAdapter<MicrosoftConfig> = {
  kind: "microsoft",
  category: "api",
  label: "Microsoft",

  parseConfig(raw) {
    const [query, location] = typeof raw === "string" ? splitShorthand(raw, 2) : [field(raw, "query") ?? "", field(raw, "location") ?? ""];
    if (!query) throw new Error(`A Microsoft source needs a search like "security engineer|Dublin", got ${JSON.stringify(raw)}`);
    return { query: query, location: location! };
  },

  key: (c) => [c.query, c.location].filter(Boolean).map(keyPart).join("|"),
  defaultName: (c) => ["Microsoft", c.query, c.location].filter(Boolean).join(" · "),

  async fetchPostings(config, { fetch }) {
    const out = new Map<string, FoundPosting>();
    for (let start = 0; start < searchCap; start += pageSize) {
      const params = new URLSearchParams({ domain: "microsoft.com", query: config.query });
      if (config.location) params.set("location", config.location);
      params.set("start", String(start));
      params.set("sort_by", "timestamp");
      const body = await readJson<MicrosoftResponse>(await fetch(`${origin}/api/pcsx/search?${params}`), "Microsoft");
      if (body.error?.message || !body.data || (body.status && body.status !== 200)) {
        throw new Error(`Microsoft search failed: ${body.error?.message || `status ${body.status}`}`);
      }
      const positions = body.data.positions;
      if (!Array.isArray(positions)) throw new Error("Microsoft returned no position list");
      for (const p of positions) {
        const posting = toPosting(p);
        if (posting) out.set(posting.externalId, posting);
      }
      if (positions.length < pageSize || start + pageSize >= Number(body.data.count ?? 0)) break;
    }
    return [...out.values()];
  },
};

function toPosting(p: MicrosoftPosition): FoundPosting | null {
  if (p.id == null || !p.name) return null;
  const id = String(p.id);
  return {
    externalId: id,
    url: origin + (p.positionUrl ?? `/careers/job/${id}`),
    title: p.name.trim(),
    company: "Microsoft",
    location: p.locations?.length ? p.locations.join("; ") : null,
    salary: null,
    postedAt: typeof p.postedTs === "number" ? new Date(p.postedTs * 1000).toISOString() : null,
    // The search has no description; it comes from the detail page or the user's capture later.
    descriptionHtml: null,
  };
}
