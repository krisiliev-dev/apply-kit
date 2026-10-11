// Coverage checks: Kris records a manual search he ran, and the engine compares it with the Feed,
// explaining every job it doesn't have and offering a fix.
import { describe, expect, it } from "vitest";
import { defaultSearchSettings } from "../src/index.ts";
import { cannedFacts, createTestEngine, fakeExtractor } from "./harness.ts";
import { routedFetch } from "./http.ts";

const greenhouseBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";

interface BoardJob { id: number; title: string; location: string }

/**
 * Greenhouse boards answering with what each test puts on them, written in Greenhouse's real format.
 * A board in `down` fails (Greenhouse answers 500) until it is taken out.
 */
function boards(initial: Record<string, { company: string; jobs: BoardJob[] }>) {
  const state = { boards: initial, down: new Set<string>() };
  const http = routedFetch((r) => {
    const m = /boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs/.exec(r.url);
    const b = m && state.boards[m[1]!];
    if (!m || !b) return undefined;
    if (state.down.has(m[1]!)) return new Response("Internal Server Error", { status: 500 });
    return {
      json: {
        jobs: b.jobs.map((j) => ({
          id: j.id, title: j.title, company_name: b.company, location: { name: j.location },
          absolute_url: `https://job-boards.eu.greenhouse.io/${m[1]}/jobs/${j.id}`, first_published: "2026-10-01T09:00:00Z", content: "",
        })),
      },
    };
  });
  const t = createTestEngine({ fetch: http.fetch });
  return { ...t, state };
}

/** An engine with Payhawk's Greenhouse board (recorded: APM and Support in Sofia, Account Executive in London). */
function payhawk() {
  const http = routedFetch((r) => (r.url === greenhouseBoard ? { fixture: "greenhouse-payhawkio.json" } : undefined));
  const t = createTestEngine({ fetch: http.fetch });
  return { ...t, http };
}

describe("coverage check: found and missing", () => {
  it("a listing the Feed has counts as found, linked to its Job", async () => {
    const { engine } = payhawk();
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    await engine.checkAll();

    const result = await engine.recordCoverageCheck({
      site: "dev.bg",
      query: "product",
      location: "Sofia",
      resultCount: 1,
      listings: [{ title: "Associate Product Manager", company: "Payhawk EOOD", location: "София" }],
    });

    const apm = (await engine.queryFeed({ view: "new" })).jobs.find((j) => j.title.startsWith("Associate Product Manager"))!;
    expect(result.listings).toEqual([
      expect.objectContaining({ title: "Associate Product Manager", status: "in-feed", jobId: apm.id }),
    ]);
    expect(result.totals).toMatchObject({ saw: 1, found: 1, inFeed: 1, hidden: 0, missing: 0 });
  });

  it("a job from a company no Source covers is missing, with the reason and an offer to add the company", async () => {
    const { engine } = payhawk();
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    await engine.checkAll();

    const result = await engine.recordCoverageCheck({
      site: "dev.bg", query: "security", location: "Sofia", resultCount: 1,
      listings: [{ title: "Information Security Officer", company: "Fibank", location: "Sofia" }],
    });

    expect(result.listings[0]).toMatchObject({
      status: "missing",
      jobId: null,
      reason: { kind: "not-covered", text: "Fibank isn't on your watchlist, and none of your sources listed this job." },
      fixes: [{ kind: "add-company", company: "Fibank", label: "Add Fibank to your watchlist" }],
    });
    expect(result.totals).toMatchObject({ saw: 1, found: 0, missing: 1 });
  });
});

