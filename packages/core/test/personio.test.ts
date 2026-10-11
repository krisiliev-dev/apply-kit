import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch } from "./harness.ts";

const personioFeed = "https://personio.jobs.personio.de/xml";

describe("Personio source", () => {
  it("lists a Personio company's positions from its XML feed, with locations, links and dates normalised", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [personioFeed]: "personio.xml" }) });
    await engine.addSource({ kind: "personio", config: "personio" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(check.sources).toEqual([{ sourceId: "personio:personio", name: "Personio", ok: true, found: 1, newPostings: 1 }]);
    expect(feed.jobs).toEqual([
      { id: expect.any(String), title: "Staff Software Engineer, Data Platform", company: "Personio SE & Co. KG", location: "Munich; Berlin", salary: null, postedAt: "2024-11-13T14:10:41.000Z", postingCount: 1, state: "new", url: "https://personio.jobs.personio.de/job/1834171", reading: "unread", requirements: [], needsYou: 0 },
    ]);
  });

  it("checks an account on Personio's .com host", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ "https://acme.jobs.personio.com/xml": "personio.xml" }) });
    const source = await engine.addSource({ kind: "personio", config: "https://acme.jobs.personio.com/job/1" });

    await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(source).toEqual({ id: "personio:acme.jobs.personio.com", kind: "personio", name: "Acme" });
    expect(feed.jobs[0]!.url).toBe("https://acme.jobs.personio.com/job/1834171");
  });

  it("re-checking keeps the same Postings (identity is Personio's position id)", async () => {
    const { engine, clock } = createTestEngine({ fetch: fixtureFetch({ [personioFeed]: "personio.xml" }) });
    await engine.addSource({ kind: "personio", config: { account: "personio" } });
    await engine.checkAll();
    await clock.advance(30 * 60_000);

    expect((await engine.checkAll()).sources[0]).toMatchObject({ ok: true, found: 1, newPostings: 0 });
  });

  it("reads an empty feed as no open positions, and anything else as a failed check", async () => {
    const { engine, deps } = createTestEngine();
    deps.fetch = async () => new Response('<?xml version="1.0" encoding="UTF-8"?>\n<workzag-jobs>\n</workzag-jobs>');
    await engine.addSource({ kind: "personio", config: "personio" });
    expect((await engine.checkAll()).sources[0]).toMatchObject({ ok: true, found: 0 });

    deps.fetch = async () => new Response("<html><body>Maintenance</body></html>");
    expect((await engine.checkAll()).sources[0]).toMatchObject({ ok: false, error: expect.stringMatching(/not a Personio jobs feed/) });
  });
});
