// Adding a company by name or careers link: detecting its job system, the not-found fallbacks.
import { describe, expect, it } from "vitest";
import { createTestEngine, loadFixture } from "./harness.ts";
import { routedFetch, type Answer } from "./http.ts";

const notFound = () => new Response('{"error":"Not Found"}', { status: 404 });

/** A fetch where only the given URLs exist; every other request is a 404, like an unknown board. */
function onlyThese(routes: Record<string, Answer>) {
  return routedFetch((req) => routes[req.url] ?? notFound());
}

const greenhouse = (board: string) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;

describe("adding a company: detecting its job system", () => {
  it("finds a company's Greenhouse board from its name, with its open jobs and how many are in Kris's locations", async () => {
    const http = onlyThese({ [greenhouse("payhawk")]: { fixture: "greenhouse-payhawkio.json" } });
    const { engine } = createTestEngine({ fetch: http.fetch });

    const found = await engine.detectCompany("Payhawk");

    expect(found.company).toBe("Payhawk");
    expect(found.systems.find((s) => s.kind === "greenhouse")).toMatchObject({
      label: "Greenhouse",
      status: "found",
      tried: "payhawk",
      openJobs: 3,
      inLocations: 2,
      source: { kind: "greenhouse", config: { board: "payhawk" }, name: "Payhawk" },
    });
    expect(found.systems.find((s) => s.kind === "lever")).toMatchObject({ status: "not-found", tried: "payhawk" });
    expect(found.fallbacks).toEqual([]);
  });
});

describe("adding a company: every job system", () => {
  /** "Acme" has a board on every job system that can be guessed from a name. */
  const acmeEverywhere: Record<string, string> = {
    "boards-api.greenhouse.io": "greenhouse-payhawkio.json",
    "api.lever.co": "lever.json",
    "api.ashbyhq.com": "ashby.json",
    "acme.recruitee.com": "recruitee.json",
    "api.smartrecruiters.com": "smartrecruiters.json",
    "acme.jobs.personio.de": "personio.xml",
    "acme.teamtailor.com": "teamtailor.xml",
  };

  it("asks each job system once, reports progress as each answers, and lists what every one said", async () => {
    const http = routedFetch((req) => {
      const fixture = acmeEverywhere[new URL(req.url).host];
      return fixture ? { fixture } : notFound();
    });
    const { engine } = createTestEngine({ fetch: http.fetch });
    const progress: number[] = [];

    const found = await engine.detectCompany("Acme", {
      onProgress: (d) => progress.push(d.systems.filter((s) => !["waiting", "checking"].includes(s.status)).length),
    });

    const byKind = Object.fromEntries(found.systems.map((s) => [s.kind, s]));
    for (const kind of ["greenhouse", "lever", "ashby", "recruitee", "smartrecruiters", "personio", "teamtailor"]) {
      expect(byKind[kind], kind).toMatchObject({ status: "found", via: "name", source: { kind, name: "Acme" } });
    }
    expect(byKind.workday).toMatchObject({ status: "needs-link", tried: null });
    expect(found.finished).toBe(true);
    const hosts = http.requests.map((r) => new URL(r.url).host);
    expect(hosts.sort()).toEqual(Object.keys(acmeEverywhere).sort());
    // Workday is known straight away; then one more system answers at a time, ending with all 8.
    expect(progress.at(0)).toBe(0);
    expect(progress.at(-1)).toBe(8);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("finds a Workday site from its careers link, reading only the first page of a big one", async () => {
    const big = JSON.parse(loadFixture("workday-dxc-bulgaria.json")) as { total: number };
    big.total = 340;
    const http = routedFetch((req) => (req.url.includes("myworkdayjobs.com/wday/cxs/") ? { json: big } : notFound()));
    const { engine } = createTestEngine({ fetch: http.fetch });

    const found = await engine.detectCompany("https://dxctechnology.wd1.myworkdayjobs.com/en-US/DXCJobs");

    expect(found.company).toBe("Dxctechnology");
    expect(found.careersPage).toBeNull();
    expect(found.systems.find((s) => s.kind === "workday")).toMatchObject({
      status: "found", via: "link", openJobs: 340, inLocations: null,
      source: { kind: "workday", config: { url: "https://dxctechnology.wd1.myworkdayjobs.com/en-US/DXCJobs" } },
    });
    expect(http.requests.filter((r) => r.url.includes("myworkdayjobs.com"))).toHaveLength(1);
  });

  it("reads a careers page on the company's own site once and follows its link to a job system", async () => {
    const page = `<html><body><a href="https://jobs.lever.co/kestrel-pay/abc">Open roles</a></body></html>`;
    const http = routedFetch((req) => {
      if (req.url === "https://kestrel.com/careers") return new Response(page, { status: 200 });
      if (req.url === "https://api.lever.co/v0/postings/kestrel-pay?mode=json") return { fixture: "lever.json" };
      return notFound();
    });
    const { engine } = createTestEngine({ fetch: http.fetch });

    const found = await engine.detectCompany("kestrel.com/careers");

    expect(found.company).toBe("Kestrel");
    expect(found.careersPage).toEqual({ url: "https://kestrel.com/careers", outcome: "read" });
    expect(found.systems.find((s) => s.kind === "lever")).toMatchObject({ status: "found", via: "careers-page", tried: "kestrel-pay" });
    expect(found.systems.find((s) => s.kind === "greenhouse")).toMatchObject({ status: "not-found", via: "name", tried: "kestrel" });
    expect(http.requests.filter((r) => r.url === "https://kestrel.com/careers")).toHaveLength(1);
  });

  it("says which Sources are already on the watchlist", async () => {
    const http = onlyThese({ [greenhouse("payhawk")]: { fixture: "greenhouse-payhawkio.json" } });
    const { engine } = createTestEngine({ fetch: http.fetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawk" });

    const found = await engine.detectCompany("Payhawk");

    expect(found.systems.find((s) => s.kind === "greenhouse")).toMatchObject({ status: "found", sourceId: "greenhouse:payhawk" });
  });

  it("treats a job system that can't be reached as unknown, not as 'not there'", async () => {
    const http = routedFetch((req) => (req.url.includes("lever.co") ? undefined : notFound()));
    const { engine } = createTestEngine({ fetch: http.fetch });

    const found = await engine.detectCompany("Payhawk");

    expect(found.systems.find((s) => s.kind === "lever")).toMatchObject({ status: "error", message: expect.stringContaining("nothing answers") });
  });
});
