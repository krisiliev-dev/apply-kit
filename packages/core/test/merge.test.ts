import { describe, expect, it } from "vitest";
import { createTestEngine } from "./harness.ts";
import { routedFetch } from "./http.ts";

// Payhawk's own Greenhouse board (the recorded fixture) plus the same jobs as dev.bg and Jooble list
// them, written in each Source's real format (dev.bg cards, Jooble's search JSON).
const greenhouseBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";
const devbgPage = "https://dev.bg/company/jobs/product-management/";
const joobleApi = "https://jooble.org/api/test-jooble-key";

interface Card { id: string; slug: string; company: string; title: string; place: string }

function devbgCards(cards: Card[]): string {
  return `<!doctype html><html lang="bg"><body><div class="job-list">${cards.map((c) => `
    <div class="job-list-item" data-job-id="${c.id}">
      <a href="https://dev.bg/company/jobads/${c.slug}/" class="overlay-link ab-trigger"></a>
      <span class="company-name hide-for-small">${c.company}</span>
      <h6 class="job-title ab-title-placeholder"> ${c.title} </h6>
      <span class="badge"><img src="pin.png" alt="${c.place}" /> ${c.place} </span>
    </div>`).join("")}</div></body></html>`;
}

interface JoobleJob { id: string; title: string; company: string; location: string; salary?: string }

function joobleJobs(jobs: JoobleJob[]) {
  return {
    totalCount: jobs.length,
    jobs: jobs.map((j) => ({
      title: j.title, location: j.location, snippet: "", salary: j.salary ?? "", source: "example-board.bg", type: "Full-time",
      link: `https://jooble.org/desc/${j.id}?ckey=product`, company: j.company, updated: "2026-10-08T00:00:00.0000000",
    })),
  };
}

const apmCard: Card = { id: "570001", slug: "payhawk-associate-product-manager", company: "Payhawk", title: "Associate Product Manager", place: "София" };
const apmJooble: JoobleJob = { id: "3333333333333333333", title: "Associate Product Manager", company: "Payhawk EOOD", location: "Sofia, Bulgaria", salary: "3000 - 4000 BGN" };

/** An engine with Payhawk's Greenhouse board, a dev.bg category and a Jooble search, answering with these. */
function threeSources(devbg: Card[], jooble: JoobleJob[]) {
  const http = routedFetch((r) => {
    if (r.url === greenhouseBoard) return { fixture: "greenhouse-payhawkio.json" };
    if (r.url === devbgPage) return new Response(devbgCards(devbg));
    if (r.url === joobleApi) return { json: joobleJobs(jooble) };
    return undefined;
  });
  const t = createTestEngine({ fetch: http.fetch, settings: { get: (n) => (n === "JOOBLE_API_KEY" ? "test-jooble-key" : undefined) } });
  return {
    ...t,
    async addAll() {
      await t.engine.addSource({ kind: "greenhouse", config: "payhawkio" });
      await t.engine.addSource({ kind: "devbg", config: "product-management" });
      await t.engine.addSource({ kind: "jooble", config: "product|Bulgaria" });
    },
  };
}

