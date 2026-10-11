// Greenhouse job board API: GET boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true.
// No auth, no pagination (the whole board in one response). EU boards use the same API host.
import type { FoundPosting, SourceAdapter } from "./adapter.ts";

export interface GreenhouseConfig {
  board: string;
}

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  company_name?: string;
  location?: { name?: string | null } | null;
  first_published?: string | null;
  content?: string | null;
}

const boardToken = /^[a-z0-9][a-z0-9_-]*$/i;

export const greenhouse: SourceAdapter<GreenhouseConfig> = {
  kind: "greenhouse",

  parseConfig(raw) {
    const board = typeof raw === "string" ? raw : (raw as { board?: unknown } | null)?.board;
    if (typeof board !== "string" || !boardToken.test(board.trim())) {
      throw new Error(`A Greenhouse source needs a board token like "payhawkio", got ${JSON.stringify(raw)}`);
    }
    return { board: board.trim().toLowerCase() };
  },

  key: (c) => c.board,
  defaultName: (c) => c.board,

  async fetchPostings(config, { fetch }) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${config.board}/jobs?content=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Greenhouse answered ${res.status} for board "${config.board}"`);
    const body = (await res.json()) as { jobs?: GreenhouseJob[] };
    if (!Array.isArray(body.jobs)) throw new Error(`Greenhouse board "${config.board}" returned no jobs list`);
    return body.jobs.map(toPosting(config.board));
  },
};

const toPosting = (board: string) => (j: GreenhouseJob): FoundPosting => ({
  externalId: String(j.id),
  url: j.absolute_url,
  title: j.title.trim(),
  company: j.company_name?.trim() || board,
  location: j.location?.name?.trim() || null,
  // The list response has no pay data; salary comes from extraction (or the detail endpoint) later.
  salary: null,
  postedAt: j.first_published ? new Date(j.first_published).toISOString() : null,
  descriptionHtml: j.content ? decodeEntities(j.content) : null,
});

/** Greenhouse `content` is HTML-escaped HTML (`&lt;p&gt;`). */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp|nbsp);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&", nbsp: " " } as Record<string, string>)[k]!;
  });
}
