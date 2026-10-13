// Track's walking skeleton, at the tracker's public interface: add by hand, the grouped list,
// Status changes as Events and undo. Fake clock, in-memory database, no network.
import { describe, expect, it } from "vitest";
import { createTracker } from "../src/index.ts";
import { createTestEngine, fixtureFetch, loadFixture } from "./harness.ts";
import { routedFetch } from "./http.ts";

const payhawkBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";
const orbitlyJob = "https://careers.orbitly.example/jobs/4417-backend-engineer-go";

function tracked(overrides: Parameters<typeof createTestEngine>[0] = {}) {
  const t = createTestEngine(overrides);
  const tracker = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine });
  return { ...t, tracker };
}

/** A tracker beside a Feed holding Payhawk's three jobs (from a recorded Greenhouse board). */
async function withFeed() {
  const t = tracked({ fetch: fixtureFetch({ [payhawkBoard]: "greenhouse-payhawkio.json" }) });
  await t.engine.addSource({ kind: "greenhouse", config: "payhawkio" });
  await t.engine.checkAll();
  const jobs = (await t.engine.queryFeed({ view: "new" })).jobs;
  const byTitle = (title: string) => jobs.find((j) => j.title === title)!.id;
  return { ...t, apm: byTitle("Associate Product Manager"), support: byTitle("Customer Support Specialist"), ae: byTitle("Account Executive") };
}

const applied = (appliedOn = "2026-10-09") => ({ appliedOn, status: "applied" as const });

describe("adding an application by hand", () => {
  it("adds one made elsewhere (company and title) to the Applied group, logged by you", async () => {
    const { tracker } = tracked();

    const added = await tracker.addByHand({
      job: { company: "Fennel Studio", title: "UX Engineer" }, appliedOn: "2026-10-09", status: "applied",
    });

    expect(added).toMatchObject({ outcome: "added" });
    const list = await tracker.list();
    expect(list.total).toBe(1);
    expect(list.open).toBe(1);
    expect(list.groups.map((g) => [g.key, g.count])).toEqual([["applied", 1]]);
    expect(list.groups[0]!.applications[0]).toMatchObject({
      title: "UX Engineer", company: "Fennel Studio", status: "applied", appliedOn: "2026-10-09", jobId: null,
      source: "Added by hand",
      lastEvent: { text: "Added by hand", cause: "you" },
    });
  });
});

describe("adding an application for a Job in apply-kit", () => {
  it("takes the Job's title, company and Source, and \"I applied\" says so on its first Event", async () => {
    const { tracker, apm } = await withFeed();

    const added = await tracker.addByHand({ job: { jobId: apm }, ...applied(), how: "i-applied" });

    expect(added).toMatchObject({
      outcome: "added",
      application: {
        jobId: apm, title: "Associate Product Manager", company: "Payhawk", status: "applied", createdHow: "i-applied",
        source: "Greenhouse", lastEvent: { kind: "created", cause: "you", text: "Applied without apply-kit", to: "applied" },
      },
    });
  });

  it("can be a passed or closed Job, found by searching titles and companies", async () => {
    const { engine, tracker, ae } = await withFeed();
    await engine.pass([ae]);

    const found = await tracker.findJobs("account payhawk");
    expect(found).toEqual([expect.objectContaining({ id: ae, title: "Account Executive", state: "passed", application: null })]);

    await tracker.addByHand({ job: { jobId: ae }, ...applied() });
    expect((await tracker.findJobs("account"))[0]!.application).toMatchObject({ status: "applied" });
  });

  it("keeps at most one open Application per Job: a second says so and points at the first", async () => {
    const { tracker, apm } = await withFeed();
    const first = await tracker.addByHand({ job: { jobId: apm }, ...applied() });
    if (first.outcome !== "added") throw new Error("not added");

    const second = await tracker.addByHand({ job: { jobId: apm }, ...applied("2026-10-11") });

    expect(second).toMatchObject({ outcome: "already-open", application: { id: first.application.id } });
    if (second.outcome === "already-open") {
      expect(second.message).toBe("You already have an open Application for Associate Product Manager at Payhawk (Applied, applied 9 Oct 2026).");
    }
    expect((await tracker.list()).total).toBe(1);
  });

  it("allows applying again once the earlier Application is closed", async () => {
    const { tracker, apm } = await withFeed();
    const first = await tracker.addByHand({ job: { jobId: apm }, ...applied("2026-06-01") });
    if (first.outcome !== "added") throw new Error("not added");
    await tracker.setStatus(first.application.id, "rejected");

    const again = await tracker.addByHand({ job: { jobId: apm }, ...applied() });

    expect(again).toMatchObject({ outcome: "added" });
    expect((await tracker.list()).counts).toMatchObject({ applied: 1, rejected: 1 });
  });
});

