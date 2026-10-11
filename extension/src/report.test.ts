import { describe, expect, it } from "vitest";
import type { CaptureItem, CaptureReport } from "@apply-kit/core";
import { actionLabel, captureButtonLabel, itemStatus, previewHeading, resultSummary } from "./report.ts";

const item = (over: Partial<CaptureItem>): CaptureItem => ({
  title: "Security Engineer", company: "Kestrel Payments", location: "Sofia", salary: null, url: "https://www.linkedin.com/jobs/view/1/",
  status: "new", jobId: null, state: null, merged: false, missing: [], hiddenBecause: [], problem: null, ...over,
});

const report = (listings: CaptureItem[], over: Partial<CaptureReport> = {}): CaptureReport => {
  const counts = { new: 0, inFeed: 0, hidden: 0, unreadable: 0 };
  for (const l of listings) counts[l.status === "in-feed" ? "inFeed" : l.status]++;
  return { kind: "search", site: "LinkedIn", source: "Captured · LinkedIn", listings, counts, notLoaded: 0, message: null, ...over };
};

describe("what the capture panel says", () => {
  it("names each listing's status in words, with the reason for hidden and unreadable ones", () => {
    expect(itemStatus(item({}))).toBe("New");
    expect(itemStatus(item({ missing: ["company", "location"] }))).toBe("New · no company or location on the page");
    expect(itemStatus(item({ status: "in-feed" }))).toBe("Already in Feed");
    expect(itemStatus(item({ status: "in-feed", merged: true }))).toBe("Already in Feed · from another site");
    expect(itemStatus(item({ status: "hidden", hiddenBecause: ["Asks for 6+ years (your limit: 4)"] }))).toBe("Hidden: Asks for 6+ years (your limit: 4)");
    expect(itemStatus(item({ status: "unreadable", problem: "No job title on this card" }))).toBe("Couldn't read: No job title on this card");
  });

  it("heads a preview with how many listings the page shows, and what wasn't loaded", () => {
    const r = report([item({}), item({ status: "in-feed" }), item({ status: "hidden", hiddenBecause: ["x"] }), item({ status: "unreadable", problem: "No job title on this card" })], { notLoaded: 4 });
    expect(previewHeading(r)).toBe("4 listings visible on this page");
    expect(resultSummary(r, "preview")).toBe("1 new · 1 already in Feed · 1 hidden · 1 couldn't read · 4 more further down, not loaded yet");
    expect(actionLabel(r)).toBe("Add 1 to Feed");
    expect(previewHeading(report([item({})], { kind: "job" }))).toBe("This job page");
  });

  it("sums up what a capture did", () => {
    const r = report([item({}), item({}), item({ status: "in-feed", merged: true }), item({ status: "hidden", hiddenBecause: ["x"] })]);
    expect(resultSummary(r, "done")).toBe("2 added · 1 already in your Feed · 1 hidden by a dealbreaker");
    expect(actionLabel(report([item({ status: "in-feed" })]))).toBe("Update the Feed");
  });

  it("offers search-results capture on a results page and page capture elsewhere", () => {
    expect(captureButtonLabel("https://www.linkedin.com/jobs/search/?keywords=security")).toBe("Capture search results");
    expect(captureButtonLabel("https://www.jobs.bg/front_job_search.php?keywords%5B%5D=security")).toBe("Capture search results");
    expect(captureButtonLabel("https://www.linkedin.com/jobs/view/4100000009/")).toBe("Capture this page");
    expect(captureButtonLabel("https://careers.orbitly.example/jobs/4417")).toBe("Capture this page");
  });
});
