import { describe, expect, it } from "vitest";
import { createTestEngine } from "./harness.ts";

describe("Source types on the Sources screen", () => {
  it("names each ATS type as people write it and groups it as an ATS feed", async () => {
    const { engine } = createTestEngine();
    for (const [kind, config] of [
      ["greenhouse", "payhawkio"], ["lever", "https://jobs.eu.lever.co/siteground"], ["ashby", "Dext-Careers"],
      ["recruitee", "accedia"], ["personio", "personio"], ["teamtailor", "superhosting"], ["smartrecruiters", "Gameloft:bg"],
    ] as const) await engine.addSource({ kind, config });

    const { sources } = await engine.sourceHealth();

    // Added in the same instant, so listed by id.
    expect(sources.map((s) => [s.typeLabel, s.id, s.name, s.category, s.status])).toEqual([
      ["Ashby", "ashby:Dext-Careers", "Dext Careers", "ats", "not-checked"],
      ["Greenhouse", "greenhouse:payhawkio", "payhawkio", "ats", "not-checked"],
      ["Lever", "lever:eu:siteground", "Siteground", "ats", "not-checked"],
      ["Personio", "personio:personio", "Personio", "ats", "not-checked"],
      ["Recruitee", "recruitee:accedia", "Accedia", "ats", "not-checked"],
      ["SmartRecruiters", "smartrecruiters:Gameloft:bg", "Gameloft (Bulgaria)", "ats", "not-checked"],
      ["Teamtailor", "teamtailor:superhosting", "Superhosting", "ats", "not-checked"],
    ]);
  });
});