describe("coverage check: missing from companies apply-kit doesn't watch", () => {
  it("a job outside Kris's locations is missing because nothing searches there, with the fix to change his locations", async () => {
    const { engine } = boards({});

    const result = await engine.recordCoverageCheck({
      site: "dev.bg", query: "security", listings: [{ title: "Security Analyst", company: "Telelink", location: "Пловдив" }],
    });

    expect(result.listings[0]).toMatchObject({
      status: "missing",
      reason: { kind: "outside-locations", text: "It's in Пловдив, outside your locations, so your searches don't look for it." },
      fixes: [
        { kind: "adjust-locations", place: "Пловдив", label: "Change your locations" },
        { kind: "add-company", company: "Telelink", label: "Add Telelink to your watchlist" },
      ],
    });
  });

  it("a job seen on a site that sends job alerts offers to connect its alerts when none are connected", async () => {
    const { engine } = boards({});
    await engine.addSource({ kind: "email", config: "jobsbg" });

    const onLinkedIn = await engine.recordCoverageCheck({
      site: "LinkedIn", query: "security", listings: [{ title: "SOC Analyst", company: "Paysafe", location: "Sofia" }],
    });
    const onJobsBg = await engine.recordCoverageCheck({
      site: "jobs.bg", query: "security", listings: [{ title: "SOC Analyst", company: "Paysafe", location: "Sofia" }],
    });

    expect(onLinkedIn.listings[0]!.fixes).toEqual([
      { kind: "add-company", company: "Paysafe", label: "Add Paysafe to your watchlist" },
      { kind: "add-source", source: { kind: "email", config: "linkedin", name: "LinkedIn job alerts" }, label: "Connect LinkedIn job alerts" },
    ]);
    // jobs.bg alerts are already connected: only the company is offered.
    expect(onJobsBg.listings[0]!.fixes).toEqual([{ kind: "add-company", company: "Paysafe", label: "Add Paysafe to your watchlist" }]);
  });
});

describe("coverage check: missing from a company apply-kit watches", () => {
  const acme = () => boards({ acme: { company: "Acme", jobs: [{ id: 1, title: "Backend Developer", location: "Sofia" }] } });
  const securityEngineer = { title: "Security Engineer", company: "Acme", location: "Sofia" };

  it("while the company's Source is failing: its jobs are kept, new ones can't arrive, and it can be tried now", async () => {
    const { engine, state, clock } = acme();
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();
    state.down.add("acme");
    await clock.advance(30 * 60_000);
    await engine.checkAll();

    const result = await engine.recordCoverageCheck({ site: "dev.bg", query: "security", listings: [securityEngineer] });

    expect(result.listings[0]).toMatchObject({
      status: "missing",
      reason: { kind: "source-failing", sourceId: "greenhouse:acme", at: "2026-10-12T08:00:00.000Z", text: "Acme's jobs come from acme (Greenhouse), which is failing. New jobs can't arrive until it works again." },
      fixes: [{ kind: "check-source", sourceId: "greenhouse:acme", label: "Try acme now" }],
    });
  });

  it("while the company's Source is paused, with the fix to resume it", async () => {
    const { engine } = acme();
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();
    await engine.pauseSource("greenhouse:acme");

    const result = await engine.recordCoverageCheck({ site: "dev.bg", query: "security", listings: [securityEngineer] });

    expect(result.listings[0]).toMatchObject({
      reason: { kind: "source-paused", sourceId: "greenhouse:acme", text: "Acme's jobs come from acme (Greenhouse), which you paused." },
      fixes: [{ kind: "resume-source", sourceId: "greenhouse:acme", label: "Resume acme" }],
    });
  });

  it("after the company's Source was removed, with the fix to add it back", async () => {
    const { engine } = acme();
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();
    await engine.removeSource("greenhouse:acme");

    const result = await engine.recordCoverageCheck({ site: "dev.bg", query: "security", listings: [securityEngineer] });

    expect(result.listings[0]).toMatchObject({
      reason: { kind: "source-removed", sourceId: "greenhouse:acme", text: "You removed acme (Greenhouse), which listed Acme's jobs." },
      fixes: [{ kind: "add-source", source: { kind: "greenhouse", config: { board: "acme" }, name: "acme" }, label: "Add acme back" }],
    });
  });

  it("when the company's working Source didn't list it at its last check, with the fix to check now", async () => {
    const { engine } = acme();
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();

    const result = await engine.recordCoverageCheck({ site: "dev.bg", query: "security", listings: [securityEngineer] });

    expect(result.listings[0]).toMatchObject({
      reason: {
        kind: "not-listed", sourceId: "greenhouse:acme",
        at: "2026-10-12T07:30:00.000Z", text: "acme (Greenhouse) didn't list it at its last check. It may be newer than that check, or listed only on other sites.",
      },
      fixes: [{ kind: "check-source", sourceId: "greenhouse:acme", label: "Check acme now" }],
    });
  });

  it("a company found through a Source that watches it is matched by name too, before its first job arrives", async () => {
    const { engine } = boards({ acme: { company: "Acme", jobs: [] } });
    await engine.addSource({ kind: "greenhouse", config: "acme", name: "Acme" });
    await engine.checkAll();

    const result = await engine.recordCoverageCheck({ site: "dev.bg", query: "security", listings: [{ ...securityEngineer, company: "ACME Ltd" }] });

    expect(result.listings[0]).toMatchObject({ reason: { kind: "not-listed", sourceId: "greenhouse:acme" } });
  });
});