describe("adding an application with a posting link", () => {
  it("reads the link like a pasted job, so the Application has a Job in the Feed", async () => {
    const http = routedFetch((r) => (r.url === orbitlyJob ? new Response(loadFixture("page-orbitly-backend.html"), { headers: { "content-type": "text/html" } }) : undefined));
    const { engine, tracker } = tracked({ fetch: http.fetch });

    const added = await tracker.addByHand({ job: { company: "Orbitly", title: "Backend Engineer", link: orbitlyJob }, ...applied() });

    if (added.outcome !== "added") throw new Error(`not added: ${added.outcome}`);
    expect(added.linkProblem).toBeNull();
    const job = await engine.getJob(added.application.jobId!);
    expect(job).toMatchObject({ title: "Backend Engineer (Go)", url: orbitlyJob });
    expect(added.application).toMatchObject({ company: "Orbitly", title: "Backend Engineer", postingUrl: orbitlyJob, source: "Pasted link" });

    // The same link again finds that Job, and its open Application.
    const again = await tracker.addByHand({ job: { company: "Orbitly", title: "Backend Engineer", link: orbitlyJob }, ...applied() });
    expect(again).toMatchObject({ outcome: "already-open", application: { id: added.application.id } });
    expect(http.requests.filter((r) => r.url === orbitlyJob)).toHaveLength(1);
  });

  it("still adds the Application when the link can't be read, keeping the link and saying why", async () => {
    const { tracker } = tracked();

    const added = await tracker.addByHand({
      job: { company: "Orbitly", title: "Backend Engineer", link: "https://www.linkedin.com/jobs/view/4012345678/" }, ...applied(),
    });

    if (added.outcome !== "added") throw new Error(`not added: ${added.outcome}`);
    expect(added.application).toMatchObject({ jobId: null, postingUrl: "https://www.linkedin.com/jobs/view/4012345678/" });
    expect(added.linkProblem).toContain("couldn't be read");
  });

  it("refuses text that isn't a link", async () => {
    const { tracker } = tracked();
    const added = await tracker.addByHand({ job: { company: "Orbitly", title: "Backend Engineer", link: "orbitly backend" }, ...applied() });
    expect(added).toMatchObject({ outcome: "invalid", field: "link" });
  });
});

describe("what Add application refuses", () => {
  it("names the field and what to do", async () => {
    const { tracker } = tracked();
    const job = { company: "Fennel Studio", title: "UX Engineer" };

    expect(await tracker.addByHand({ job: { company: " ", title: "UX Engineer" }, ...applied() }))
      .toEqual({ outcome: "invalid", field: "company", message: "Enter the company, so replies can be matched to it." });
    // The fake clock stands at 12 Oct 2026, 10:30 in Sofia.
    expect(await tracker.addByHand({ job, ...applied("2026-10-13") })).toMatchObject({ outcome: "invalid", field: "appliedOn" });
    expect(await tracker.addByHand({ job, appliedOn: "2026-10-01", status: "accepted" })).toMatchObject({ outcome: "invalid", field: "status" });
    expect(await tracker.addByHand({ job, ...applied(), contact: "not an address" })).toMatchObject({ outcome: "invalid", field: "contact" });
    expect((await tracker.list()).total).toBe(0);
  });

  it("accepts an address or a domain as the contact", async () => {
    const { tracker } = tracked();
    const job = { company: "Fennel Studio", title: "UX Engineer" };
    expect(await tracker.addByHand({ job, ...applied(), contact: "jobs@fennel.studio" })).toMatchObject({ outcome: "added" });
    expect(await tracker.addByHand({ job: { ...job, title: "UI Engineer" }, ...applied(), contact: "https://www.fennel.studio/careers" })).toMatchObject({ outcome: "added" });
  });
});

type Tracker = ReturnType<typeof tracked>["tracker"];

