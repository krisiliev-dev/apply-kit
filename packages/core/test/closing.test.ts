// Closing rules: when a Job closes because its Postings are gone, and when it never does on its own.
// A Source that lists everything closes what it stops listing; a capped search never does; a sharp
// drop against a Source's normal volume keeps every Job open until Kris confirms.
import { describe, expect, it } from "vitest";
import { createTestEngine, loadFixture } from "./harness.ts";
import { routedFetch } from "./http.ts";

const boardUrl = (b: string) => `https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`;

type GreenhouseJob = { id: number | string; title: string; absolute_url: string; [k: string]: unknown };
const recorded = JSON.parse(loadFixture("greenhouse-payhawkio.json")) as { jobs: GreenhouseJob[]; meta: unknown };

/** A Greenhouse board with `n` distinct Sofia jobs, cloned from the recorded Payhawk board. */
function boardOf(n: number, prefix = "Engineer"): GreenhouseJob[] {
  const base = recorded.jobs[0]!;
  return Array.from({ length: n }, (_, i) => ({
    ...base,
    id: `9000${i}`,
    title: `${prefix} ${i + 1}`,
    absolute_url: `https://job-boards.eu.greenhouse.io/payhawkio/jobs/9000${i}`,
  }));
}

/** Greenhouse boards whose listings the test changes between checks. */
function boards(initial: Record<string, GreenhouseJob[]>) {
  const listing = { ...initial };
  const http = routedFetch((req) => {
    const name = Object.keys(listing).find((b) => req.url === boardUrl(b));
    return name ? { json: { jobs: listing[name], meta: { total: listing[name]!.length } } } : undefined;
  });
  return { listing, fetch: http.fetch };
}

const halfHour = 30 * 60_000;

async function openTitles(engine: ReturnType<typeof createTestEngine>["engine"]) {
  return (await engine.queryFeed({ view: "open", sort: "newest" })).jobs.map((j) => j.title).sort();
}

