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

  /** Checked once: Payhawk's APM merged from Greenhouse, dev.bg and Jooble. */
  async function mergedApm() {
    const t = threeSources([apmCard], [apmJooble]);
    await t.addAll();
    await t.engine.checkAll();
    const [row] = (await t.engine.queryFeed({ view: "new" })).jobs.filter((j) => j.postingCount === 3);
    return { ...t, apmId: row!.id };
  }

  const joobleApm = "jooble:product|bulgaria:3333333333333333333";

  it("splitting a Posting off makes it its own Job, and later checks remember the split", async () => {
    const { engine, apmId } = await mergedApm();

    const result = await engine.splitPosting(apmId, joobleApm);
    await engine.checkAll();

    expect(result.jobIds).toEqual([apmId, `job:${joobleApm}`]);
    const feed = await engine.queryFeed({ view: "new" });
    expect(feed.counts.new).toBe(4);
    expect((await engine.getJob(apmId))!.postings.map((p) => p.id)).toEqual(["devbg:product-management:570001", "greenhouse:payhawkio:4998241101"]);
    const splitOff = await engine.getJob(`job:${joobleApm}`);
    expect(splitOff).toMatchObject({ postingCount: 1, state: "new", title: "Associate Product Manager", company: "Payhawk EOOD" });
    expect(splitOff!.postings[0]!.mergedBecause).toBeNull();
  });

  it("the Job keeps Kris's decision after a split; the Posting split off is a job he hasn't judged yet", async () => {
    const { engine, apmId } = await mergedApm();
    await engine.pass([apmId], { reason: "salary" });

    await engine.splitPosting(apmId, joobleApm);

    expect((await engine.getJob(apmId))!.state).toBe("passed");
    expect((await engine.getJob(`job:${joobleApm}`))!.state).toBe("new");
  });

  it("splitting the Posting a Job was created from moves the others out together", async () => {
    const { engine, apmId } = await mergedApm();
    const creator = apmId.slice("job:".length);
    await engine.save([apmId]);

    const { jobIds: [kept, other] } = await engine.splitPosting(apmId, creator);
    await engine.checkAll();

    expect(kept).toBe(apmId);
    expect(await engine.getJob(apmId)).toMatchObject({ postingCount: 1, state: "saved" });
    const rest = await engine.getJob(other);
    expect(rest).toMatchObject({ postingCount: 2, state: "new" });
    expect(rest!.postings.map((p) => p.id)).not.toContain(creator);
  });

  it("a split clears Kris's target if it moved away, falling back to the company's page", async () => {
    const { engine, apmId } = await mergedApm();
    await engine.setTarget(apmId, joobleApm);

    await engine.splitPosting(apmId, joobleApm);

    expect((await engine.getJob(apmId))!.target).toMatchObject({ postingId: "greenhouse:payhawkio:4998241101", chosenBy: "default" });
  });

  it("refuses to split a Job with one Posting or a Posting that isn't in the Job, and changes nothing", async () => {
    const { engine, apmId } = await mergedApm();
    const single = (await engine.queryFeed({ view: "new" })).jobs.find((j) => j.postingCount === 1)!;

    await expect(engine.splitPosting(single.id, single.id.slice(4))).rejects.toThrow(/only one posting/);
    await expect(engine.splitPosting(apmId, "devbg:product-management:999")).rejects.toThrow(/isn't part of/);
    expect((await engine.getJob(apmId))!.postingCount).toBe(3);
  });

  it("a newly found copy of a job Kris already saved joins it and keeps it saved", async () => {
    const { engine, clock, addAll } = threeSources([apmCard], [apmJooble]);
    await addAll();
    await engine.checkSource("greenhouse:payhawkio");
    const [gh] = (await engine.queryFeed({ view: "new" })).jobs.filter((j) => j.title.startsWith("Associate"));
    await engine.save([gh!.id]);
    await clock.advance(60_000);

    await engine.checkAll();

    const saved = await engine.queryFeed({ view: "saved" });
    expect(saved.jobs).toEqual([expect.objectContaining({ id: gh!.id, postingCount: 3, state: "saved" })]);
    expect(saved.counts).toMatchObject({ new: 2, saved: 1 });
  });

  it("when two Jobs Kris decided on turn out to be one, his most recent decision wins, and undoing it restores the earlier one", async () => {
    // dev.bg first lists the job under a different title, so it starts as a Job of its own,
    // newer than the Greenhouse one: the older Job keeps its id.
    let devbgTitle = "APM";
    const http = routedFetch((r) => {
      if (r.url === greenhouseBoard) return { fixture: "greenhouse-payhawkio.json" };
      if (r.url === devbgPage) return new Response(devbgCards([{ ...apmCard, title: devbgTitle }]));
      return undefined;
    });
    const { engine, clock } = createTestEngine({ fetch: http.fetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    await engine.addSource({ kind: "devbg", config: "product-management" });
    await engine.checkSource("greenhouse:payhawkio");
    await clock.advance(60_000);
    await engine.checkSource("devbg:product-management");
    const jobs = (await engine.queryFeed({ view: "new" })).jobs;
    const gh = jobs.find((j) => j.title === "Associate Product Manager")!;
    const dev = jobs.find((j) => j.title === "APM")!;
    await engine.save([gh.id]);
    await clock.advance(60_000);
    const pass = await engine.pass([dev.id], { reason: "salary" });
    await clock.advance(60_000);

    devbgTitle = "Associate Product Manager";
    await engine.checkAll();

    const passed = await engine.queryFeed({ view: "passed" });
    expect(passed.jobs).toEqual([expect.objectContaining({ id: gh.id, postingCount: 2, state: "passed", passed: expect.objectContaining({ reason: "salary", decisionId: pass.id }) })]);
    expect(passed.counts).toMatchObject({ new: 2, saved: 0, passed: 1 });
    expect(await engine.getJob(dev.id)).toMatchObject({ id: gh.id });

    await engine.undo(pass.id);

    expect((await engine.queryFeed({ view: "saved" })).jobs).toEqual([expect.objectContaining({ id: gh.id, state: "saved" })]);
  });

  it("merges the same way whichever Source answers first", async () => {
    const order = ["greenhouse:payhawkio", "devbg:product-management", "jooble:product|bulgaria"];
    const grouped = async (sourceIds: string[]) => {
      const { engine, addAll } = threeSources([{ ...apmCard, title: "Associate Product Manager (m/f/d)" }], [apmJooble]);
      await addAll();
      for (const id of sourceIds) await engine.checkSource(id);
      return (await engine.queryFeed({ view: "new" })).jobs.map((j) => [j.id, j.postingCount]);
    };

    const forwards = await grouped(order);

    expect(forwards).toContainEqual(["job:devbg:product-management:570001", 3]);
    expect(await grouped([...order].reverse())).toEqual(forwards);
  });
});