/** Adds an Application made elsewhere and returns its id. */
async function add(tracker: Tracker, title: string, appliedOn = "2026-10-09", status: "applied" | "screening" | "interviewing" | "offer" | "rejected" | "withdrawn" = "applied") {
  const r = await tracker.addByHand({ job: { company: "Fennel Studio", title }, appliedOn, status });
  if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
  return r.application.id;
}

describe("changing a Status by hand", () => {
  it("records an Event by you with the Status before and after, and the row moves group", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker, "UX Engineer");
    await clock.advance(60_000);

    const { application, event } = await tracker.setStatus(id, "screening");

    expect(event).toMatchObject({ kind: "status", cause: "you", from: "applied", to: "screening", text: "Moved to Screening", undoneAt: null });
    expect(application).toMatchObject({ status: "screening", lastEvent: { id: event.id } });
    expect((await tracker.list()).groups.map((g) => g.key)).toEqual(["screening"]);
  });

  it("undo restores the previous Status, keeping both Events: the change marked undone, and the reversal", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker, "UX Engineer");
    const { event } = await tracker.setStatus(id, "interviewing");
    await clock.advance(5_000);

    const undone = await tracker.undoEvent(event.id);

    expect(undone.application).toMatchObject({ status: "applied", lastEvent: { kind: "created", text: "Added by hand" } });
    expect(undone.event).toMatchObject({ kind: "undo", cause: "you", from: "interviewing", to: "applied", undoes: event.id, text: "Undone: back to Applied" });
    const events = await tracker.events(id);
    expect(events.map((e) => [e.kind, e.to, e.undoneAt !== null])).toEqual([
      ["created", "applied", false],
      ["status", "interviewing", true],
      ["undo", "applied", false],
    ]);
    await expect(tracker.undoEvent(event.id)).rejects.toMatchObject({ problem: "not-undoable" });
  });

  it("won't undo a change once the Status has moved again since", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, "UX Engineer");
    const first = await tracker.setStatus(id, "screening");
    await tracker.setStatus(id, "interviewing");

    await expect(tracker.undoEvent(first.event.id)).rejects.toMatchObject({ problem: "changed-since" });
    expect((await tracker.get(id))!.status).toBe("interviewing");
  });

  it("never sets Accepted silently: that is the accept flow's", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, "UX Engineer", "2026-09-01", "offer");

    await expect(tracker.setStatus(id, "accepted")).rejects.toMatchObject({ problem: "accepted" });
    expect((await tracker.get(id))!.status).toBe("offer");
    expect(await tracker.events(id)).toHaveLength(1);
  });

  it("won't reopen a closed Application while its Job has another open one", async () => {
    const { tracker, apm } = await withFeed();
    const old = await tracker.addByHand({ job: { jobId: apm }, appliedOn: "2026-06-01", status: "rejected" });
    await tracker.addByHand({ job: { jobId: apm }, ...applied() });
    if (old.outcome !== "added") throw new Error("not added");

    await expect(tracker.setStatus(old.application.id, "screening")).rejects.toMatchObject({ problem: "already-open" });
  });

  it("undoing an Application's adding takes it off the list", async () => {
    const { tracker } = tracked();
    const r = await tracker.addByHand({ job: { company: "Fennel Studio", title: "UX Engineer" }, ...applied() });
    if (r.outcome !== "added") throw new Error("not added");

    const undone = await tracker.undoEvent(r.event.id);

    expect(undone.application).toBeNull();
    expect((await tracker.list()).total).toBe(0);
    expect(await tracker.get(r.application.id)).toBeNull();
  });
});

