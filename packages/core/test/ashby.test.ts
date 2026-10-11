import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch, loadFixture } from "./harness.ts";

const dextBoard = "https://api.ashbyhq.com/posting-api/job-board/Dext-Careers?includeCompensation=true";

describe("Ashby source", () => {
  it("lists an Ashby board's jobs in the Feed, with locations, pay, links and dates normalised", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [dextBoard]: "ashby.json" }) });
    await engine.addSource({ kind: "ashby", config: { board: "Dext-Careers", company: "Dext" } });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(check.sources).toEqual([{ sourceId: "ashby:Dext-Careers", name: "Dext", ok: true, found: 3, newPostings: 3 }]);
    expect(feed.jobs).toEqual([
      { id: expect.any(String), title: "Account Executive - B2B Saas", company: "Dext", location: "Dext UK · Hybrid", salary: null, postedAt: "2026-09-29T15:42:32.378Z", postingCount: 1, siteCount: 1, state: "new", url: "https://jobs.ashbyhq.com/Dext-Careers/e75937ef-d2cf-407b-9ce6-8ec1d764e40b" },
      { id: expect.any(String), title: "Software Developer", company: "Dext", location: "Dext Bulgaria · Remote", salary: null, postedAt: "2026-09-22T07:30:48.059Z", postingCount: 1, siteCount: 1, state: "new", url: "https://jobs.ashbyhq.com/Dext-Careers/db5174a5-8675-48fb-8544-323e5d6debc9" },
      { id: expect.any(String), title: "Chargé(e) d'Acquisition Marketing & Partenariats | B2B Saas", company: "Dext", location: "Dext France · Hybrid", salary: "€40K – €45K • €6K Bonus", postedAt: "2026-09-10T13:12:21.919Z", postingCount: 1, siteCount: 1, state: "new", url: "https://jobs.ashbyhq.com/Dext-Careers/8c997fa2-d2c0-4f86-873c-b2c578bb8c66" },
    ]);
  });

  it("re-checking keeps the same Postings (identity is Ashby's job id)", async () => {
    const { engine, clock } = createTestEngine({ fetch: fixtureFetch({ [dextBoard]: "ashby.json" }) });
    await engine.addSource({ kind: "ashby", config: "https://jobs.ashbyhq.com/Dext-Careers" });
    await engine.checkAll();
    await clock.advance(30 * 60_000);

    expect((await engine.checkAll()).sources[0]).toMatchObject({ ok: true, found: 3, newPostings: 0 });
  });

  it("leaves out unlisted jobs and asks again without pay data if the board refuses it", async () => {
    const { engine, deps } = createTestEngine();
    const body = JSON.parse(loadFixture("ashby.json")) as { jobs: { isListed: boolean }[] };
    body.jobs[0]!.isListed = false;
    const asked: string[] = [];
    deps.fetch = async (input) => {
      const url = String(input);
      asked.push(url);
      return url.endsWith("includeCompensation=true")
        ? new Response("Bad Request", { status: 400 })
        : new Response(JSON.stringify(body), { status: 200 });
    };
    await engine.addSource({ kind: "ashby", config: "Dext-Careers" });

    const check = await engine.checkAll();

    expect(asked).toEqual([dextBoard, "https://api.ashbyhq.com/posting-api/job-board/Dext-Careers?includeCompensation=false"]);
    expect(check.sources[0]).toMatchObject({ ok: true, found: 2, name: "Dext Careers" });
  });

  it("rejects an Ashby source without a usable board name", async () => {
    const { engine } = createTestEngine();
    await expect(engine.addSource({ kind: "ashby", config: "https://evil.example/x?y" })).rejects.toThrow(/Ashby board/);
  });
});