describe("merging postings into jobs", () => {
  it("the same job from three Sources becomes one Job with three Postings", async () => {
    const { engine, addAll } = threeSources([apmCard], [apmJooble]);
    await addAll();

    await engine.checkAll();

    const feed = await engine.queryFeed({ view: "new" });
    const apm = feed.jobs.filter((j) => j.title.startsWith("Associate Product Manager"));
    expect(apm).toHaveLength(1);
    expect(apm[0]).toMatchObject({ company: "Payhawk", postingCount: 3, siteCount: 3 });
    expect(feed.counts.new).toBe(3);
  });

  it("different jobs at the same company with similar titles stay apart", async () => {
    const { engine, addAll } = threeSources([
      { id: "570002", slug: "payhawk-senior-product-manager", company: "Payhawk", title: "Senior Product Manager", place: "София" },
      { id: "570003", slug: "payhawk-apm-payments", company: "Payhawk", title: "Associate Product Manager, Payments", place: "София" },
      // Greenhouse lists Payhawk's Account Executive in London; this one is in Sofia.
      { id: "570004", slug: "payhawk-account-executive", company: "Payhawk", title: "Account Executive", place: "София" },
    ], [
      // No company stated: never evidence that it's Payhawk's job.
      { id: "4444444444444444444", title: "Associate Product Manager", company: "", location: "Sofia, Bulgaria" },
      { id: "5555555555555555555", title: "Customer Support Specialist", company: "Payhawk", location: "Plovdiv, Bulgaria" },
    ]);
    await addAll();

    await engine.checkAll();

    const feed = await engine.queryFeed({ view: "new" });
    expect(feed.counts.new).toBe(8);
    expect(feed.jobs.every((j) => j.postingCount === 1)).toBe(true);
  });

  it("lists a Job's Postings with the company's own page as the default target, and says why each merged", async () => {
    const { engine, addAll } = threeSources([apmCard], [apmJooble]);
    await addAll();
    await engine.checkAll();
    const [row] = (await engine.queryFeed({ view: "new" })).jobs.filter((j) => j.postingCount === 3);

    const job = await engine.getJob(row!.id);

    expect(job).toMatchObject({ id: row!.id, title: "Associate Product Manager", company: "Payhawk", postingCount: 3, siteCount: 3, state: "new" });
    expect(job!.postings.map((p) => [p.source.label, p.site, p.isTarget])).toEqual([
      ["dev.bg", "dev.bg", false],
      ["Greenhouse", "job-boards.eu.greenhouse.io", true],
      ["Jooble", "jooble.org", false],
    ]);
    expect(job!.target).toEqual({
      postingId: "greenhouse:payhawkio:4998241101",
      chosenBy: "default",
      why: "The company's own page (Greenhouse)",
    });
    expect(job!.postings.filter((p) => p.mergedBecause).map((p) => p.mergedBecause)).toEqual([
      "Merged because the company and title match and the locations agree",
      "Merged because the company and title match and the locations agree",
    ]);
    expect(row!.url).toBe("https://job-boards.eu.greenhouse.io/payhawkio/jobs/4998241101");
  });

  it("Kris can make another Posting the target; the Feed links to it and later checks keep his choice", async () => {
    const { engine, addAll } = threeSources([apmCard], [apmJooble]);
    await addAll();
    await engine.checkAll();
    const [row] = (await engine.queryFeed({ view: "new" })).jobs.filter((j) => j.postingCount === 3);

    const job = await engine.setTarget(row!.id, "devbg:product-management:570001");
    await engine.checkAll();

    expect(job.target).toEqual({ postingId: "devbg:product-management:570001", chosenBy: "you", why: "You chose this posting" });
    expect((await engine.getJob(row!.id))!.target.chosenBy).toBe("you");
    const again = (await engine.queryFeed({ view: "new" })).jobs.find((j) => j.id === row!.id);
    expect(again!.url).toBe("https://dev.bg/company/jobads/payhawk-associate-product-manager/");
  });

  it("without a company page among its Postings, the target is the first Posting seen", async () => {
    const { engine, clock, addAll } = threeSources([apmCard], [apmJooble]);
    await addAll();
    await engine.checkSource("jooble:product|bulgaria");
    await clock.advance(60_000);
    await engine.checkSource("devbg:product-management");

    const [row] = (await engine.queryFeed({ view: "new" })).jobs;
    const job = await engine.getJob(row!.id);

    expect(job!.postingCount).toBe(2);
    expect(job!.target).toMatchObject({ postingId: "jooble:product|bulgaria:3333333333333333333", chosenBy: "default" });
    expect(job!.target.why).toBe("First seen here: none of the postings is on the company's own page");
  });
});
