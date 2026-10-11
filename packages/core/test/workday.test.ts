import { describe, expect, it } from "vitest";
import { createTestEngine } from "./harness.ts";
import { routedFetch, type SeenRequest } from "./http.ts";

const careers = "https://dxctechnology.wd1.myworkdayjobs.com/en-US/DXCJobs";
const search = "https://dxctechnology.wd1.myworkdayjobs.com/wday/cxs/dxctechnology/DXCJobs/jobs";
const bulgaria = "25f4875dc598484dbeee857eb2d81652";

interface SearchBody { appliedFacets: Record<string, string[]>; limit: number; offset: number; searchText: string }
const body = (r: SeenRequest) => r.json as SearchBody;

/** A Workday tenant listing `total` postings, answering any page the way the CXS search does. */
function tenantWith(total: number, opts: { stopAt?: number } = {}) {
  return routedFetch((r) => {
    if (r.url !== search || r.method !== "POST") return undefined;
    const { offset, limit } = body(r);
    if (limit > 20) return new Response('{"errorCode":"HTTP_400"}', { status: 400 });
    const end = Math.min(total, offset + limit, opts.stopAt ?? Infinity);
    const jobPostings = [];
    for (let i = offset; i < end; i++) {
      jobPostings.push({ title: `Role ${i}`, externalPath: `/job/BGR---SOFIA/Role-${i}_R${1000 + i}`, locationsText: "BGR - SOFIA", postedOn: "Posted Today", bulletFields: [`R${1000 + i}`] });
    }
    // Like the real API, `total` is only reliable on the first page.
    return { json: { total: offset === 0 ? total : 0, jobPostings, facets: [] } };
  });
}

