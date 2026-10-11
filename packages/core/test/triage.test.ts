import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch } from "./harness.ts";

const payhawkBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";

/** An engine whose Feed holds Payhawk's three jobs, newest first: APM, Support, Account Executive. */
async function feedWithJobs() {
  const t = createTestEngine({ fetch: fixtureFetch({ [payhawkBoard]: "greenhouse-payhawkio.json" }) });
  await t.engine.addSource({ kind: "greenhouse", config: "payhawkio" });
  await t.engine.checkAll();
  const jobs = (await t.engine.queryFeed({ view: "new" })).jobs;
  const [apm, support, ae] = jobs.map((j) => j.id) as [string, string, string];
  return { ...t, apm, support, ae };
}

const titles = (feed: { jobs: { title: string }[] }) => feed.jobs.map((j) => j.title);

describe("triage: save", () => {
  it("saving a job moves it from New to Saved, and it stays in All open", async () => {
    const { engine, apm } = await feedWithJobs();

    await engine.save([apm]);

    expect(titles(await engine.queryFeed({ view: "new" }))).toEqual(["Customer Support Specialist", "Account Executive"]);
    expect(titles(await engine.queryFeed({ view: "saved" }))).toEqual(["Associate Product Manager"]);
    const open = await engine.queryFeed({ view: "open" });
    expect(titles(open)).toEqual(["Associate Product Manager", "Customer Support Specialist", "Account Executive"]);
    expect(open.counts).toMatchObject({ new: 2, saved: 1, open: 3, passed: 0 });
  });
});

describe("triage: bulk", () => {
  it("saving several jobs at once saves the open ones, skips the rest, and one undo reverts them together", async () => {
    const { engine, apm, support, ae } = await feedWithJobs();
    await engine.pass([ae]);

    const save = await engine.save([apm, support, ae]);

    expect(save.jobIds).toEqual([apm, support]);
    expect((await engine.queryFeed({ view: "saved" })).counts).toMatchObject({ new: 0, saved: 2, passed: 1 });
    await engine.undo(save.id);
    expect((await engine.queryFeed({ view: "new" })).counts).toMatchObject({ new: 2, saved: 0, passed: 1 });
  });
});

describe("triage: pass with a reason", () => {
  it("a passed job leaves the open views and is listed under Passed & closed with the reason and note Kris gave", async () => {
    const { engine, clock, apm } = await feedWithJobs();
    clock.advance(60_000);

    await engine.pass([apm], { reason: "salary", note: "€2,000–2,300" });

    expect(titles(await engine.queryFeed({ view: "open" }))).toEqual(["Customer Support Specialist", "Account Executive"]);
    const passed = await engine.queryFeed({ view: "passed" });
    expect(passed.counts).toMatchObject({ new: 2, open: 2, passed: 1 });
    expect(passed.jobs).toEqual([
      expect.objectContaining({
        title: "Associate Product Manager",
        state: "passed",
        passed: { at: "2026-10-12T07:31:00.000Z", reason: "salary", note: "€2,000–2,300", decisionId: expect.any(String) },
      }),
    ]);
  });

  it("no reason is chosen for Kris: passing without one records no reason", async () => {
    const { engine, apm } = await feedWithJobs();

    await engine.pass([apm]);

    const [job] = (await engine.queryFeed({ view: "passed" })).jobs;
    expect(job?.passed).toMatchObject({ reason: null, note: null });
  });

  it("refuses a reason it doesn't know, and changes nothing", async () => {
    const { engine, apm } = await feedWithJobs();

    await expect(engine.pass([apm], { reason: "bored" as never })).rejects.toThrow(/reason/i);

    expect((await engine.queryFeed({ view: "new" })).counts.new).toBe(3);
  });
});

describe("triage: undo", () => {
  it("undoing a pass puts the job back where it was, and its reason is forgotten", async () => {
    const { engine, apm } = await feedWithJobs();
    await engine.save([apm]);
    const pass = await engine.pass([apm], { reason: "company" });

    await engine.undo(pass.id);

    const saved = await engine.queryFeed({ view: "saved" });
    expect(saved.jobs).toEqual([expect.objectContaining({ title: "Associate Product Manager", state: "saved" })]);
    expect(saved.jobs[0]?.passed).toBeUndefined();
    expect(saved.counts).toMatchObject({ new: 2, saved: 1, passed: 0 });
  });

  it("undo still works well after the 10-second toast is gone", async () => {
    const { engine, clock, apm } = await feedWithJobs();
    const pass = await engine.pass([apm]);
    clock.advance(3 * 24 * 60 * 60_000);

    await engine.undo(pass.id);

    expect((await engine.queryFeed({ view: "new" })).counts.new).toBe(3);
  });

  it("undoing a bulk pass for one job, from Passed & closed, brings back only that job", async () => {
    const { engine, apm, support } = await feedWithJobs();
    const pass = await engine.pass([apm, support], { reason: "location" });
    expect(pass.jobIds).toEqual([apm, support]);

    await engine.undo(pass.id, [support]);

    expect(titles(await engine.queryFeed({ view: "new" }))).toEqual(["Customer Support Specialist", "Account Executive"]);
    expect(titles(await engine.queryFeed({ view: "passed" }))).toEqual(["Associate Product Manager"]);
  });

  it("undoing an older decision never overrides what Kris did to the job since", async () => {
    const { engine, apm } = await feedWithJobs();
    const save = await engine.save([apm]);
    await engine.pass([apm]);

    await engine.undo(save.id);

    expect(titles(await engine.queryFeed({ view: "passed" }))).toEqual(["Associate Product Manager"]);
  });

  it("undoing twice changes nothing the second time", async () => {
    const { engine, apm } = await feedWithJobs();
    const save = await engine.save([apm]);
    await engine.undo(save.id);
    await engine.save([apm]);

    await engine.undo(save.id);

    expect(titles(await engine.queryFeed({ view: "saved" }))).toEqual(["Associate Product Manager"]);
  });
});

describe("triage: closed jobs", () => {
  it("a closed job is listed under Passed & closed with how it closed, and reopening brings it back to All open", async () => {
    const { engine, clock, apm, support } = await feedWithJobs();
    await engine.pass([support], { reason: "skills-gap" });
    clock.advance(60_000);
    await engine.close([apm], "You closed it: it's not open any more");

    const pc = await engine.queryFeed({ view: "passed" });
    expect(pc.counts).toMatchObject({ open: 1, passed: 2 });
    expect(pc.jobs).toEqual([
      expect.objectContaining({
        title: "Associate Product Manager",
        state: "closed",
        closed: { at: "2026-10-12T07:31:00.000Z", how: "You closed it: it's not open any more", decisionId: expect.any(String) },
      }),
      expect.objectContaining({ title: "Customer Support Specialist", state: "passed" }),
    ]);

    const reopen = await engine.reopen([apm]);

    expect(reopen.jobIds).toEqual([apm]);
    expect(titles(await engine.queryFeed({ view: "open" }))).toEqual(["Associate Product Manager", "Account Executive"]);
    expect(titles(await engine.queryFeed({ view: "passed" }))).toEqual(["Customer Support Specialist"]);
  });

  it("reopen applies only to closed jobs, and can itself be undone", async () => {
    const { engine, apm, support } = await feedWithJobs();
    await engine.close([apm], "No longer listed by Greenhouse");

    const reopen = await engine.reopen([apm, support]);
    expect(reopen.jobIds).toEqual([apm]);
    await engine.undo(reopen.id);

    const [job] = (await engine.queryFeed({ view: "passed" })).jobs;
    expect(job?.closed?.how).toBe("No longer listed by Greenhouse");
  });
});
