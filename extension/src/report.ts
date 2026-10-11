// What the capture panel says about a capture, in words (never by colour alone).
import type { CaptureItem, CaptureReport } from "@apply-kit/core";

const missingWords: Record<string, string> = { company: "company", location: "location", description: "job description" };

export function itemStatus(item: CaptureItem): string {
  switch (item.status) {
    case "new":
      return item.missing.length ? `New · no ${joinOr(item.missing.map((m) => missingWords[m] ?? m))} on the page` : "New";
    case "in-feed":
      return item.merged ? "Already in Feed · from another site" : "Already in Feed";
    case "hidden":
      return `Hidden: ${item.hiddenBecause.join("; ") || "a dealbreaker"}`;
    case "unreadable":
      return `Couldn't read: ${item.problem ?? "not enough on the page"}`;
  }
}

export function previewHeading(r: CaptureReport): string {
  if (r.kind === "job") return "This job page";
  if (r.kind === "none") return "No job found on this page";
  const n = r.listings.length;
  return `${n} ${n === 1 ? "listing" : "listings"} visible on this page`;
}

/** One line of counts: before adding ("preview") or after ("done"). */
export function resultSummary(r: CaptureReport, when: "preview" | "done"): string {
  const c = r.counts;
  const parts = when === "preview"
    ? [[c.new, "new"], [c.inFeed, "already in Feed"], [c.hidden, "hidden"], [c.unreadable, "couldn't read"]]
    : [[c.new, "added"], [c.inFeed, "already in your Feed"], [c.hidden, "hidden by a dealbreaker"], [c.unreadable, "couldn't read"]];
  const out = parts.filter(([n]) => Number(n) > 0).map(([n, words]) => `${n} ${words}`);
  if (r.notLoaded > 0) out.push(`${r.notLoaded} more further down, not loaded yet`);
  return out.join(" · ");
}

/** The button that adds the previewed listings. Listings already in the Feed are recorded too. */
export function actionLabel(r: CaptureReport): string {
  return r.counts.new > 0 ? `Add ${r.counts.new} to Feed` : "Update the Feed";
}

/** A results page gets "Capture search results"; anything else "Capture this page". */
export function captureButtonLabel(url: string | undefined): string {
  let u: URL;
  try {
    u = new URL(url ?? "");
  } catch {
    return "Capture this page";
  }
  const host = u.hostname.replace(/^www\./, "");
  const search = (host.endsWith("linkedin.com") && /^\/jobs\/(search|collections)/.test(u.pathname))
    || (host === "jobs.bg" && /front_job_search|^\/jobs\b/.test(u.pathname));
  return search ? "Capture search results" : "Capture this page";
}

function joinOr(words: string[]): string {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}