describe("coverage check: found, but not in the main Feed", () => {
  it("a relocation job is found, kept behind the Relocation filter, with the fix to turn it on", async () => {
    const { engine } = boards({ acme: { company: "Acme", jobs: [{ id: 1, title: "Security Engineer", location: "Zurich, Switzerland" }] } });
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();

    const result = await engine.recordCoverageCheck({
      site: "LinkedIn", query: "security engineer",
      listings: [{ title: "Security Engineer", company: "Acme AG", location: "Zürich" }],
    });

    expect(result.listings[0]).toMatchObject({
      status: "hidden",
      reason: { kind: "relocation", text: "It's a relocation job (Switzerland): relocation jobs show only with the Relocation filter on." },
      fixes: [{ kind: "show-relocation", label: "Turn on Relocation" }],
    });
    expect(result.totals).toMatchObject({ found: 1, inFeed: 0, hidden: 1, missing: 0 });
  });

  it("a job hidden by a dealbreaker is found, in the hidden pile, with the fixes to show it or change the rule", async () => {
    const extractor = fakeExtractor({
      "Security Engineer": cannedFacts({
        languages: [{ language: "German", level: "fluent", kind: "required", source: { quote: "Fluent German", translation: null }, confidence: 0.95 }],
      }),
    });
    const http = routedFetch(() => ({
      json: { jobs: [{ id: 1, title: "Security Engineer", company_name: "Acme", location: { name: "Sofia" }, absolute_url: "https://example.test/jobs/1", content: "&lt;p&gt;Fluent German&lt;/p&gt;" }] },
    }));
    const searchSettings = { ...defaultSearchSettings, dealbreakers: { ...defaultSearchSettings.dealbreakers, languagesNotSpoken: ["German"] } };
    const { engine } = createTestEngine({ fetch: http.fetch, extractor, searchSettings });
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();
    await engine.readPending();
    const [job] = (await engine.queryFeed({ view: "hidden" })).jobs;

    const result = await engine.recordCoverageCheck({
      site: "dev.bg", query: "security", listings: [{ title: "Security Engineer", company: "Acme", location: "Sofia" }],
    });

    expect(result.listings[0]).toMatchObject({
      status: "hidden", jobId: job!.id,
      reason: { kind: "dealbreaker", text: "Hidden by your dealbreakers: Requires German (fluent): a language you don't speak. It's in the hidden pile." },
      fixes: [
        { kind: "unhide", jobId: job!.id, label: "Show this job" },
        { kind: "not-a-dealbreaker", jobId: job!.id, reasonKey: "language:German", label: "Not a dealbreaker for me" },
      ],
    });
    expect(result.totals).toMatchObject({ found: 1, inFeed: 0, hidden: 1, missing: 0 });
  });

  it("a job Kris passed is found, in Passed & closed, with the pass to undo", async () => {
    const { engine } = boards({ acme: { company: "Acme", jobs: [{ id: 1, title: "Security Engineer", location: "Sofia" }] } });
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();
    const [job] = (await engine.queryFeed({ view: "new" })).jobs;
    const decision = await engine.pass([job!.id], { reason: "salary" });

    const result = await engine.recordCoverageCheck({
      site: "dev.bg", query: "security", listings: [{ title: "Security Engineer", company: "Acme", location: "Sofia" }],
    });

    expect(result.listings[0]).toMatchObject({
      status: "hidden", jobId: job!.id,
      reason: { kind: "passed", text: "You passed it. It's in Passed & closed." },
      fixes: [{ kind: "undo", decisionId: decision.id, label: "Undo the pass" }],
    });
  });

  it("a closed job is found, in Passed & closed with how it closed, and can be reopened", async () => {
    const { engine } = boards({ acme: { company: "Acme", jobs: [{ id: 1, title: "Security Engineer", location: "Sofia" }] } });
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();
    const [job] = (await engine.queryFeed({ view: "new" })).jobs;
    await engine.close([job!.id], "No longer listed by Greenhouse");

    const result = await engine.recordCoverageCheck({
      site: "dev.bg", query: "security", listings: [{ title: "Security Engineer", company: "Acme", location: "Sofia" }],
    });

    expect(result.listings[0]).toMatchObject({
      status: "hidden",
      reason: { kind: "closed", text: "It was closed (No longer listed by Greenhouse). It's in Passed & closed." },
      fixes: [{ kind: "reopen", jobId: job!.id, label: "Reopen it" }],
    });
  });
});

