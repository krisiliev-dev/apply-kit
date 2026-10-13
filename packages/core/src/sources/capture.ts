// Jobs Kris adds by hand. Each way in is one Source ("capture:link" for pasted links, "captured:<site>"
// for pages captured with the Chrome extension); its Postings
// are keyed by the job's link, so pasting the same link twice is one Posting. These Sources are never
// checked: nothing is fetched on a schedule, and their Postings never close because a Check missed them.
import type { SourceAdapter } from "./adapter.ts";

export interface CaptureConfig {
  via: "link";
}

const names: Record<CaptureConfig["via"], string> = { link: "Pasted links" };

export const capture: SourceAdapter<CaptureConfig> = {
  kind: "capture",
  category: "capture",
  label: "Pasted link",

  parseConfig(raw) {
    const via = typeof raw === "string" ? raw : (raw as { via?: unknown } | null)?.via;
    if (via !== "link") throw new Error(`A capture source needs "link", got ${JSON.stringify(raw)}`);
    return { via };
  },

  key: (c) => c.via,
  defaultName: (c) => names[c.via],

  fetchPostings() {
    return Promise.reject(new Error("Jobs you add yourself aren't checked"));
  },
};

export interface CapturedConfig {
  /** The site the pages were captured on, "www." dropped ("linkedin.com", "jobs.bg"). */
  site: string;
  /** The site's name as Kris knows it ("LinkedIn"). */
  name?: string;
}

/**
 * Pages Kris captures with the Chrome extension: one Source per site ("Captured · LinkedIn"), so the
 * same job captured on two sites merges like any two Sources. Never checked, like pasted links.
 */
export const captured: SourceAdapter<CapturedConfig> = {
  kind: "captured",
  category: "capture",
  label: "Captured in Chrome",

  parseConfig(raw) {
    const o = (typeof raw === "string" ? { site: raw } : raw) as { site?: unknown; name?: unknown } | null;
    const site = typeof o?.site === "string" ? o.site.trim().toLowerCase().replace(/^www\./, "") : "";
    if (!site) throw new Error(`A captured source needs the site it was captured on, got ${JSON.stringify(raw)}`);
    return typeof o?.name === "string" && o.name.trim() ? { site, name: o.name.trim() } : { site };
  },

  key: (c) => c.site,
  defaultName: (c) => `Captured · ${c.name ?? c.site}`,

  fetchPostings() {
    return Promise.reject(new Error("Jobs you capture aren't checked"));
  },
};
