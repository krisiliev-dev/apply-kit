// Applications at scale (Track #36), at the tracker's public interface: the list query with search,
// Status / angle / date filters, paging inside a group and counts that follow the filters, over 214
// seeded Applications; and the "Since your last visit" line. Fake clock (Mon 12 Oct 2026, 10:30 in
// Sofia), in-memory database, made-up companies only.
import { describe, expect, it, vi } from "vitest";
import { createTracker, type EmailClassification, type Status, type TrackAssistant, type Tracker as AnyTracker } from "../src/index.ts";
import { createTestEngine, fakeClock, fakeMailbox, loadFixture, mailMessage } from "./harness.ts";

function tracked() {
  const t = createTestEngine();
  const tracker = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine });
  return { ...t, tracker };
}
type Tracker = ReturnType<typeof tracked>["tracker"];

const firsts = ["Amber", "Birch", "Cobalt", "Delta", "Ember", "Fjord", "Garnet", "Harbor", "Indigo", "Juniper", "Kestrel", "Lumen", "Maple", "Nimbus", "Onyx"];
const seconds = ["Labs", "Works", "Systems", "Pay", "Health", "Cloud", "Logistics", "Studio", "Data", "Robotics", "Maps", "Media", "Energy", "Games", "Bank"];
const titles = ["Security Engineer", "Frontend Developer", "Product Designer", "Backend Engineer", "SOC Analyst", "UX Researcher"];

/**
 * 214 Applications, as the hi-fi's "214 applications" state: 47 Applied, 9 Screening, 4
 * Interviewing, 1 Offer (61 open) and 153 closed (140 Rejected, 13 Withdrawn), applied from 3 Jun
 * to 12 Oct. The i-th one is at a made-up company named from the lists above.
 */
async function seed214(tracker: Tracker) {
  const plan: [Exclude<Status, "accepted">, number][] = [
    ["applied", 47], ["screening", 9], ["interviewing", 4], ["offer", 1], ["rejected", 140], ["withdrawn", 13],
  ];
  const start = Date.UTC(2026, 5, 3);
  const end = Date.UTC(2026, 9, 12);
  let i = 0;
  for (const [status, n] of plan) {
    for (let k = 0; k < n; k++, i++) {
      // Spread evenly from 3 Jun to 12 Oct, interleaved across Statuses.
      const day = new Date(start + Math.round(((i * 37) % 214) * ((end - start) / 213))).toISOString().slice(0, 10);
      const company = `${firsts[i % firsts.length]} ${seconds[Math.floor(i / firsts.length) % seconds.length]}`;
      const r = await tracker.addByHand({ job: { company, title: titles[i % titles.length]! }, appliedOn: day, status });
      if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
    }
  }
}

describe("searching Applications", () => {
  it("finds them by job or company, and the counts follow the search", async () => {
    const { tracker } = tracked();
    await seed214(tracker);

    const list = await tracker.list({ search: "nimbus" });

    expect(list.total).toBe(214);
    expect(list.matching).toBe(14);
    const shown = list.groups.flatMap((g) => g.applications);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((a) => a.company.startsWith("Nimbus"))).toBe(true);
    expect(Object.values(list.counts).reduce((a, b) => a + b, 0)).toBe(14);
  });
});

describe("filtering by Status", () => {
  it("shows only the open groups, while each Status still counts what it would show", async () => {
    const { tracker } = tracked();
    await seed214(tracker);

    const list = await tracker.list({ status: "open" });

    expect(list.groups.map((g) => [g.key, g.count])).toEqual([["offer", 1], ["interviewing", 4], ["screening", 9], ["applied", 47]]);
    expect(list.matching).toBe(61);
    expect(list.counts).toEqual({ applied: 47, screening: 9, interviewing: 4, offer: 1, accepted: 0, rejected: 140, withdrawn: 13 });
  });

  it("shows one group, and its counts follow a search too", async () => {
    const { tracker } = tracked();
    await seed214(tracker);

    const list = await tracker.list({ status: "closed", search: "security engineer" });

    expect(list.groups.map((g) => g.key)).toEqual(["closed"]);
    expect(list.groups[0]!.applications.every((a) => a.title === "Security Engineer" && (a.status === "rejected" || a.status === "withdrawn"))).toBe(true);
    // Every 6th of the 214 is a Security Engineer: 36 in all.
    expect(Object.values(list.counts).reduce((a, b) => a + b, 0)).toBe(36);
  });
});

describe("filtering by date applied", () => {
  it("keeps those applied in the last 30 days, today included", async () => {
    const { tracker } = tracked();
    await tracker.addByHand({ job: { company: "Amber Labs", title: "SOC Analyst" }, appliedOn: "2026-09-13", status: "applied" });
    await tracker.addByHand({ job: { company: "Birch Works", title: "SOC Analyst" }, appliedOn: "2026-09-12", status: "applied" });
    await tracker.addByHand({ job: { company: "Cobalt Pay", title: "SOC Analyst" }, appliedOn: "2026-10-12", status: "rejected" });

    const list = await tracker.list({ appliedWithinDays: 30 });

    expect(list.groups.flatMap((g) => g.applications.map((a) => a.company))).toEqual(["Amber Labs", "Cobalt Pay"]);
    expect(list.counts).toMatchObject({ applied: 1, rejected: 1 });
  });
});

