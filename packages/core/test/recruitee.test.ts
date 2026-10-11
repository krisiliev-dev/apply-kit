import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch, loadFixture } from "./harness.ts";

const accedia = "https://accedia.recruitee.com/api/offers/";

describe("Recruitee source", () => {
  it("lists a Recruitee company's offers in the Feed, with locations, links and dates normalised", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [accedia]: "recruitee.json" }) });
    await engine.addSource({ kind: "recruitee", config: "accedia" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(check.sources).toEqual([{ sourceId: "recruitee:accedia", name: "Accedia", ok: true, found: 3, newPostings: 3 }]);
    // The offers' own `location` says "Remote job"; the structured locations and flags say hybrid in Sofia.
    expect(feed.jobs).toEqual([
      { id: expect.any(String), title: "Junior Front-End Developer", company: "Accedia", location: "Sofia, Bulgaria · Hybrid", salary: null, postedAt: "2026-08-04T07:35:25.000Z", postingCount: 1, siteCount: 1, state: "new", url: "https://accedia.recruitee.com/o/junior-front-end-developer" },
      { id: expect.any(String), title: "Junior Marketing Specialist", company: "Accedia", location: "Sofia, Bulgaria · Hybrid", salary: null, postedAt: "2026-08-03T11:12:27.000Z", postingCount: 1, siteCount: 1, state: "new", url: "https://accedia.recruitee.com/o/junior-marketing-specialist-4" },
      { id: expect.any(String), title: "Junior QA Engineer", company: "Accedia", location: "Sofia, Bulgaria · Hybrid", salary: null, postedAt: "2026-07-24T08:56:07.000Z", postingCount: 1, siteCount: 1, state: "new", url: "https://accedia.recruitee.com/o/junior-qa-engineer-3" },
    ]);
  });

  it("checks a careers site on the company's own domain and states pay when the offer has it", async () => {
    const { engine, deps } = createTestEngine();
    const body = JSON.parse(loadFixture("recruitee.json")) as { offers: { salary: object }[] };
    body.offers[0]!.salary = { min: "3000", max: "4500", period: "month", currency: "EUR" };
    const asked: string[] = [];
    deps.fetch = async (input) => { asked.push(String(input)); return new Response(JSON.stringify(body)); };
    const source = await engine.addSource({ kind: "recruitee", config: "https://careers.example.com/" });

    await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(source.id).toBe("recruitee:careers.example.com");
    expect(asked).toEqual(["https://careers.example.com/api/offers/"]);
    expect(feed.jobs[0]).toMatchObject({ title: "Junior Front-End Developer", salary: "EUR 3,000–4,500 / month" });
  });

  it("re-checking keeps the same Postings (identity is Recruitee's offer id)", async () => {
    const { engine, clock } = createTestEngine({ fetch: fixtureFetch({ [accedia]: "recruitee.json" }) });
    await engine.addSource({ kind: "recruitee", config: { company: "Accedia" } });
    await engine.checkAll();
    await clock.advance(30 * 60_000);

    expect((await engine.checkAll()).sources[0]).toMatchObject({ ok: true, found: 3, newPostings: 0 });
  });

  it("rejects a Recruitee source without a usable company name", async () => {
    const { engine } = createTestEngine();
    await expect(engine.addSource({ kind: "recruitee", config: "not a name!" })).rejects.toThrow(/Recruitee company/);
  });
});