describe("Workday source", () => {
  it("lists a Workday company's jobs, filtered to a country by its location facet", async () => {
    const http = routedFetch((r) => {
      if (r.url !== search || r.method !== "POST") return undefined;
      const facets = body(r).appliedFacets;
      // The first request reads the facets; the next one must ask for Bulgaria by its facet id.
      if (Object.keys(facets).length === 0) return { fixture: "workday-dxc-bulgaria.json" };
      if (facets.locationCountry?.[0] === bulgaria) return { fixture: "workday-dxc-bulgaria.json" };
      return new Response("unexpected facets", { status: 400 });
    });
    const { engine } = createTestEngine({ fetch: http.fetch });
    const source = await engine.addSource({ kind: "workday", config: { url: careers, country: "Bulgaria", company: "DXC" } });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(source.id).toBe("workday:dxctechnology.wd1/dxcjobs/bulgaria");
    expect(check.sources).toEqual([{ sourceId: source.id, name: "DXC", ok: true, found: 3, newPostings: 3 }]);
    expect(http.requests.at(-1)!.json).toMatchObject({ appliedFacets: { locationCountry: [bulgaria] }, limit: 20, offset: 0 });
    expect(feed.jobs.map((j) => [j.title, j.company, j.location, j.url])).toEqual(expect.arrayContaining([
      ["People Operations Specialist with French", "DXC", "BGR - SOFIA", "https://dxctechnology.wd1.myworkdayjobs.com/en-US/DXCJobs/job/BGR---SOFIA/People-Operations-Specialist-with-French_51562726"],
    ]));
    expect(feed.jobs).toHaveLength(3);
    // "Posted 11 Days Ago" is relative, so the posted date stays unknown rather than guessed.
    expect(feed.jobs.every((j) => j.postedAt === null)).toBe(true);
    expect((await engine.sourceHealth()).sources[0]).toMatchObject({ label: "Workday", category: "ats", history: [{ outcome: "ok", inLocations: 3, total: 3 }] });
  });

  it("pages through a tenant 20 postings at a time until it has every one", async () => {
    const http = tenantWith(45);
    const { engine } = createTestEngine({ fetch: http.fetch });
    await engine.addSource({ kind: "workday", config: careers });

    const check = await engine.checkAll();

    expect(check.sources[0]).toMatchObject({ ok: true, found: 45, newPostings: 45 });
    expect(http.requests.map((r) => [body(r).offset, body(r).limit])).toEqual([[0, 20], [20, 20], [40, 20]]);
  });

  it("keeps the same identity for a posting on any page, from its requisition id", async () => {
    const { engine, deps } = createTestEngine({ fetch: tenantWith(25).fetch });
    await engine.addSource({ kind: "workday", config: careers });
    await engine.checkAll();
    deps.fetch = tenantWith(26).fetch; // one new posting shifts nothing else
    const again = await engine.checkAll();

    expect(again.sources[0]).toMatchObject({ ok: true, found: 26, newPostings: 1 });
  });

  it("fails the check instead of reporting a partial list when pages stop early", async () => {
    const { engine, deps } = createTestEngine({ fetch: tenantWith(25).fetch });
    await engine.addSource({ kind: "workday", config: careers });
    await engine.checkAll();
    deps.fetch = tenantWith(45, { stopAt: 30 }).fetch;

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(check.sources[0]).toMatchObject({ ok: false, outcome: "error", error: "Workday stopped after 30 of 45 jobs, so this check is incomplete" });
    expect(feed.counts.new).toBe(25);
  });

  it("asks for a country rather than paging through a huge tenant", async () => {
    const { engine } = createTestEngine({ fetch: tenantWith(5000).fetch });
    await engine.addSource({ kind: "workday", config: careers });

    const check = await engine.checkAll();

    expect(check.sources[0]).toMatchObject({ ok: false, error: expect.stringMatching(/lists 5000 jobs.*add a country/) });
  });

  describe("a tenant without a country filter (HPE, Mastercard)", () => {
    const hpeSearch = "https://hpe.wd5.myworkdayjobs.com/wday/cxs/hpe/Jobsathpe/jobs";
    // The three "…, Bulgaria" values of HPE's locations facet on 2026-10-11 (recorded).
    const hpeBulgaria = ["e69f9781661b1021919e5d08a61cb2a1", "2e0d9cc9554b012c8fc1f6e7442cc059", "acac3e510b1701a9848fb5cfdd2b6b61"];

    it("applies the country through every location in it, read from the locations facet", async () => {
      const http = routedFetch((r) => {
        if (r.url !== hpeSearch || r.method !== "POST") return undefined;
        const facets = body(r).appliedFacets;
        if (Object.keys(facets).length === 0) return { fixture: "workday-hpe-first-page.json" };
        if ([...(facets.locations ?? [])].sort().join() === [...hpeBulgaria].sort().join()) return { fixture: "workday-hpe-bulgaria.json" };
        return new Response("unexpected facets", { status: 400 });
      });
      const { engine } = createTestEngine({ fetch: http.fetch });
      await engine.addSource({ kind: "workday", config: { url: "https://hpe.wd5.myworkdayjobs.com/Jobsathpe", country: "Bulgaria", company: "HPE" } });

      const check = await engine.checkAll();

      expect(check.sources[0]).toMatchObject({ ok: true, found: 17 });
      const feed = await engine.queryFeed({ view: "new" });
      expect(feed.jobs.map((j) => j.title)).toContain("Junior Security Analyst");
      expect(feed.jobs.every((j) => j.company === "HPE")).toBe(true);
    });

    it("finds nothing (rather than failing) when the tenant has no location in that country", async () => {
      const http = routedFetch((r) => (r.url === hpeSearch ? { fixture: "workday-hpe-first-page.json" } : undefined));
      const { engine } = createTestEngine({ fetch: http.fetch });
      await engine.addSource({ kind: "workday", config: { url: "https://hpe.wd5.myworkdayjobs.com/Jobsathpe", country: "Iceland" } });

      const check = await engine.checkAll();

      expect(check.sources[0]).toMatchObject({ ok: true, found: 0 });
      expect(http.requests).toHaveLength(1);
    });
  });

  it("rejects a Workday source that isn't a myworkdayjobs.com careers link", async () => {
    const { engine } = createTestEngine();
    await expect(engine.addSource({ kind: "workday", config: "https://evil.example/DXCJobs" })).rejects.toThrow(/myworkdayjobs\.com/);
  });
});