describe("searching contacts", () => {
  it("finds an Application by a contact's address", async () => {
    const { tracker } = tracked();
    await tracker.addByHand({ job: { company: "Harbor Health", title: "UX Researcher" }, appliedOn: "2026-10-01", status: "applied", contact: "mira.petrova@harbor-health.example" });
    await tracker.addByHand({ job: { company: "Indigo Data", title: "UX Researcher" }, appliedOn: "2026-10-01", status: "applied" });

    const list = await tracker.list({ search: "mira.petrova" });

    expect(list.groups.flatMap((g) => g.applications.map((a) => a.company))).toEqual(["Harbor Health"]);
  });
});

describe("paging inside a group", () => {
  it("pages Applied 25 at a time, soonest due first, while the other groups stay put", async () => {
    const { tracker } = tracked();
    await seed214(tracker);

    const first = await tracker.list({ status: "open", limits: { applied: 25 } });
    const second = await tracker.list({ status: "open", limits: { applied: 25 }, offsets: { applied: 25 } });

    const applied = (l: typeof first) => l.groups.find((g) => g.key === "applied")!;
    expect([applied(first).offset, applied(first).applications.length, applied(first).count]).toEqual([0, 25, 47]);
    expect([applied(second).offset, applied(second).applications.length, applied(second).count]).toEqual([25, 22, 47]);
    const days = [...applied(first).applications, ...applied(second).applications].map((a) => a.appliedOn);
    expect(days).toEqual([...days].sort());
    expect(new Set([...applied(first).applications, ...applied(second).applications].map((a) => a.id)).size).toBe(47);
    expect(second.groups.map((g) => [g.key, g.applications.length])).toEqual([["offer", 1], ["interviewing", 4], ["screening", 9], ["applied", 22]]);
  });

  it("with a page size, pages only the groups larger than a page; smaller ones keep their first five", async () => {
    const { tracker } = tracked();
    await seed214(tracker);

    const big = await tracker.list({ pageSize: 25, offsets: { closed: 25 } });

    expect(big.groups.map((g) => [g.key, g.offset, g.applications.length, g.count])).toEqual([
      ["offer", 0, 1, 1], ["interviewing", 0, 4, 4], ["screening", 0, 9, 9], ["applied", 0, 25, 47], ["closed", 25, 25, 153],
    ]);
    const few = await tracker.list({ pageSize: 25, search: "nimbus" });
    expect(few.groups.find((g) => g.key === "closed")).toMatchObject({ count: 10, applications: { length: 5 } });
  });

  it("an offset past the end shows the last page", async () => {
    const { tracker } = tracked();
    await seed214(tracker);

    const list = await tracker.list({ status: "applied", limits: { applied: 25 }, offsets: { applied: 50 } });

    expect(list.groups[0]).toMatchObject({ offset: 25, count: 47 });
    expect(list.groups[0]!.applications).toHaveLength(22);
  });
});

// ---------- with the job mailbox (recorded synthetic emails, a fake Track assistant) ----------

type Recorded = { email: Parameters<typeof mailMessage>[0]; classification: EmailClassification };
const recorded = (JSON.parse(loadFixture("track-mail/emails.json")) as { emails: Record<string, Recorded> }).emails;

/** Discover and Track on one database, the mailbox read once per check, Track matching what's new. */
function withMail() {
  const clock = fakeClock();
  const mailbox = fakeMailbox(clock);
  const byId = new Map(Object.values(recorded).map((r) => [r.email.id, r.classification]));
  const assistant: TrackAssistant = {
    estimateClassifyUsd: () => 0.0005,
    async classify(input) {
      const classification = byId.get(input.messageId);
      if (!classification) throw new Error(`no recorded classification for ${input.messageId}`);
      return { classification, costUsd: 0.0005, model: "fake/track-assistant" };
    },
    estimateDraftUsd: () => 0.002,
    draft: async () => { throw new Error("no drafts in these tests"); },
    estimatePrepSheetUsd: () => 0.0005,
    buildPrepSheet: async () => { throw new Error("no prep sheet in these tests"); },
  };
  let tracker: AnyTracker | null = null;
  const t = createTestEngine({ clock, mailReader: mailbox, aiMonthlyCapUsd: 10, onMailStored: (emails) => tracker!.processMail(emails) });
  tracker = createTracker({ db: t.deps.db, clock, discovery: t.engine, assistant, aiMonthlyCapUsd: 10 });
  const tr = tracker;
  const receive = async (at: string, ...names: string[]) => {
    for (const n of names) mailbox.deliver(mailMessage(recorded[n]!.email));
    clock.set(at);
    await t.engine.checkAll();
  };
  const add = async (company: string, title: string, contact?: string) => {
    const r = await tr.addByHand({ job: { company, title }, appliedOn: "2026-10-05", status: "applied", contact });
    if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
    return r.application.id;
  };
  return { ...t, clock, tracker: tr, receive, add };
}