describe("coverage check: what Kris can give", () => {
  const acme = () => boards({
    acme: {
      company: "Acme",
      jobs: [
        { id: 1, title: "Security Engineer", location: "Sofia" },
        { id: 2, title: "Backend Developer", location: "Sofia" },
        { id: 3, title: "Security Analyst", location: "London" },
        { id: 4, title: "Application Security Lead", location: "Remote, Europe" },
      ],
    },
  });

  it("with only a result count, compares it with how many jobs apply-kit has for that search", async () => {
    const { engine } = acme();
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();

    const result = await engine.recordCoverageCheck({ site: "dev.bg", query: "Security", location: "София", resultCount: 5 });

    // Security Engineer (Sofia) and Application Security Lead (remote) match; London doesn't, nor does Backend Developer.
    expect(result.totals).toEqual({ saw: 5, listed: 0, appHad: 2, found: 0, inFeed: 0, hidden: 0, missing: 0 });
    expect((await engine.coverageHistory()).checks[0]).toMatchObject({ saw: 5, appHad: 2, missing: 0 });
  });

  it("listings can be pasted as text, one per line: title, company and location, or just a link", async () => {
    const { engine } = acme();
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();

    const result = await engine.recordCoverageCheck({
      site: "dev.bg", query: "security",
      listings: [
        "Security Engineer · Acme · Sofia",
        "  SOC Analyst | Fibank | София  ",
        "",
        "Backend Developer - Acme",
        "Security Architect at Telerik",
        "https://job-boards.eu.greenhouse.io/acme/jobs/4",
      ].join("\n"),
    });

    expect(result.listings.map(({ title, company, location, url, status }) => ({ title, company, location, url, status }))).toEqual([
      { title: "Security Engineer", company: "Acme", location: "Sofia", url: null, status: "in-feed" },
      { title: "SOC Analyst", company: "Fibank", location: "София", url: null, status: "missing" },
      { title: "Backend Developer", company: "Acme", location: null, url: null, status: "in-feed" },
      { title: "Security Architect", company: "Telerik", location: null, url: null, status: "missing" },
      { title: "Application Security Lead", company: "Acme", location: "Remote, Europe", url: "https://job-boards.eu.greenhouse.io/acme/jobs/4", status: "in-feed" },
    ]);
    expect(result.totals).toMatchObject({ saw: 5, listed: 5, appHad: 3, found: 3, missing: 2 });
  });

  it("a pasted link apply-kit doesn't know is missing, described by its link", async () => {
    const { engine } = acme();

    const result = await engine.recordCoverageCheck({ site: "LinkedIn", query: "security", listings: "https://www.linkedin.com/jobs/view/4100000001/" });

    expect(result.listings[0]).toMatchObject({
      title: "https://www.linkedin.com/jobs/view/4100000001/", company: "", status: "missing",
      reason: { kind: "not-covered", text: "None of your sources listed this job. Paste its title and company to see why." },
    });
  });
});

