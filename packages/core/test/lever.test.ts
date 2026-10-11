import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch } from "./harness.ts";

const sitegroundGlobal = "https://api.lever.co/v0/postings/siteground?mode=json";
const sitegroundEu = "https://api.eu.lever.co/v0/postings/siteground?mode=json";

describe("Lever source", () => {
  it("lists a Lever company's jobs in the Feed, with locations, links and dates normalised", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [sitegroundGlobal]: "lever.json" }) });
    await engine.addSource({ kind: "lever", config: { site: "siteground", company: "SiteGround" } });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(check.sources).toEqual([{ sourceId: "lever:siteground", name: "SiteGround", ok: true, found: 3, newPostings: 3 }]);
    expect(feed.jobs).toEqual([
      { id: expect.any(String), title: "AI Evaluation Engineer", company: "SiteGround", location: "Sofia, Bulgaria · Hybrid", salary: null, postedAt: "2026-09-21T13:54:06.927Z", postingCount: 1, siteCount: 1, state: "new", url: "https://jobs.lever.co/siteground/40139dc2-abd7-49b4-9c0b-df908a246233", reading: "unread", requirements: [], needsYou: 0, titleTranslation: null, language: null, fit: expect.any(Object), dealbreakers: [], hidden: false, shownByYou: false },
      { id: expect.any(String), title: "Software Engineer, Backend", company: "SiteGround", location: "Bulgaria · Hybrid", salary: null, postedAt: "2026-09-19T09:25:08.754Z", postingCount: 1, siteCount: 1, state: "new", url: "https://jobs.lever.co/siteground/0a220806-406f-4e20-adf1-ee72259179e2", reading: "unread", requirements: [], needsYou: 0, titleTranslation: null, language: null, fit: expect.any(Object), dealbreakers: [], hidden: false, shownByYou: false },
      { id: expect.any(String), title: "Software Engineer, Frontend", company: "SiteGround", location: "Bulgaria · Hybrid", salary: null, postedAt: "2026-09-19T08:45:22.166Z", postingCount: 1, siteCount: 1, state: "new", url: "https://jobs.lever.co/siteground/beedc45b-59c6-409e-8814-9ac1f7fa2a72", reading: "unread", requirements: [], needsYou: 0, titleTranslation: null, language: null, fit: expect.any(Object), dealbreakers: [], hidden: false, shownByYou: false },
    ]);
  });

  it("re-checking keeps the same Postings (identity is Lever's posting id)", async () => {
    const { engine, clock } = createTestEngine({ fetch: fixtureFetch({ [sitegroundGlobal]: "lever.json" }) });
    await engine.addSource({ kind: "lever", config: "siteground" });
    await engine.checkAll();
    await clock.advance(30 * 60_000);

    const again = await engine.checkAll();

    expect(again.sources[0]).toMatchObject({ ok: true, found: 3, newPostings: 0 });
    expect((await engine.queryFeed({ view: "new", sort: "newest" })).counts.new).toBe(3);
  });

  it("checks an EU Lever account on Lever's EU host", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [sitegroundEu]: "lever.json" }) });
    const source = await engine.addSource({ kind: "lever", config: "https://jobs.eu.lever.co/siteground" });

    const check = await engine.checkAll();

    expect(source).toEqual({ id: "lever:eu:siteground", kind: "lever", name: "Siteground" });
    expect(check.sources[0]).toMatchObject({ ok: true, found: 3 });
  });

  it("explains a site that isn't on the host it was added for", async () => {
    const { engine, deps } = createTestEngine();
    deps.fetch = async () => new Response('{"ok":false,"error":"Document not found"}', { status: 404 });
    await engine.addSource({ kind: "lever", config: "siteground" });

    const check = await engine.checkAll();

    expect(check.sources[0]).toMatchObject({ ok: false, outcome: "error", error: expect.stringMatching(/no site "siteground".*jobs\.eu\.lever\.co\/siteground/) });
  });

  it("waits Lever's one-second crawl delay between requests to Lever", async () => {
    const { engine, deps, clock } = createTestEngine();
    const routes = fixtureFetch({ [sitegroundGlobal]: "lever.json", "https://api.lever.co/v0/postings/other?mode=json": "lever.json" });
    const times: number[] = [];
    deps.fetch = async (input, init) => { times.push(clock.now().getTime()); return routes(input, init); };
    await engine.addSource({ kind: "lever", config: "siteground" });
    await engine.addSource({ kind: "lever", config: "other" });

    await engine.checkAll();

    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1000);
  });

  it("rejects a Lever source without a usable site name", async () => {
    const { engine } = createTestEngine();
    await expect(engine.addSource({ kind: "lever", config: "https://evil.example/x?y" })).rejects.toThrow(/Lever site/);
  });
});
