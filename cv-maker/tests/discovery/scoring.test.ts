import { describe, expect, it } from "vitest";
import { scoreMany } from "@/lib/discovery/scoring";
import { DEFAULT_DISCOVERY_PREFERENCES } from "@/lib/discovery/types";
import type { DiscoveryPreferences, JobPosting } from "@/lib/discovery/types";
import type { CVContent } from "@/lib/types";

const cv: CVContent = {
  slug: "me",
  targetRole: "Security Engineer",
  profile: { name: "K", title: "Cybersecurity Engineer", email: "k@x.dev" },
  experiences: [
    {
      role: "SOC Analyst",
      company: "Acme",
      dates: { start: "2023", end: "present" },
      bullets: ["incident response", "SIEM tuning", "threat hunting"],
      tags: ["security", "siem"],
    },
  ],
  education: [],
  skills: [{ label: "Security", items: ["SIEM", "vulnerability management", "Python"] }],
};

const prefs: DiscoveryPreferences = {
  ...DEFAULT_DISCOVERY_PREFERENCES,
  workAuth: ["UK", "EU"],
  preferredLocations: ["Sofia", "Manchester"],
};

function post(over: Partial<JobPosting>): JobPosting {
  return {
    id: over.id ?? Math.random().toString(36),
    source: { kind: "jobapi", provider: "test" },
    url: "https://x/" + (over.id ?? "1"),
    title: "Role",
    company: "Co",
    fetchedAt: Date.now(),
    ...over,
  };
}

describe("cyber-first weighting", () => {
  it("ranks a security role above a generic SWE role in the same location", () => {
    const [cyber, swe] = scoreMany(
      [
        post({ id: "swe", title: "Frontend Developer", location: "Sofia" }),
        post({ id: "cyber", title: "Security Engineer", location: "Sofia" }),
      ],
      prefs,
      [cv],
    );
    // order of input preserved by scoreMany; assert by id
    const byId = Object.fromEntries([cyber, swe].map((p) => [p.id, p]));
    expect(byId.cyber.score).toBeGreaterThan(byId.swe.score);
  });
});

describe("Sofia-first location tier", () => {
  it("assigns locationRank by preferred order, then remote, then rest", () => {
    const [sofia, manc, remote, other] = scoreMany(
      [
        post({ id: "s", title: "Security Engineer", location: "София" }), // Cyrillic Sofia
        post({ id: "m", title: "Security Engineer", location: "Manchester, UK" }),
        post({ id: "r", title: "Security Engineer", location: "Remote (EU)" }),
        post({ id: "o", title: "Security Engineer", location: "Berlin, Germany" }),
      ],
      prefs,
      [cv],
    );
    expect(sofia.locationRank).toBe(0);
    expect(manc.locationRank).toBe(1);
    expect(remote.locationRank).toBe(2);
    expect(other.locationRank).toBe(3);
  });

  it("a Sofia role sorts ahead of a more-relevant non-Sofia role", () => {
    const scored = scoreMany(
      [
        post({ id: "manc", title: "Senior Security Engineer", location: "Manchester", description: "siem soc threat incident response appsec" }),
        post({ id: "sofia", title: "Junior Security Analyst", location: "Sofia" }),
      ],
      prefs,
      [cv],
    );
    const sorted = [...scored].sort(
      (a, b) => (a.locationRank ?? 9) - (b.locationRank ?? 9) || b.score - a.score,
    );
    expect(sorted[0].id).toBe("sofia");
  });
});
