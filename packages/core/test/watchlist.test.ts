// Pausing and removing Sources: pause stops checks and closes nothing; removal closes only the Jobs
// no other Source covers, says so beforehand, and can be undone.
import { describe, expect, it } from "vitest";
import { createTestEngine, loadFixture } from "./harness.ts";
import { routedFetch } from "./http.ts";

const board = (b: string) => `https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`;

/**
 * Two Greenhouse Sources. Payhawk lists three Postings; the mirror lists only the Associate Product
 * Manager, which merges into Payhawk's Job, so that Job is covered by both. Support is saved;
 * Account Executive is passed.
 */
async function twoSources() {
  const payhawkBoard = JSON.parse(loadFixture("greenhouse-payhawkio.json")) as { jobs: { title: string }[]; meta: unknown };
  const mirrorBoard = { ...payhawkBoard, jobs: payhawkBoard.jobs.filter((j) => j.title.trim() === "Associate Product Manager") };
  const http = routedFetch((req) =>
    req.url === board("payhawkio") ? { json: payhawkBoard } : req.url === board("payhawkmirror") ? { json: mirrorBoard } : undefined);
  const t = createTestEngine({ fetch: http.fetch });
  const payhawk = await t.engine.addSource({ kind: "greenhouse", config: "payhawkio", name: "Payhawk" });
  const mirror = await t.engine.addSource({ kind: "greenhouse", config: "payhawkmirror", name: "Payhawk mirror" });
  await t.engine.checkAll();
  const ids = await jobIds(t.engine);
  await t.engine.save([ids["payhawkio:Customer Support Specialist"]!]);
  await t.engine.pass([ids["payhawkio:Account Executive"]!], { reason: "skills-gap" });
  return { ...t, http, payhawk, mirror, ids };
}

async function jobIds(engine: Awaited<ReturnType<typeof createTestEngine>>["engine"]) {
  const out: Record<string, string> = {};
  for (const view of ["open", "passed"] as const) {
    for (const j of (await engine.queryFeed({ view })).jobs) out[`${j.id.split(":")[2]}:${j.title}`] = j.id;
  }
  return out;
}

