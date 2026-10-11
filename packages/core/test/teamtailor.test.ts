import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch, loadFixture } from "./harness.ts";

const superhosting = "https://superhosting.teamtailor.com/jobs.rss?per_page=200";

describe("Teamtailor source", () => {
  it("lists a Teamtailor company's jobs from its RSS feed, with locations, links and dates normalised", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [superhosting]: "teamtailor.xml" }) });
    await engine.addSource({ kind: "teamtailor", config: "superhosting" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(check.sources).toEqual([{ sourceId: "teamtailor:superhosting", name: "Superhosting", ok: true, found: 1, newPostings: 1 }]);
    expect(feed.jobs).toEqual([
      { id: expect.any(String), title: "Technical Support Specialist", company: "SuperHosting", location: "Sofia, Bulgaria", salary: null, postedAt: "2026-08-07T14:58:39.000Z", postingCount: 1, siteCount: 1, state: "new", url: "https://superhosting.teamtailor.com/jobs/8191492-technical-support-specialist", reading: "unread", requirements: [], needsYou: 0, titleTranslation: null, language: null, fit: expect.any(Object) },
    ]);
  });

  it("pages through a feed longer than one page and says how remote jobs are worked", async () => {
    const { engine, deps } = createTestEngine();
    const xml = loadFixture("teamtailor.xml");
    const item = /<item>[\s\S]*<\/item>/.exec(xml)![0];
    const feedOf = (n: number, from: number) => xml.replace(item, Array.from({ length: n }, (_, i) =>
      item.replace(/<guid>[^<]+<\/guid>/, `<guid>job-${from + i}</guid>`).replace("<remoteStatus>none", "<remoteStatus>fully")).join("\n"));
    const asked: string[] = [];
    deps.fetch = async (input) => {
      const url = String(input);
      asked.push(url);
      return new Response(url.endsWith("offset=100") ? feedOf(1, 100) : feedOf(100, 0));
    };
    await engine.addSource({ kind: "teamtailor", config: "https://careers.example.com/jobs" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(asked).toEqual(["https://careers.example.com/jobs.rss?per_page=200", "https://careers.example.com/jobs.rss?per_page=200&offset=100"]);
    expect(check.sources[0]).toMatchObject({ sourceId: "teamtailor:careers.example.com", ok: true, found: 101 });
    expect(feed.jobs[0]!.location).toBe("Sofia, Bulgaria · Remote");
  });

  it("re-checking keeps the same Postings (identity is the item's guid)", async () => {
    const { engine, clock } = createTestEngine({ fetch: fixtureFetch({ [superhosting]: "teamtailor.xml" }) });
    await engine.addSource({ kind: "teamtailor", config: { company: "superhosting" } });
    await engine.checkAll();
    await clock.advance(30 * 60_000);

    expect((await engine.checkAll()).sources[0]).toMatchObject({ ok: true, found: 1, newPostings: 0 });
  });

  it("reports a feed that isn't RSS as a failed check", async () => {
    const { engine, deps } = createTestEngine();
    deps.fetch = async () => new Response("<html><body>Not found</body></html>");
    await engine.addSource({ kind: "teamtailor", config: "superhosting" });

    expect((await engine.checkAll()).sources[0]).toMatchObject({ ok: false, outcome: "error", error: expect.stringMatching(/not an RSS feed/) });
  });
});