describe("closing: a Source that lists everything", () => {
  it("closes a Job its only Source stops listing, saying how", async () => {
    const b = boards({ payhawkio: recorded.jobs });
    const { engine, clock } = createTestEngine({ fetch: b.fetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawkio", name: "Payhawk" });
    await engine.checkAll();

    b.listing.payhawkio = recorded.jobs.filter((j) => j.title.trim() !== "Account Executive");
    await clock.advance(halfHour);
    await engine.checkAll();

    const closed = (await engine.queryFeed({ view: "passed" })).jobs;
    expect(closed).toEqual([expect.objectContaining({
      title: "Account Executive", state: "closed",
      closed: { at: clock.now().toISOString(), how: "No longer listed by Payhawk", decisionId: expect.any(String) },
    })]);
    expect(await openTitles(engine)).toHaveLength(2);
  });
});

/** SumUp's board listed 34 jobs at three good Checks (07:30, 08:00, 08:30); then the test changes it. */
async function sumupLearned() {
  const b = boards({ sumup: boardOf(34) });
  const t = createTestEngine({ fetch: b.fetch });
  const source = await t.engine.addSource({ kind: "greenhouse", config: "sumup", name: "SumUp" });
  await t.engine.checkAll();
  for (let i = 0; i < 2; i++) {
    await t.clock.advance(halfHour);
    await t.engine.checkAll();
  }
  return { ...t, b, source };
}

describe("closing: an unusual drop", () => {
  it("never closes anything on its own, however many empty Checks follow", async () => {
    const { engine, clock, b } = await sumupLearned();

    b.listing.sumup = [];
    for (let i = 0; i < 8; i++) {
      await clock.advance(halfHour);
      await engine.checkAll();
    }

    expect(await openTitles(engine)).toHaveLength(34);
    expect((await engine.queryFeed({ view: "passed" })).jobs).toEqual([]);
  });

  it("marks the Source unusual against its normal volume and keeps its Jobs open", async () => {
    const { engine, clock, b, source } = await sumupLearned();

    b.listing.sumup = [];
    await clock.advance(halfHour);
    await engine.checkAll();
    const health = await engine.sourceHealth();

    expect(health.sources[0]).toMatchObject({
      id: source.id, status: "unusual", jobsKept: 34,
      normal: { usual: 34, low: 34, high: 34 },
    });
    expect(health.summary.state).toBe("unusual");
    expect(health.summary.unusual).toEqual([{
      sourceId: source.id,
      name: "SumUp",
      since: "2026-10-12T09:00:00.000Z",
      latestAt: "2026-10-12T09:00:00.000Z",
      listed: 0,
      normal: { usual: 34, low: 34, high: 34, checks: 3 },
      checksSince: 0,
      needsYou: false,
      jobsKept: 34,
      closing: 34,
      wording: {
        headline: "SumUp listed 0 jobs. It usually has 34.",
        kept: "Its 34 open jobs stay open: nothing closes on its own.",
        next: "If the next 2 checks are just as low, a Needs-you item asks you to confirm.",
        question: "Are SumUp's 34 jobs really gone?",
        close: "Close 34 SumUp jobs",
      },
    }]);
  });

  it("asks Kris to confirm only after two more empty Checks", async () => {
    const { engine, clock, b } = await sumupLearned();
    b.listing.sumup = [];
    const drop = async () => (await engine.sourceHealth()).summary.unusual[0]!;

    await clock.advance(halfHour);
    await engine.checkAll();
    await clock.advance(halfHour);
    await engine.checkAll();
    expect(await drop()).toMatchObject({ checksSince: 1, needsYou: false, wording: { next: "If the next check is just as low, a Needs-you item asks you to confirm." } });

    await clock.advance(halfHour);
    await engine.checkAll();
    expect(await drop()).toMatchObject({
      since: "2026-10-12T09:00:00.000Z", latestAt: "2026-10-12T10:00:00.000Z", checksSince: 2, needsYou: true,
      wording: { next: "SumUp has been this low for 3 checks in a row, so you're asked to confirm." },
    });
  });

  it("the Feed and Sources describe the drop in the same words", async () => {
    const { engine, clock, b } = await sumupLearned();
    b.listing.sumup = boardOf(5);
    await clock.advance(halfHour);
    await engine.checkAll();

    const feed = await engine.queryFeed({ view: "new" });
    const sources = await engine.sourceHealth();

    expect(feed.health).toEqual(sources.summary);
    expect(sources.sources[0]!.drop).toEqual(feed.health.unusual[0]);
    expect(feed.health.unusual[0]!.wording).toEqual({
      headline: "SumUp listed 5 jobs. It usually has 34.",
      kept: "Its 34 open jobs stay open: nothing closes on its own.",
      next: "If the next 2 checks are just as low, a Needs-you item asks you to confirm.",
      question: "Are SumUp's 29 jobs really gone?",
      close: "Close 29 SumUp jobs",
    });
  });

  it("a failed Check in between neither counts as empty nor ends the drop", async () => {
    const { engine, clock, b, deps } = await sumupLearned();
    b.listing.sumup = [];
    await clock.advance(halfHour);
    await engine.checkAll();
    const working = deps.fetch;
    deps.fetch = async () => new Response("Service Unavailable", { status: 503 });
    await clock.advance(halfHour);
    await engine.checkAll();
    deps.fetch = working;
    await clock.advance(halfHour);
    await engine.checkAll();

    const [source] = (await engine.sourceHealth()).sources;
    expect(source).toMatchObject({ status: "unusual", drop: { checksSince: 1, needsYou: false } });
  });

  it("is over when the count is back to normal, and nothing closed", async () => {
    const { engine, clock, b } = await sumupLearned();
    b.listing.sumup = [];
    await clock.advance(halfHour);
    await engine.checkAll();

    b.listing.sumup = boardOf(34);
    await clock.advance(halfHour);
    await engine.checkAll();
    const health = await engine.sourceHealth();

    expect(health.sources[0]).toMatchObject({ status: "working", drop: null });
    expect(health.summary).toMatchObject({ state: "working", unusual: [] });
    expect(await openTitles(engine)).toHaveLength(34);
  });
});

/** SumUp dropped to 0 and stayed there for two more Checks: Kris is asked. */
async function sumupAsking() {
  const t = await sumupLearned();
  t.b.listing.sumup = [];
  for (let i = 0; i < 3; i++) {
    await t.clock.advance(halfHour);
    await t.engine.checkAll();
  }
  return t;
}

describe("closing: confirming a drop", () => {
  it("closes the count it stated, each Job saying how, and the drop is over", async () => {
    const { engine, clock, source } = await sumupAsking();
    const asked = (await engine.queryFeed({ view: "new" })).health.unusual[0]!;

    const decision = await engine.confirmDrop(source.id);

    expect(asked.wording.close).toBe("Close 34 SumUp jobs");
    expect(decision).toMatchObject({ kind: "close" });
    expect(decision.jobIds).toHaveLength(34);
    const closed = (await engine.queryFeed({ view: "passed" })).jobs;
    expect(closed).toHaveLength(34);
    expect(closed.every((j) => j.closed?.how === "No longer listed by SumUp" && j.closed.decisionId === decision.id)).toBe(true);
    expect(await openTitles(engine)).toEqual([]);
    const health = await engine.sourceHealth();
    expect(health.sources[0]).toMatchObject({ status: "working", drop: null });
    expect(health.summary.unusual).toEqual([]);

    // The new level is learned afresh: another empty Check isn't a drop.
    await clock.advance(halfHour);
    await engine.checkAll();
    expect((await engine.sourceHealth()).sources[0]).toMatchObject({ status: "working", drop: null, normal: { usual: 0 } });
  });

  it("can be undone: every Job reopens and the drop asks again", async () => {
    const { engine, source } = await sumupAsking();
    const decision = await engine.confirmDrop(source.id);

    const undone = await engine.undo(decision.id);

    expect(undone.jobIds).toHaveLength(34);
    expect(await openTitles(engine)).toHaveLength(34);
    expect((await engine.sourceHealth()).summary.unusual).toEqual([expect.objectContaining({ sourceId: source.id, needsYou: true, closing: 34 })]);
  });

  it("refuses a Source that isn't in an unusual drop, and closes nothing", async () => {
    const { engine, source } = await sumupLearned();

    await expect(engine.confirmDrop(source.id)).rejects.toThrow("SumUp isn't in an unusual drop");
    expect(await openTitles(engine)).toHaveLength(34);
  });
});

describe("closing: a copy Kris pasted or captured", () => {
  const pasteEngineer1 = (engine: ReturnType<typeof createTestEngine>["engine"]) =>
    engine.addJobLink("https://www.linkedin.com/jobs/view/4200000001/", {
      title: "Engineer 1", company: "Payhawk", location: "Sofia", text: "Build payment systems.\n3+ years of Go.",
    });

  it("doesn't keep a dropped Job open: confirming closes exactly the count the drop stated", async () => {
    const t = await sumupLearned();
    expect(await pasteEngineer1(t.engine)).toMatchObject({ outcome: "merged" });
    t.b.listing.sumup = [];
    for (let i = 0; i < 3; i++) {
      await t.clock.advance(halfHour);
      await t.engine.checkAll();
    }
    const asked = (await t.engine.queryFeed({ view: "new" })).health.unusual[0]!;

    const decision = await t.engine.confirmDrop(asked.sourceId);

    expect(asked.closing).toBe(34);
    expect(decision.jobIds).toHaveLength(asked.closing);
  });

  it("still covers a Job when its Source is removed (removal isn't news about the job): preview and removal agree", async () => {
    const t = await sumupLearned();
    await pasteEngineer1(t.engine);

    const preview = await t.engine.previewRemoval(t.source.id);
    const removal = await t.engine.removeSource(t.source.id);

    expect(preview).toMatchObject({ openJobs: 34, closing: 33, stayingOpen: 1, stayingVia: [expect.objectContaining({ name: "Pasted links", jobs: 1 })] });
    expect(removal.decision.jobIds).toHaveLength(preview.closing);
  });

  it("a Posting another Source no longer lists doesn't keep a Job open on removal", async () => {
    const b = boards({ a: boardOf(1), b: boardOf(4) });
    const { engine, clock } = createTestEngine({ fetch: b.fetch });
    const a = await engine.addSource({ kind: "greenhouse", config: "a", name: "A" });
    await engine.addSource({ kind: "greenhouse", config: "b", name: "B" });
    await engine.checkAll();
    await engine.pauseSource(a.id);
    b.listing.b = boardOf(4).slice(1);
    await clock.advance(halfHour);
    await engine.checkAll();
    expect(await openTitles(engine)).toEqual(["Engineer 1", "Engineer 2", "Engineer 3", "Engineer 4"]);

    const preview = await engine.previewRemoval(a.id);

    expect(preview).toMatchObject({ openJobs: 1, closing: 1, stayingVia: [] });
  });
});

describe("closing: a closed Job lists again", () => {
  it("reopens when its Source lists it again", async () => {
    const b = boards({ payhawkio: recorded.jobs });
    const { engine, clock } = createTestEngine({ fetch: b.fetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawkio", name: "Payhawk" });
    await engine.checkAll();
    b.listing.payhawkio = recorded.jobs.filter((j) => j.title.trim() !== "Account Executive");
    await clock.advance(halfHour);
    await engine.checkAll();

    b.listing.payhawkio = recorded.jobs;
    await clock.advance(halfHour);
    await engine.checkAll();

    expect(await openTitles(engine)).toContain("Account Executive");
    expect((await engine.queryFeed({ view: "passed" })).jobs).toEqual([]);
  });

  it("stays closed when Kris closed it himself", async () => {
    const b = boards({ payhawkio: recorded.jobs });
    const { engine, clock } = createTestEngine({ fetch: b.fetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawkio", name: "Payhawk" });
    await engine.checkAll();
    const job = (await engine.queryFeed({ view: "new" })).jobs.find((j) => j.title === "Account Executive")!;
    await engine.close([job.id], "Closed by you");

    await clock.advance(halfHour);
    await engine.checkAll();

    expect((await engine.queryFeed({ view: "passed" })).jobs).toEqual([expect.objectContaining({ id: job.id, closed: expect.objectContaining({ how: "Closed by you" }) })]);
  });
});

describe("closing: a closed Job's page", () => {
  it("says how it closed and suggests similar open Jobs, best Fit first", async () => {
    const titles = ["Security Engineer", "Security Analyst", "SOC Analyst", "Product Manager", "Frontend Developer"];
    const board = boardOf(titles.length).map((j, i) => ({ ...j, title: titles[i]! }));
    const b = boards({ kestrel: board });
    const { engine, clock } = createTestEngine({ fetch: b.fetch });
    await engine.addSource({ kind: "greenhouse", config: "kestrel", name: "Kestrel" });
    await engine.checkAll();
    b.listing.kestrel = board.filter((j) => j.title !== "Security Engineer");
    await clock.advance(halfHour);
    await engine.checkAll();
    const closedId = (await engine.queryFeed({ view: "passed" })).jobs[0]!.id;

    const job = (await engine.getJob(closedId))!;

    expect(job).toMatchObject({
      state: "closed",
      closed: { at: "2026-10-12T08:00:00.000Z", how: "No longer listed by Kestrel", decisionId: expect.any(String) },
    });
    expect(job.similar.map((j) => j.title).sort()).toEqual(["SOC Analyst", "Security Analyst"]);
    expect(job.similar.every((j) => j.fit.angle === "security" && j.state === "new")).toBe(true);
    const fits = job.similar.map((j) => j.fit.value);
    expect(fits).toEqual([...fits].sort((a, b) => b - a));
  });

  it("an open Job has no closing and no suggestions", async () => {
    const b = boards({ payhawkio: recorded.jobs });
    const { engine } = createTestEngine({ fetch: b.fetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    await engine.checkAll();
    const [first] = (await engine.queryFeed({ view: "new" })).jobs;

    expect(await engine.getJob(first!.id)).toMatchObject({ closed: null, similar: [] });
  });

  it("reopening brings it back to All open", async () => {
    const b = boards({ payhawkio: recorded.jobs });
    const { engine, clock } = createTestEngine({ fetch: b.fetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    await engine.checkAll();
    b.listing.payhawkio = recorded.jobs.slice(1);
    await clock.advance(halfHour);
    await engine.checkAll();
    const [closed] = (await engine.queryFeed({ view: "passed" })).jobs;

    await engine.reopen([closed!.id]);

    expect(await engine.getJob(closed!.id)).toMatchObject({ state: "new", closed: null });
  });
});

describe("closing: Sources sharing an identity key", () => {
  // The old bug: SmartRecruiters "BoschGroup" and "BoschGroup:bg" shared one expiry key, so one
  // Source's check closed the other's postings. Here "Gameloft" and "Gameloft:bg" list the same
  // SmartRecruiters ids; each Source's Postings are its own.
  type Page = { totalFound: number; content: { name: string }[] };
  const recordedPage = JSON.parse(loadFixture("smartrecruiters.json")) as Page;
  function gameloft() {
    const listing = { all: recordedPage.content, bg: recordedPage.content };
    const http = routedFetch((r) => {
      if (!r.url.startsWith("https://api.smartrecruiters.com/v1/companies/Gameloft/postings?")) return undefined;
      const content = r.url.includes("country=bg") ? listing.bg : listing.all;
      return { json: { ...recordedPage, totalFound: content.length, content } };
    });
    return { listing, fetch: http.fetch };
  }
  const withoutVideoArtist = recordedPage.content.filter((p) => p.name !== "Video Artist");

  async function bothChecked() {
    const g = gameloft();
    const t = createTestEngine({ fetch: g.fetch });
    const all = await t.engine.addSource({ kind: "smartrecruiters", config: "Gameloft", name: "Gameloft" });
    const bg = await t.engine.addSource({ kind: "smartrecruiters", config: "Gameloft:bg", name: "Gameloft Bulgaria" });
    for (let i = 0; i < 3; i++) {
      if (i) await t.clock.advance(halfHour);
      await t.engine.checkAll();
    }
    return { ...t, g, all, bg };
  }

  it("one Source no longer listing a posting doesn't close the Job the other still lists", async () => {
    const { engine, clock, g } = await bothChecked();

    g.listing.bg = withoutVideoArtist;
    await clock.advance(halfHour);
    await engine.checkAll();

    expect(await openTitles(engine)).toEqual(["Game Producer", "Video Artist"]);
    const job = (await engine.queryFeed({ view: "open" })).jobs.find((j) => j.title === "Video Artist")!;
    expect(job.postingCount).toBe(2);
  });

  it("the Job closes only once neither lists it", async () => {
    const { engine, clock, g } = await bothChecked();

    g.listing.bg = withoutVideoArtist;
    await clock.advance(halfHour);
    await engine.checkAll();
    g.listing.all = withoutVideoArtist;
    await clock.advance(halfHour);
    await engine.checkAll();

    expect(await openTitles(engine)).toEqual(["Game Producer"]);
    expect((await engine.queryFeed({ view: "passed" })).jobs).toEqual([
      expect.objectContaining({ title: "Video Artist", closed: expect.objectContaining({ how: "No longer listed by Gameloft" }) }),
    ]);
  });

  it("confirming one Source's drop closes nothing the other still lists", async () => {
    const { engine, clock, g, all } = await bothChecked();

    g.listing.all = [];
    for (let i = 0; i < 3; i++) {
      await clock.advance(halfHour);
      await engine.checkAll();
    }
    const [drop] = (await engine.sourceHealth()).summary.unusual;
    const decision = await engine.confirmDrop(all.id);

    expect(drop).toMatchObject({ sourceId: all.id, jobsKept: 2, closing: 0, needsYou: true, wording: { close: "Close 0 Gameloft jobs" } });
    expect(decision.jobIds).toEqual([]);
    expect(await openTitles(engine)).toEqual(["Game Producer", "Video Artist"]);
  });
});

describe("closing: a capped search", () => {
  it("never closes a Job just because the search left it out of one Check", async () => {
    const answer = JSON.parse(loadFixture("jooble-security-bulgaria.json")) as { totalCount: number; jobs: { title: string }[] };
    let jobs = answer.jobs;
    const http = routedFetch((r) => (r.url.startsWith("https://jooble.org/api/") ? { json: { ...answer, totalCount: jobs.length, jobs } } : undefined));
    const { engine, clock } = createTestEngine({ fetch: http.fetch, settings: { get: (n) => (n === "JOOBLE_API_KEY" ? "test-jooble-key" : undefined) } });
    await engine.addSource({ kind: "jooble", config: "security|Bulgaria" });
    await engine.checkAll();

    jobs = answer.jobs.filter((j) => j.title !== "Penetration Tester");
    for (let i = 0; i < 4; i++) {
      await clock.advance(halfHour);
      await engine.checkAll();
    }

    expect(await openTitles(engine)).toEqual(["Penetration Tester", "Security Operations Analyst"]);
    expect((await engine.queryFeed({ view: "passed" })).jobs).toEqual([]);
  });
});
