import { describe, expect, it } from "vitest";
import { locationMatches, normalizeLoc } from "@/lib/discovery/location";
import { scorePosting } from "@/lib/discovery/scoring";
import { DEFAULT_DISCOVERY_PREFERENCES, type JobPosting } from "@/lib/discovery/types";
import type { CVContent } from "@/lib/types";

describe("location normalization", () => {
  it("maps Cyrillic city names to Latin", () => {
    expect(normalizeLoc("София")).toBe("sofia");
    expect(normalizeLoc("Sofia, bg")).toBe("sofia, bg");
    expect(normalizeLoc("11070 Beograd")).toBe("11070 beograd");
  });
  it("matches across scripts", () => {
    expect(locationMatches("София", ["Sofia"])).toBe(true);
    expect(locationMatches("София Hybrid", ["Sofia", "Manchester"])).toBe(true);
    expect(locationMatches("Berlin", ["Sofia"])).toBe(false);
  });
});

const cv: CVContent = {
  slug: "me",
  targetRole: "Security Engineer",
  profile: { name: "K", title: "Security Engineer", email: "k@e.com" },
  experiences: [],
  education: [],
};

function posting(location: string): JobPosting {
  return {
    id: "p" + location,
    source: { kind: "careerpage", url: "https://x", site: "dev.bg" },
    url: "https://x/1",
    title: "Security Engineer",
    company: "Co",
    location,
    fetchedAt: Date.now(),
  };
}

const prefs = {
  ...DEFAULT_DISCOVERY_PREFERENCES,
  workAuth: ["UK", "EU"],
  preferredLocations: ["Sofia", "Manchester"],
};

describe("scoring location filter (workAuth UK/EU)", () => {
  it("keeps Sofia roles (Bulgaria is in the EU) and boosts preferred location", () => {
    const r = scorePosting({ posting: posting("София"), prefs, cvs: [cv] });
    expect(r.hardReject).not.toBe(true);
    // Sofia is the first preferred location → top location tier (rank 0).
    expect(r.locationRank).toBe(0);
    expect(r.why.some((w) => /top location|location you prefer/i.test(w))).toBe(true);
  });

  it("keeps remote and Manchester (UK)", () => {
    expect(scorePosting({ posting: posting("Remote"), prefs, cvs: [cv] }).hardReject).not.toBe(true);
    expect(scorePosting({ posting: posting("Manchester, UK"), prefs, cvs: [cv] }).hardReject).not.toBe(true);
  });

  it("rejects Belgrade (Serbia is not UK/EU)", () => {
    const r = scorePosting({ posting: posting("11070 Beograd"), prefs, cvs: [cv] });
    expect(r.hardReject).toBe(true);
  });
});