describe("coverage check: what it needs", () => {
  it("refuses a check without a site, or with nothing seen to compare, and records nothing", async () => {
    const { engine } = boards({});

    await expect(engine.recordCoverageCheck({ site: " ", query: "security", resultCount: 3 })).rejects.toThrow("Say which site you searched");
    await expect(engine.recordCoverageCheck({ site: "dev.bg", query: "security" }))
      .rejects.toThrow("Type how many results you saw, paste the listings, or paste the results link");
    await expect(engine.recordCoverageCheck({ site: "dev.bg", query: "security", resultCount: -1 }))
      .rejects.toThrow("The number of results must be a whole number, 0 or more");
    expect((await engine.coverageHistory()).checks).toEqual([]);
  });
});

describe("coverage check: a dev.bg results link", () => {
  const resultsLink = "https://dev.bg/?s=security&post_type=job_listing&job_location_city=sofia";
  /** A dev.bg search-results page in dev.bg's real card markup. */
  const resultsPage = `<!doctype html><html lang="bg"><body><div class="job-list">
    <div class="job-list-item" data-job-id="580001">
      <a href="https://dev.bg/company/jobads/acme-security-engineer/" class="overlay-link"></a>
      <span class="company-name hide-for-small">Acme</span>
      <h6 class="job-title"> Security Engineer </h6>
      <span class="badge"><img src="pin.png" alt="София" /> София </span>
    </div>
    <div class="job-list-item" data-job-id="580002">
      <a href="https://dev.bg/company/jobads/fibank-information-security-officer/" class="overlay-link"></a>
      <span class="company-name hide-for-small">Fibank</span>
      <h6 class="job-title"> Information Security Officer </h6>
      <span class="badge"><img src="pin.png" alt="София" /> София </span>
    </div>
  </div></body></html>`;

  it("is read once for its listings and their count", async () => {
    const http = routedFetch((r) => {
      if (r.url === greenhouseBoard) return { json: { jobs: [{ id: 1, title: "Security Engineer", company_name: "Acme", location: { name: "Sofia" }, absolute_url: "https://job-boards.eu.greenhouse.io/acme/jobs/1" }] } };
      if (r.url === resultsLink) return new Response(resultsPage);
      return undefined;
    });
    const { engine } = createTestEngine({ fetch: http.fetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    await engine.checkAll();

    const result = await engine.recordCoverageCheck({ site: "dev.bg", query: "security", location: "Sofia", resultsUrl: resultsLink });

    expect(http.requests.filter((r) => r.url === resultsLink)).toHaveLength(1);
    expect(result.listings).toMatchObject([
      { title: "Security Engineer", company: "Acme", location: "София", url: "https://dev.bg/company/jobads/acme-security-engineer/", status: "in-feed" },
      { title: "Information Security Officer", company: "Fibank", status: "missing" },
    ]);
    expect(result.totals).toMatchObject({ saw: 2, listed: 2, found: 1, missing: 1 });
  });

  it("from another site is refused with what to do instead, and nothing is recorded", async () => {
    const { engine } = boards({});

    await expect(engine.recordCoverageCheck({ site: "LinkedIn", query: "security", resultsUrl: "https://www.linkedin.com/jobs/search/?keywords=security" }))
      .rejects.toThrow("apply-kit reads results pages from dev.bg only. For other sites, paste the listings or type the number of results.");
    expect((await engine.coverageHistory()).checks).toEqual([]);
  });
});

describe("coverage history", () => {
  it("keeps every check, newest first, with what Kris saw, what apply-kit had and what was missing", async () => {
    const { engine, clock } = boards({ acme: { company: "Acme", jobs: [{ id: 1, title: "Security Engineer", location: "Sofia" }] } });
    await engine.addSource({ kind: "greenhouse", config: "acme" });
    await engine.checkAll();
    const first = await engine.recordCoverageCheck({
      site: "dev.bg", query: "security", location: "Sofia", resultCount: 3,
      listings: [{ title: "Security Engineer", company: "Acme", location: "Sofia" }, { title: "SOC Analyst", company: "Fibank", location: "Sofia" }],
    });
    await clock.advance(24 * 60 * 60_000);
    const second = await engine.recordCoverageCheck({
      site: "LinkedIn", query: "developer", listings: [{ title: "Security Engineer", company: "Acme", location: "Sofia" }],
    });

    const history = await engine.coverageHistory();

    expect(history.checks).toEqual([
      { id: second.id, at: "2026-10-13T07:30:00.000Z", site: "LinkedIn", query: "developer", location: null, saw: 1, listed: 1, appHad: 1, missing: 0, fixed: 0 },
      { id: first.id, at: "2026-10-12T07:30:00.000Z", site: "dev.bg", query: "security", location: "Sofia", saw: 3, listed: 2, appHad: 1, missing: 1, fixed: 0 },
    ]);
    expect(history.lastCheckAt).toBe("2026-10-13T07:30:00.000Z");
    // A full check result can be opened again later, as it was.
    expect(await engine.getCoverageCheck(first.id)).toMatchObject({
      id: first.id, totals: first.totals,
      listings: [{ title: "Security Engineer", status: "in-feed" }, { title: "SOC Analyst", status: "missing", reason: { kind: "not-covered" } }],
    });
    expect(await engine.getCoverageCheck("coverage:nope")).toBeNull();
  });

  it("a missing job that arrives later counts as fixed, linked to its Job", async () => {
    const { engine, state, clock } = boards({ acme: { company: "Acme", jobs: [] } });
    await engine.addSource({ kind: "greenhouse", config: "acme", name: "Acme" });
    await engine.checkAll();
    const check = await engine.recordCoverageCheck({
      site: "dev.bg", query: "security", listings: [{ title: "Security Engineer", company: "Acme", location: "Sofia" }],
    });
    expect(check.listings[0]).toMatchObject({ status: "missing", fixedBy: null });

    state.boards.acme!.jobs.push({ id: 7, title: "Security Engineer", location: "Sofia" });
    await clock.advance(30 * 60_000);
    await engine.checkAll();

    const job = (await engine.queryFeed({ view: "new" })).jobs[0]!;
    expect((await engine.coverageHistory()).checks[0]).toMatchObject({ missing: 1, fixed: 1 });
    expect((await engine.getCoverageCheck(check.id))!.listings[0]).toMatchObject({ status: "missing", fixedBy: job.id });
  });

  it("is due when there has been no coverage check for a week", async () => {
    const { engine, clock } = boards({});
    expect(await engine.coverageHistory()).toMatchObject({ checks: [], lastCheckAt: null, due: true });

    await engine.recordCoverageCheck({ site: "dev.bg", query: "security", resultCount: 0 });
    expect((await engine.coverageHistory()).due).toBe(false);

    await clock.advance(7 * 24 * 60 * 60_000);
    expect((await engine.coverageHistory()).due).toBe(true);
  });
});
