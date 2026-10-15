// A sent copy BCC'd to the job mailbox (Track #32): mail from the user's own address to a contact of
// an Application marks its due follow-up sent "by email", and never one of a different Application.
// Fake clock, in-memory database, recorded synthetic emails (made-up people and companies), no live
// IMAP and no AI (the user's own mail is never sent to the assistant).
import { describe, expect, it } from "vitest";
import { createTracker, type MailMessage, type Tracker } from "../src/index.ts";
import { createTestEngine, fakeClock, fakeMailbox, loadFixture, mailMessage } from "./harness.ts";

type Recorded = { email: Parameters<typeof mailMessage>[0] };
const recorded = (JSON.parse(loadFixture("track-mail/emails.json")) as { emails: Record<string, Recorded> }).emails;
const email = (name: string): MailMessage => mailMessage(recorded[name]!.email);

function setup() {
  const clock = fakeClock("2026-10-12T07:30:00Z");
  const mailbox = fakeMailbox(clock);
  let tracker: Tracker | null = null;
  const t = createTestEngine({ clock, mailReader: mailbox, onMailStored: (emails) => tracker!.processMail(emails) });
  tracker = createTracker({
    db: t.deps.db, clock, discovery: t.engine, aiMonthlyCapUsd: 10,
    ownAddresses: ["sample.jobs@example.com", "alex.doe@example.com"],
  });
  const tr = tracker;
  const receive = async (at: string, ...names: string[]) => {
    for (const n of names) mailbox.deliver(email(n));
    clock.set(at);
    await t.engine.checkAll();
  };
  const add = async (company: string, title: string, contact: string, appliedOn = "2026-10-05") => {
    const r = await tr.addByHand({ job: { company, title }, appliedOn, status: "applied", contact });
    if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
    return r.application.id;
  };
  const followUp = async (id: string) => (await tr.get(id))!.followUp!;
  return { tracker: tr, clock, receive, add, followUp };
}

describe("a sent copy BCC'd to the job mailbox", () => {
  it("marks the due follow-up of the Application it was sent to as sent by email, and no other", async () => {
    const { tracker, receive, add, followUp } = setup();
    const northwind = await add("Northwind Labs", "Security Engineer", "mira.petrova@northwind-labs.example");
    const tidewater = await add("Tidewater Pay", "Application Security Engineer", "careers@tidewater.example");

    await receive("2026-10-13T08:30:00Z", "sent-nudge");

    expect(await followUp(northwind)).toMatchObject({ state: "sent", doneAt: "2026-10-13T08:30:00.000Z", doneBy: "email" });
    expect(await followUp(tidewater)).toMatchObject({ state: "pending" });
    const app = (await tracker.get(northwind))!;
    expect(app.timeline[0]).toMatchObject({ kind: "follow-up-sent", cause: "email", text: "Follow-up sent: apply-kit saw your sent copy", undoable: true });
    expect((await tracker.needsYou()).items.map((i) => `${i.application.company}:${i.done}`)).toEqual(["Northwind Labs:true", "Tidewater Pay:false"]);
  });

  it("can be undone: the follow-up is due again", async () => {
    const { tracker, receive, add, followUp } = setup();
    const northwind = await add("Northwind Labs", "Security Engineer", "mira.petrova@northwind-labs.example");
    await receive("2026-10-13T08:30:00Z", "sent-nudge");

    await tracker.undoEvent((await tracker.get(northwind))!.timeline[0]!.id);

    expect(await followUp(northwind)).toMatchObject({ state: "pending" });
  });

  it("with two Applications at one contact, marks only the one whose job it names; naming none marks neither", async () => {
    const { receive, add, followUp } = setup();
    const platform = await add("Nimbus Cloud", "Platform Engineer", "nimbus-cloud.example");
    const sre = await add("Nimbus Cloud", "Site Reliability Engineer", "nimbus-cloud.example");

    await receive("2026-10-13T08:30:00Z", "sent-nudge-unnamed");
    expect([(await followUp(platform)).state, (await followUp(sre)).state]).toEqual(["pending", "pending"]);

    await receive("2026-10-13T09:00:00Z", "sent-nudge-titled");
    expect([(await followUp(platform)).state, (await followUp(sre)).state]).toEqual(["sent", "pending"]);
  });

  it("to someone who isn't a contact of any Application, marks nothing", async () => {
    const { receive, add, followUp } = setup();
    const northwind = await add("Northwind Labs", "Security Engineer", "mira.petrova@northwind-labs.example");

    await receive("2026-10-13T08:30:00Z", "sent-to-a-friend");

    expect((await followUp(northwind)).state).toBe("pending");
  });

  it("sent before the follow-up came due isn't it (an email sent while applying, say): nothing is marked", async () => {
    const { receive, add, followUp } = setup();
    const northwind = await add("Northwind Labs", "Security Engineer", "mira.petrova@northwind-labs.example", "2026-10-10");

    await receive("2026-10-13T08:30:00Z", "sent-nudge");

    expect((await followUp(northwind)).state).toBe("pending");
  });
});
