import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch, loadFixture } from "./harness.ts";

const postings = "https://api.smartrecruiters.com/v1/companies/Gameloft/postings";
const gameloftBg = `${postings}?country=bg&limit=100&offset=0`;

describe("SmartRecruiters source", () => {
  it("lists a company's postings in one country in the Feed, with locations, links and dates normalised", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [gameloftBg]: "smartrecruiters.json" }) });
    await engine.addSource({ kind: "smartrecruiters", config: "Gameloft:bg" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(check.sources).toEqual([{ sourceId: "smartrecruiters:Gameloft:bg", name: "Gameloft (Bulgaria)", ok: true, found: 2, newPostings: 2 }]);
    expect(feed.jobs).toEqual([
      { id: expect.any(String), title: "Video Artist", company: "Gameloft", location: "Sofia, Sofia City Province, Bulgaria · Hybrid", salary: null, postedAt: "2026-09-22T08:57:54.882Z", postingCount: 1, siteCount: 1, state: "new", url: "https://jobs.smartrecruiters.com/Gameloft/744000150972019" },
      { id: expect.any(String), title: "Game Producer", company: "Gameloft", location: "Sofia, Sofia City Province, Bulgaria", salary: null, postedAt: "2026-09-21T11:58:46.876Z", postingCount: 1, siteCount: 1, state: "new", url: "https://jobs.smartrecruiters.com/Gameloft/744000150674086" },
    ]);
  });

  it("pages through every posting the company lists", async () => {
    const { engine, deps } = createTestEngine();
    const first = JSON.parse(loadFixture("smartrecruiters.json")) as { totalFound: number; content: { id: string; name: string }[] };
    first.totalFound = 3;
    const second = { offset: 2, limit: 100, totalFound: 3, content: [{ ...first.content[0]!, id: "744000150000001", name: "Level Designer" }] };
    const asked: string[] = [];
    deps.fetch = async (input) => {
      const url = String(input);
      asked.push(url);
      return new Response(JSON.stringify(url.endsWith("offset=0") ? first : second));
    };
    await engine.addSource({ kind: "smartrecruiters", config: { company: "Gameloft", country: "BG" } });

    const check = await engine.checkAll();

    expect(asked).toEqual([gameloftBg, `${postings}?country=bg&limit=100&offset=2`]);
    expect(check.sources[0]).toMatchObject({ ok: true, found: 3 });
  });

  it("keeps a company's Sources for different countries apart, and re-checks without duplicates", async () => {
    const { engine, clock } = createTestEngine({
      fetch: fixtureFetch({ [gameloftBg]: "smartrecruiters.json", [`${postings}?limit=100&offset=0`]: "smartrecruiters.json" }),
    });
    await engine.addSource({ kind: "smartrecruiters", config: "Gameloft:bg" });
    const everywhere = await engine.addSource({ kind: "smartrecruiters", config: "https://jobs.smartrecruiters.com/Gameloft" });
    await engine.checkAll();
    await clock.advance(30 * 60_000);

    const again = await engine.checkAll();

    expect(everywhere).toEqual({ id: "smartrecruiters:Gameloft", kind: "smartrecruiters", name: "Gameloft" });
    expect(again.sources.map((s) => s.ok && s.newPostings)).toEqual([0, 0]);
  });

  it("rejects a SmartRecruiters source without a usable company id", async () => {
    const { engine } = createTestEngine();
    await expect(engine.addSource({ kind: "smartrecruiters", config: "Game loft" })).rejects.toThrow(/SmartRecruiters company/);
    await expect(engine.addSource({ kind: "smartrecruiters", config: "Gameloft:bulgaria" })).rejects.toThrow(/country/);
  });
});