describe("searching matched email text", () => {
  it("finds an Application by words in an email matched to it, Bulgarian too", async () => {
    const { tracker, add, receive } = withMail();
    const northwind = await add("Northwind Labs", "Security Engineer", "northwind-labs.example");
    const varna = await add("Varna Trust Bank", "Специалист информационна сигурност");
    await add("Kestrel Media", "Security Engineer");

    await receive("2026-10-14T10:00:00Z", "rejection", "bulgarian-call");

    const ids = async (search: string) => (await tracker.list({ search })).groups.flatMap((g) => g.applications.map((a) => a.id));
    expect(await ids("careful review")).toEqual([northwind]);
    expect(await ids("ТЕЛЕФОНЕН разговор")).toEqual([varna]);
  });
});

describe("Since your last visit", () => {
  it("says nothing on the first visit", async () => {
    const { tracker } = withMail();

    expect(await tracker.visit()).toEqual({ since: null, changes: [] });
  });

  it("lists the Status changes email made since the previous visit, each naming its Application", async () => {
    const { tracker, add, receive, clock } = withMail();
    const northwind = await add("Northwind Labs", "Security Engineer", "northwind-labs.example");
    const varna = await add("Varna Trust Bank", "Специалист информационна сигурност");
    const fennel = await add("Fennel Studio", "UX Engineer");
    await tracker.visit(); // Mon 12 Oct 07:30 UTC

    await receive("2026-10-13T06:00:00Z", "bulgarian-call");
    await receive("2026-10-14T10:00:00Z", "rejection");
    await tracker.setStatus(fennel, "screening"); // by you: not listed
    clock.set("2026-10-14T18:00:00Z");

    const seen = await tracker.visit();

    expect(seen.since).toBe("2026-10-12T07:30:00.000Z");
    expect(seen.changes).toEqual([
      expect.objectContaining({ applicationId: varna, company: "Varna Trust Bank", title: "Специалист информационна сигурност", from: "applied", to: "screening" }),
      expect.objectContaining({ applicationId: northwind, company: "Northwind Labs", from: "applied", to: "rejected" }),
    ]);
  });

  it("starts afresh on the next visit, but a page opened again within 30 minutes is the same visit", async () => {
    const { tracker, add, receive, clock } = withMail();
    await add("Northwind Labs", "Security Engineer", "northwind-labs.example");
    await tracker.visit();
    await receive("2026-10-14T10:00:00Z", "rejection");

    clock.set("2026-10-14T18:00:00Z");
    expect((await tracker.visit()).changes).toHaveLength(1);
    clock.set("2026-10-14T18:20:00Z");
    expect((await tracker.visit()).changes).toHaveLength(1);
    clock.set("2026-10-15T08:00:00Z");
    expect(await tracker.visit()).toEqual({ since: "2026-10-14T18:20:00.000Z", changes: [] });
  });

  it("leaves out a change that was undone, and email that changed nothing", async () => {
    const { tracker, add, receive, clock } = withMail();
    const northwind = await add("Northwind Labs", "Security Engineer", "northwind-labs.example");
    await add("Nimbus Cloud", "Platform Security Engineer");
    await tracker.visit();
    await receive("2026-10-12T08:00:00Z", "greenhouse-confirmation"); // filed: no Status change
    await receive("2026-10-13T10:00:00Z", "unsure-invitation"); // waits as Email to match
    await receive("2026-10-14T10:00:00Z", "rejection");
    await tracker.undoEvent((await tracker.get(northwind))!.movedByEmail!.eventId);
    clock.set("2026-10-14T18:00:00Z");

    expect((await tracker.visit()).changes).toEqual([]);
  });
});


it("reuses searchable mail between keystrokes and refreshes after a contact changes", async () => {
  const { tracker, deps } = tracked();
  const added = await tracker.addByHand({ job: { company: "Amber Labs", title: "Engineer" }, appliedOn: "2026-10-01", status: "applied" });
  if (added.outcome !== "added") throw new Error("not added");
  const prepare = deps.db.prepare.bind(deps.db);
  let mailReads = 0;
  vi.spyOn(deps.db, "prepare").mockImplementation((sql) => {
    if (sql.includes("m.text, m.html")) mailReads++;
    return prepare(sql);
  });
  await tracker.list({ search: "am" });
  await tracker.list({ search: "amber" });
  expect(mailReads).toBe(1);
  await tracker.addContact(added.application.id, "recruiter@birch.example");
  expect((await tracker.list({ search: "birch.example" })).matching).toBe(1);
  expect(mailReads).toBe(2);
});
