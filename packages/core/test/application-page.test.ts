// One Application, as its page shows it, at the tracker's public interface: the status stepper
// derived from Events, the next step, the timeline with each Event's cause, notes, contacts, the
// target posting (and its closing, from Discover) and the CV attached to one added by hand.
// Fake clock, in-memory database, no network.
import { describe, expect, it } from "vitest";
import { createTracker, type Status } from "../src/index.ts";
import { createTestEngine, loadFixture } from "./harness.ts";
import { routedFetch } from "./http.ts";

function tracked(overrides: Parameters<typeof createTestEngine>[0] = {}) {
  const t = createTestEngine(overrides);
  const tracker = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine });
  return { ...t, tracker };
}

type Tracker = ReturnType<typeof tracked>["tracker"];

/** Adds an Application made elsewhere (Fennel Studio) and returns its id. */
async function add(tracker: Tracker, status: Exclude<Status, "accepted"> = "applied", contact?: string) {
  const r = await tracker.addByHand({ job: { company: "Fennel Studio", title: "UX Engineer" }, appliedOn: "2026-10-09", status, contact });
  if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
  return r.application.id;
}

const stepStates = async (tracker: Tracker, id: string) =>
  (await tracker.get(id))!.steps.map((s) => `${s.status}:${s.state}`);

describe("the status stepper", () => {
  it("marks steps done, current and still to come for a fresh Application", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);

    expect(await stepStates(tracker, id)).toEqual(["applied:current", "screening:todo", "interviewing:todo", "offer:todo", "accepted:todo"]);
  });

  it("marks Screening skipped when it went Applied → Interviewing", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);

    await tracker.setStatus(id, "interviewing");

    expect(await stepStates(tracker, id)).toEqual(["applied:done", "screening:skipped", "interviewing:current", "offer:todo", "accepted:todo"]);
  });

  it("keeps what happened before a rejection, and forgets an undone change", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    const slip = await tracker.setStatus(id, "offer");
    await tracker.undoEvent(slip.event.id);
    await tracker.setStatus(id, "interviewing");
    await tracker.setStatus(id, "rejected");

    expect(await stepStates(tracker, id)).toEqual(["applied:done", "screening:skipped", "interviewing:done", "offer:todo", "accepted:todo"]);
  });
});

describe("notes and the next step", () => {
  it("says to wait for a reply until there's a note", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);

    expect((await tracker.get(id))!.nextStep).toEqual({ kind: "wait", text: "Wait for a reply." });
  });

  it("adds a note to the timeline, by you, newest first, and the latest note becomes the next step", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await clock.advance(60_000);
    await tracker.addNote(id, "  Recruiter called: second round next week.  ");
    await clock.advance(60_000);

    const { event } = await tracker.addNote(id, "Ask about the on-call rota.");

    expect(event).toMatchObject({ kind: "note", cause: "you", text: "Ask about the on-call rota." });
    const app = (await tracker.get(id))!;
    expect(app.timeline.map((e) => [e.kind, e.cause, e.text])).toEqual([
      ["note", "you", "Ask about the on-call rota."],
      ["note", "you", "Recruiter called: second round next week."],
      ["created", "you", "Added by hand"],
    ]);
    expect(app.nextStep).toEqual({ kind: "note", text: "Ask about the on-call rota.", at: event.at });
    expect(app.status).toBe("applied");
  });

  it("says a closed one has nothing left to do, and since when it has its Status", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await clock.advance(3 * 24 * 3600_000);
    await tracker.setStatus(id, "rejected");

    expect((await tracker.get(id))!).toMatchObject({
      statusSince: clock.now().toISOString(),
      nextStep: { kind: "closed", text: "Nothing to do: it's rejected. It stays here for your records." },
    });
  });

  it("refuses an empty note", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);

    await expect(tracker.addNote(id, "   ")).rejects.toMatchObject({ problem: "invalid" });
  });

  it("lets a Status change be undone after a note was added since", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    const { event } = await tracker.setStatus(id, "screening");
    await tracker.addNote(id, "They want a portfolio link.");

    const app = (await tracker.get(id))!;
    expect(app.timeline.find((e) => e.id === event.id)).toMatchObject({ undoable: true });
    await tracker.undoEvent(event.id);
    expect((await tracker.get(id))!.status).toBe("applied");
  });
});

describe("contacts", () => {
  it("lists the domain given when adding, and an address added later, whose mail is matched here", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, "applied", "fennel.studio");

    const { contacts } = await tracker.addContact(id, " Mira.Petrova@Example.com ");

    expect(contacts).toEqual([
      { value: "fennel.studio", kind: "domain" },
      { value: "mira.petrova@example.com", kind: "address" },
    ]);
    expect((await tracker.get(id))!.contacts).toEqual(contacts);
  });

  it("refuses something that is neither an address nor a domain, and one already there", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, "applied", "fennel.studio");

    await expect(tracker.addContact(id, "Mira from Fennel")).rejects.toMatchObject({ problem: "invalid" });
    await expect(tracker.addContact(id, "https://www.fennel.studio/careers")).rejects.toMatchObject({ problem: "unchanged" });
    expect((await tracker.get(id))!.contacts).toHaveLength(1);
  });
});

const payhawkBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";
type GreenhouseJob = { title: string; absolute_url: string };
const recorded = JSON.parse(loadFixture("greenhouse-payhawkio.json")) as { jobs: GreenhouseJob[] };

/** A tracker beside a Feed holding Payhawk's recorded Greenhouse board, which the test can change. */
async function withBoard() {
  let listing = recorded.jobs;
  const http = routedFetch((r) => (r.url === payhawkBoard ? { json: { jobs: listing, meta: { total: listing.length } } } : undefined));
  const t = tracked({ fetch: http.fetch });
  await t.engine.addSource({ kind: "greenhouse", config: "payhawkio", name: "Payhawk" });
  await t.engine.checkAll();
  const apm = (await t.engine.queryFeed({ view: "new" })).jobs.find((j) => j.title === "Associate Product Manager")!;
  return { ...t, apm, unlist: (title: string) => { listing = listing.filter((j) => j.title.trim() !== title); } };
}

describe("the target posting", () => {
  it("links the Job and its posting", async () => {
    const { tracker, apm } = await withBoard();
    const r = await tracker.addByHand({ job: { jobId: apm.id }, appliedOn: "2026-10-09", status: "applied", how: "i-applied" });
    if (r.outcome !== "added") throw new Error("not added");

    expect((await tracker.get(r.application.id))!.posting).toEqual({
      jobId: apm.id, title: "Associate Product Manager", company: "Payhawk", url: apm.url, closed: null,
    });
  });

  it("shows a closed posting on the timeline as a neutral fact by apply-kit, not as a Status change", async () => {
    const { tracker, apm, unlist, engine, clock } = await withBoard();
    const r = await tracker.addByHand({ job: { jobId: apm.id }, appliedOn: "2026-10-09", status: "applied", how: "i-applied" });
    if (r.outcome !== "added") throw new Error("not added");

    unlist("Associate Product Manager");
    await clock.advance(30 * 60_000);
    await engine.checkAll();

    const app = (await tracker.get(r.application.id))!;
    expect(app.status).toBe("applied");
    expect(app.posting?.closed).toEqual({ at: clock.now().toISOString(), how: "No longer listed by Payhawk" });
    expect(app.timeline[0]).toMatchObject({
      kind: "posting-closed", cause: "apply-kit", at: clock.now().toISOString(), text: "Posting closed", undoable: false,
      detail: "No longer listed by Payhawk. That's normal once a job stops taking applications, and says nothing about you. The saved copy stays on the Job page.",
    });
  });

  it("keeps the link of one added by hand whose posting couldn't be read", async () => {
    const { tracker } = tracked();
    const link = "https://www.linkedin.com/jobs/view/4012345678/";
    const r = await tracker.addByHand({ job: { company: "Orbitly", title: "Backend Engineer", link }, appliedOn: "2026-10-09", status: "applied" });
    if (r.outcome !== "added") throw new Error("not added");

    expect((await tracker.get(r.application.id))!.posting).toEqual({ jobId: null, title: "Backend Engineer", company: "Orbitly", url: link, closed: null });
    expect((await tracker.get(await add(tracker)))!.posting).toBeNull();
  });
});

/** A tiny made-up PDF (only its first bytes matter here). */
const pdf = (text = "Mira Petrova CV") => new TextEncoder().encode(`%PDF-1.7\n% ${text}\n%%EOF\n`);

describe("what you sent, for one added by hand", () => {
  it("stores the attached CV and uses its label as the CV version", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    expect((await tracker.get(id))!).toMatchObject({ cv: null, cvVersion: null });

    const { event } = await tracker.attachCv(id, { fileName: "cv-design-2026.pdf", label: " Design v2 ", bytes: pdf() });

    const app = (await tracker.get(id))!;
    expect(app).toMatchObject({ cvVersion: "Design v2", cv: { label: "Design v2", fileName: "cv-design-2026.pdf", bytes: pdf().length } });
    expect(event).toMatchObject({ kind: "cv", cause: "you", text: "CV attached: Design v2" });
    expect(app.timeline[0]).toMatchObject({ kind: "cv", text: "CV attached: Design v2" });
    const file = await tracker.cvFile(id);
    expect(file?.fileName).toBe("cv-design-2026.pdf");
    expect(new TextDecoder().decode(file!.bytes)).toContain("Mira Petrova CV");
  });

  it("names the version after the file when no label is given, and a new CV replaces the old", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    await tracker.attachCv(id, { fileName: "first.pdf", label: "", bytes: pdf("first") });

    await tracker.attachCv(id, { fileName: "Security CV v3.pdf", label: null, bytes: pdf("second") });

    expect((await tracker.get(id))!.cvVersion).toBe("Security CV v3");
    expect(new TextDecoder().decode((await tracker.cvFile(id))!.bytes)).toContain("second");
  });

  it("takes PDFs only", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);

    await expect(tracker.attachCv(id, { fileName: "cv.docx", label: "Design", bytes: new TextEncoder().encode("PK\u0003\u0004") }))
      .rejects.toMatchObject({ problem: "invalid", message: "That file isn't a PDF. Export your CV as PDF and attach that." });
    expect(await tracker.cvFile(id)).toBeNull();
  });
});