describe("the grouped list", () => {
  it("groups by Status in order, Closed last and collapsed, with counts per Status", async () => {
    const { tracker } = tracked();
    await add(tracker, "A", "2026-10-01", "applied");
    await add(tracker, "S", "2026-09-20", "screening");
    await add(tracker, "I", "2026-09-10", "interviewing");
    await add(tracker, "O", "2026-09-01", "offer");
    await add(tracker, "R", "2026-08-17", "rejected");
    await add(tracker, "W", "2026-08-20", "withdrawn");

    const list = await tracker.list();

    expect(list.groups.map((g) => [g.label, g.count, g.open])).toEqual([
      ["Offer", 1, true], ["Interviewing", 1, true], ["Screening", 1, true], ["Applied", 1, true], ["Closed", 2, false],
    ]);
    expect(list).toMatchObject({ total: 6, open: 4, since: "2026-08-17", counts: { rejected: 1, withdrawn: 1, applied: 1 } });
  });

  it("shows the soonest-due five Applied first, and the rest when asked; Closed are kept, never dropped", async () => {
    const { tracker } = tracked();
    for (const [i, day] of ["05", "01", "07", "03", "02", "06", "04"].entries()) await add(tracker, `Job ${i}`, `2026-10-${day}`);
    for (let i = 0; i < 7; i++) await add(tracker, `Closed ${i}`, "2026-09-01", "rejected");

    const list = await tracker.list();
    const appliedGroup = list.groups.find((g) => g.key === "applied")!;
    expect(appliedGroup).toMatchObject({ count: 7, order: "soonest due first" });
    expect(appliedGroup.applications.map((a) => a.appliedOn)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(list.groups.find((g) => g.key === "closed")).toMatchObject({ count: 7, open: false });

    const more = await tracker.list({ limits: { applied: Infinity, closed: Infinity } });
    expect(more.groups.find((g) => g.key === "applied")!.applications).toHaveLength(7);
    expect(more.groups.find((g) => g.key === "closed")!.applications).toHaveLength(7);
  });
});

describe("job markers for the Feed and the Job page", () => {
  it("names this Job's Application: the date applied and its Status", async () => {
    const { tracker, apm, support } = await withFeed();
    const added = await tracker.addByHand({ job: { jobId: apm }, ...applied("2026-10-07") });
    if (added.outcome !== "added") throw new Error("not added");

    const markers = await tracker.jobMarkers([apm, support]);

    expect(markers[apm]!.application).toMatchObject({ id: added.application.id, appliedOn: "2026-10-07", status: "applied", onThisJob: true });
    expect(markers[support]!.application).toBeNull();
  });

  it("names another Application at the same company less than 6 months old, matching names as Discover does", async () => {
    const { tracker, clock, apm } = await withFeed();
    // The fake clock stands at 12 Oct 2026: 6 months back is 12 Apr.
    await tracker.addByHand({ job: { company: "PAYHAWK EOOD", title: "Data Analyst" }, ...applied("2026-04-13") });
    await tracker.addByHand({ job: { company: "Payhawk", title: "Finance Associate" }, ...applied("2026-04-12") });
    await tracker.addByHand({ job: { company: "Fennel Studio", title: "Product Manager" }, ...applied("2026-10-01") });

    expect((await tracker.jobMarkers([apm]))[apm]!.sameCompany).toMatchObject({ title: "Data Analyst", appliedOn: "2026-04-13", status: "applied", onThisJob: false });

    await clock.advance(24 * 60 * 60_000);
    expect((await tracker.jobMarkers([apm]))[apm]!.sameCompany).toBeNull();
  });

  it("says when a closed one closed, and History lists every Application at the company, this Job's too", async () => {
    const { tracker, clock, apm, support } = await withFeed();
    const old = await tracker.addByHand({ job: { company: "Payhawk", title: "Data Analyst" }, ...applied("2026-03-02") });
    const soc = await tracker.addByHand({ job: { company: "Payhawk", title: "SOC Analyst" }, ...applied("2026-10-01") });
    if (old.outcome !== "added" || soc.outcome !== "added") throw new Error("not added");
    await clock.advance(24 * 60 * 60_000);
    await tracker.setStatus(soc.application.id, "rejected");
    await tracker.addByHand({ job: { jobId: support }, ...applied("2026-09-20") });

    const marker = (await tracker.jobMarkers([apm]))[apm]!;

    expect(marker.sameCompany).toMatchObject({ title: "SOC Analyst", status: "rejected", closedOn: "2026-10-13" });
    expect(marker.history.map((m) => [m.title, m.status, m.onThisJob])).toEqual([
      ["SOC Analyst", "rejected", false], ["Customer Support Specialist", "applied", false], ["Data Analyst", "applied", false],
    ]);
    expect(marker.history[2]!.closedOn).toBeNull();

    const added = await tracker.addByHand({ job: { jobId: apm }, ...applied("2026-10-13") });
    if (added.outcome !== "added") throw new Error("not added");
    expect((await tracker.jobMarkers([apm]))[apm]!.history[0]).toMatchObject({ title: "Associate Product Manager", onThisJob: true });
  });
});