describe("removing a Source", () => {
  it("previews exactly which open jobs close and which stay open through other Sources", async () => {
    const { engine, payhawk, mirror } = await twoSources();

    const preview = await engine.previewRemoval(payhawk.id);

    expect(preview).toEqual({
      sourceId: payhawk.id,
      name: "Payhawk",
      label: "Greenhouse",
      openJobs: 2,
      closing: 1,
      stayingOpen: 1,
      stayingVia: [{ sourceId: mirror.id, name: "Payhawk mirror", jobs: 1 }],
    });
  });

  it("closes only the jobs no other Source covers, with the reason \"Source removed\", and stops checking it", async () => {
    const { engine, http, payhawk, ids } = await twoSources();

    const removal = await engine.removeSource(payhawk.id);

    const support = ids["payhawkio:Customer Support Specialist"]!;
    expect(removal.decision.jobIds).toEqual([support]);
    const passed = await engine.queryFeed({ view: "passed" });
    expect(passed.jobs.find((j) => j.id === support)).toMatchObject({ state: "closed", closed: { how: "Source removed" } });
    expect(passed.jobs.find((j) => j.id === ids["payhawkio:Account Executive"])).toMatchObject({ state: "passed", passed: { reason: "skills-gap" } });
    expect((await engine.queryFeed({ view: "open" })).jobs.map((j) => j.id)).toContain(ids["payhawkio:Associate Product Manager"]);
    expect((await engine.sourceHealth()).sources.map((s) => s.id)).toEqual(["greenhouse:payhawkmirror"]);

    http.requests.length = 0;
    await engine.checkAll();
    expect(http.requests.map((r) => r.url)).toEqual([board("payhawkmirror")]);
  });

  it("undo puts the Source back and reopens exactly the jobs the removal closed", async () => {
    const { engine, payhawk, ids } = await twoSources();
    const removal = await engine.removeSource(payhawk.id);

    const undone = await engine.undo(removal.decision.id);

    expect(undone).toEqual({ jobIds: [ids["payhawkio:Customer Support Specialist"]], sourceIds: [payhawk.id] });
    expect((await engine.queryFeed({ view: "saved" })).jobs.map((j) => j.title)).toEqual(["Customer Support Specialist"]);
    expect((await engine.sourceHealth()).sources.map((s) => s.id)).toEqual([payhawk.id, "greenhouse:payhawkmirror"]);
  });
  it("undoing a removal that closed nothing still brings the Source back", async () => {
    const { engine, mirror } = await twoSources();
    const removal = await engine.removeSource(mirror.id);
    expect(removal.decision.jobIds).toEqual([]);

    expect(await engine.undo(removal.decision.id)).toEqual({ jobIds: [], sourceIds: [mirror.id] });
    expect((await engine.sourceHealth()).sources.map((s) => s.id)).toContain(mirror.id);
  });

  it("leaves its postings off the Job page of a Job another Source keeps open, and they can't be its target", async () => {
    const { engine, payhawk, mirror, ids } = await twoSources();
    const apm = ids["payhawkio:Associate Product Manager"]!;
    const before = (await engine.getJob(apm))!;
    const payhawkPosting = before.postings.find((p) => p.source.id === payhawk.id)!;
    expect(before.postings).toHaveLength(2);

    await engine.removeSource(payhawk.id);
    const after = (await engine.getJob(apm))!;

    expect(after.postings.map((p) => p.source.id)).toEqual([mirror.id]);
    expect(after).toMatchObject({ postingCount: 1, siteCount: 1, target: { postingId: after.postings[0]!.id } });
    expect((await engine.queryFeed({ view: "open" })).jobs.find((j) => j.id === apm)).toMatchObject({ postingCount: 1 });
    await expect(engine.setTarget(apm, payhawkPosting.id)).rejects.toThrow(/isn't part of job/);
  });

  it("a Job its removal closed still shows the postings it had", async () => {
    const { engine, payhawk, ids } = await twoSources();
    const support = ids["payhawkio:Customer Support Specialist"]!;

    await engine.removeSource(payhawk.id);

    expect((await engine.getJob(support))!).toMatchObject({ state: "closed", postingCount: 1, title: "Customer Support Specialist" });
  });

  it("refuses to preview or remove a Source that isn't on the watchlist", async () => {
    const { engine, payhawk } = await twoSources();
    await engine.removeSource(payhawk.id);

    await expect(engine.previewRemoval(payhawk.id)).rejects.toThrow(/No source/);
    await expect(engine.removeSource(payhawk.id)).rejects.toThrow(/No source/);
  });
});

describe("pausing a Source", () => {
  it("stops checking it and closes nothing; resuming checks it again", async () => {
    const { engine, http, payhawk } = await twoSources();
    const before = await engine.queryFeed({ view: "open" });

    await engine.pauseSource(payhawk.id);
    http.requests.length = 0;
    await engine.checkAll();

    expect(http.requests.map((r) => r.url)).toEqual([board("payhawkmirror")]);
    expect((await engine.queryFeed({ view: "open" })).jobs).toEqual(before.jobs);
    expect((await engine.sourceHealth()).sources.find((s) => s.id === payhawk.id)).toMatchObject({ status: "paused", jobsKept: 2 });

    await engine.resumeSource(payhawk.id);
    http.requests.length = 0;
    await engine.checkAll();
    expect(http.requests.map((r) => r.url).sort()).toEqual([board("payhawkio"), board("payhawkmirror")]);
  });
});

describe("Sources from settings", () => {
  it("adds a settings Source only the first time, so one paused or removed in the app stays that way", async () => {
    const { engine, payhawk, mirror } = await twoSources();
    await engine.removeSource(payhawk.id);
    await engine.pauseSource(mirror.id);

    await engine.addSource({ kind: "greenhouse", config: "payhawkio" }, { onlyIfNew: true });
    await engine.addSource({ kind: "greenhouse", config: "payhawkmirror" }, { onlyIfNew: true });

    expect((await engine.sourceHealth()).sources.map((s) => [s.id, s.status])).toEqual([["greenhouse:payhawkmirror", "paused"]]);
  });

  it("adding a removed Source again from the app brings it back", async () => {
    const { engine, payhawk } = await twoSources();
    await engine.removeSource(payhawk.id);

    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });

    expect((await engine.sourceHealth()).sources.map((s) => s.id)).toContain(payhawk.id);
  });

  it("adding a removed Source back reopens the jobs its removal closed, as undoing it would", async () => {
    const { engine, payhawk } = await twoSources();
    await engine.removeSource(payhawk.id);

    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });

    expect((await engine.queryFeed({ view: "saved" })).jobs.map((j) => j.title)).toEqual(["Customer Support Specialist"]);
    expect((await engine.queryFeed({ view: "passed" })).jobs.map((j) => j.title)).toEqual(["Account Executive"]);
  });

  it("adding a removed Source back leaves a job Kris decided on since as it was left", async () => {
    const { engine, payhawk, ids } = await twoSources();
    await engine.removeSource(payhawk.id);
    const support = ids["payhawkio:Customer Support Specialist"]!;
    await engine.reopen([support]);
    await engine.pass([support], { reason: "salary" });

    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });

    expect((await engine.queryFeed({ view: "passed" })).jobs.find((j) => j.id === support)).toMatchObject({ state: "passed" });
  });
});
