// Jobs Kris adds himself. Each way in is one Source ("capture:link" for pasted links); its Postings
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
