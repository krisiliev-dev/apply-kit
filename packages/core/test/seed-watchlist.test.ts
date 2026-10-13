// Seeding the Sofia starter watchlist: every company with a verified feed becomes a Source in one
// step; the ones without a feed are listed with the email-alert route that still catches their jobs.
import { describe, expect, it } from "vitest";
import { createTestEngine, loadFixture } from "./harness.ts";
import { routedFetch } from "./http.ts";

describe("seeding the Sofia watchlist", () => {
  it("adds every company with a verified feed as a Source, ready to check, in one step", async () => {
    const { engine } = createTestEngine();

    const seed = await engine.seedWatchlist();

    // docs/design/watchlist-draft.md: 46 companies verified with a public feed on 2026-10-11.
    expect(seed.added).toHaveLength(46);
    const health = await engine.sourceHealth();
    expect(health.sources).toHaveLength(46);
    expect(health.sources.every((s) => s.status === "not-checked")).toBe(true);
    const byId = Object.fromEntries(health.sources.map((s) => [s.id, s]));
    expect(byId["greenhouse:payhawkio"]).toMatchObject({ name: "Payhawk", label: "Greenhouse" });
    expect(byId["smartrecruiters:Ubisoft2:bg"]).toMatchObject({ name: "Ubisoft Sofia" });
    expect(byId["workday:hpe.wd5/jobsathpe/bulgaria"]).toMatchObject({ name: "Hewlett Packard Enterprise" });
    expect(byId["recruitee:careers.dronamics.com"]).toMatchObject({ name: "Dronamics" });
    expect(byId["lever:ampeco-global"]).toMatchObject({ name: "AMPECO", label: "Lever" });
    expect(byId["ashby:kraken.com"]).toMatchObject({ name: "Kraken" });
    expect(byId["teamtailor:mypos"]).toMatchObject({ name: "myPOS" });
  });

  it("lists the companies without a feed with their email-alert route, adding nothing for them", async () => {
    const { engine } = createTestEngine();

    const seed = await engine.seedWatchlist();

    // The other 29 of the draft's 75 companies have no feed apply-kit may read.
    expect(seed.withoutFeed).toHaveLength(29);
    expect(seed.withoutFeed.find((c) => c.company === "SAP Labs Bulgaria")).toMatchObject({
      group: "international",
      careers: "https://jobs.sap.com/go/Bulgaria/8806301",
      why: expect.stringMatching(/bot protection/),
      route: { via: "linkedin", sourceId: "email:linkedin", sourceName: "LinkedIn job alerts", connected: false, how: expect.stringMatching(/LinkedIn/) },
    });
    // Local employers post on jobs.bg first.
    expect(seed.withoutFeed.find((c) => c.company === "DSK Bank")).toMatchObject({
      group: "local", route: { via: "jobsbg", sourceId: "email:jobsbg", sourceName: "jobs.bg alerts" },
    });
    const ids = (await engine.sourceHealth()).sources.map((s) => s.id);
    expect(ids.some((id) => id.startsWith("email:"))).toBe(false);
  });

  it("shows a route as connected once its email-alert Source is on the watchlist", async () => {
    const { engine } = createTestEngine();
    await engine.addSource({ kind: "email", config: "linkedin" });

    const preview = await engine.starterWatchlist();

    expect(preview.withoutFeed.find((c) => c.company === "Uber")!.route.connected).toBe(true);
    expect(preview.withoutFeed.find((c) => c.company === "Vivacom")!.route.connected).toBe(false);
  });

  it("previews what seeding would add without adding anything", async () => {
    const { engine } = createTestEngine();

    const preview = await engine.starterWatchlist();

    expect(preview.added).toEqual([]);
    expect(preview.sources).toHaveLength(46);
    expect(preview.sources.every((s) => s.status === "to-add")).toBe(true);
    expect((await engine.sourceHealth()).sources).toEqual([]);
  });

  it("can be repeated: Sources already there stay as they are, and ones Kris paused or removed stay that way", async () => {
    const { engine } = createTestEngine();
    await engine.addSource({ kind: "greenhouse", config: "tide", name: "Tide (mine)" });
    await engine.seedWatchlist();
    await engine.pauseSource("greenhouse:sumup");
    await engine.removeSource("greenhouse:payhawkio");

    const again = await engine.seedWatchlist();

    expect(again.added).toEqual([]);
    const status = Object.fromEntries(again.sources.map((s) => [s.sourceId, s.status]));
    expect(status).toMatchObject({ "greenhouse:tide": "on-watchlist", "greenhouse:sumup": "paused", "greenhouse:payhawkio": "removed" });
    const health = await engine.sourceHealth();
    expect(health.sources).toHaveLength(45);
    expect(health.sources.find((s) => s.id === "greenhouse:tide")!.name).toBe("Tide (mine)");
    expect(health.sources.find((s) => s.id === "greenhouse:sumup")!.status).toBe("paused");
  });
});

describe("the first check after seeding", () => {
  /** Every seeded Source answers with a recorded response of its type. */
  function everyFeedAnswers() {
    return routedFetch((req) => {
      const { host } = new URL(req.url);
      if (host === "boards-api.greenhouse.io") return { fixture: "greenhouse-payhawkio.json" };
      if (host === "api.ashbyhq.com") return { fixture: "ashby.json" };
      if (host === "api.lever.co") return { fixture: "lever.json" };
      if (host.endsWith(".recruitee.com") || host === "careers.dronamics.com") return { fixture: "recruitee.json" };
      if (host.endsWith(".teamtailor.com")) return new Response(loadFixture("teamtailor.xml"), { status: 200 });
      if (host === "api.smartrecruiters.com") return { fixture: "smartrecruiters.json" };
      // DXC and Visa filter by a country facet; HPE, Mastercard and Broadcom only list places.
      if (host === "dxctechnology.wd1.myworkdayjobs.com" || host === "visa.wd5.myworkdayjobs.com") return { fixture: "workday-dxc-bulgaria.json" };
      if (host.endsWith(".myworkdayjobs.com")) {
        const facets = (req.json as { appliedFacets: Record<string, string[]> }).appliedFacets;
        return { fixture: facets.locations ? "workday-hpe-bulgaria.json" : "workday-hpe-first-page.json" };
      }
      return undefined;
    });
  }

  it("fills the Feed, and source health reflects every seeded Source", async () => {
    const http = everyFeedAnswers();
    const { engine } = createTestEngine({ fetch: http.fetch });
    const seed = await engine.seedWatchlist();

    const check = await engine.checkAll();

    expect(check.sources).toHaveLength(46);
    expect(check.sources.filter((s) => !s.ok)).toEqual([]);
    const feed = await engine.queryFeed({ view: "open" });
    expect(feed.firstRun).toBe(false);
    expect(feed.jobs.length).toBeGreaterThan(0);
    expect(feed.health).toMatchObject({ state: "working", sources: 46, failing: [] });
    const health = await engine.sourceHealth();
    expect(health.sources.map((s) => s.id).sort()).toEqual(seed.sources.map((s) => s.sourceId).sort());
    for (const s of health.sources) {
      expect(s.status, s.id).toBe("working");
      expect(s.history, s.id).toHaveLength(1);
      expect(s.history[0], s.id).toMatchObject({ outcome: "ok" });
    }
    // A Workday tenant with over a thousand jobs is read through its Bulgarian locations only.
    expect(health.sources.find((s) => s.name === "Hewlett Packard Enterprise")!.history[0]).toMatchObject({ total: 17 });
  });
});
