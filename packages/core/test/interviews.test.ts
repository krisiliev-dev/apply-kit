// Interviews, thank-you notes, check-ins and the prep sheet (Track #33), at the tracker's public
// interface. Fake clock (starts Mon 12 Oct 2026, 10:30 in Sofia), in-memory database, a fake Track
// assistant answering with recorded outputs and a fake Master profile. Made-up people and companies.
import { describe, expect, it } from "vitest";
import {
  createTracker, type EmailClassification, type MasterProfile, type PrepSheetDraft, type PrepSheetInput, type ProfileStory, type Status,
  type TrackAssistant, type Tracker as TrackerApi,
} from "../src/index.ts";
import { createTestEngine, fakeClock, fakeMailbox, loadFixture, mailMessage } from "./harness.ts";

const day = 24 * 60 * 60 * 1000;

function tracked() {
  const t = createTestEngine();
  const tracker = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine });
  return { ...t, tracker };
}
type Tracker = ReturnType<typeof tracked>["tracker"];

async function add(
  tracker: Tracker,
  { company = "Medora", title = "Full-stack Engineer", appliedOn = "2026-09-28", status = "interviewing", contact }:
  { company?: string; title?: string; appliedOn?: string; status?: Exclude<Status, "accepted">; contact?: string } = {},
) {
  const r = await tracker.addByHand({ job: { company, title }, appliedOn, status, contact });
  if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
  return r.application.id;
}

const due = async (tracker: Tracker) =>
  (await tracker.needsYou()).items.filter((i) => !i.done).map((i) => `${i.application.company}:${i.followUp.kind}:${i.followUp.dueAt ?? i.followUp.dueOn}`);

describe("a thank-you note after an interview", () => {
  it("is ready when the interview ends and due exactly 24 hours after its start", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, {
      start: "2026-10-14T14:00", end: "2026-10-14T15:00", timeZone: "Europe/Sofia",
      format: "video", place: "Google Meet", people: ["Mara Ivanova"], round: "1 of 2", notes: null,
    });

    clock.set("2026-10-14T11:59:00Z"); // 14:59 in Sofia: still in the interview
    expect(await due(tracker)).toEqual([]);
    clock.set("2026-10-14T12:00:00Z"); // 15:00: it ended
    expect(await due(tracker)).toEqual(["Medora:thank-you:2026-10-15T11:00:00.000Z"]);
    const thanks = (await tracker.needsYou()).items[0]!.followUp;
    expect(thanks).toMatchObject({ readyAt: "2026-10-14T12:00:00.000Z", dueOn: "2026-10-15" });
  });

  it("isn't there for an interview without a time", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, { start: null, end: null, timeZone: "Europe/Sofia", format: "phone", place: null, people: [], round: null, notes: null });

    await clock.advance(10 * day);

    expect((await tracker.needsYou()).items.filter((i) => i.followUp.kind === "thank-you")).toEqual([]);
  });

  it("follows the interview when its time is corrected", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    const { interview } = await tracker.setInterview(id, { start: "2026-10-14T14:00", end: null, timeZone: "Europe/Sofia", format: "video", place: null, people: [], round: null, notes: null });

    await tracker.setInterview(id, { interviewId: interview.id, start: "2026-10-15T09:30", end: "2026-10-15T10:15", timeZone: "Europe/London", format: "video", place: null, people: [], round: null, notes: null });

    clock.set("2026-10-15T09:15:00Z");
    expect(await due(tracker)).toEqual(["Medora:thank-you:2026-10-16T08:30:00.000Z"]);
  });
});

const at = (start: string, end: string | null = null, timeZone = "Europe/Sofia") =>
  ({ start, end, timeZone, format: "video" as const, place: null, people: ["Mara Ivanova"], round: null, notes: null });

describe("a check-in when interviews go quiet", () => {
  it("comes due 7 days after the last interview ends with no news, and not before", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, at("2026-10-13T10:00", "2026-10-13T11:00"));
    await tracker.setInterview(id, at("2026-10-15T14:00", "2026-10-15T15:00"));
    const checkIns = async () => (await due(tracker)).filter((d) => d.includes("check-in"));

    clock.set("2026-10-21T21:00:00Z"); // Thu 22 Oct, 00:00 in Sofia: 6 quiet days
    expect(await checkIns()).toEqual(["Medora:check-in:2026-10-22"]);
    clock.set("2026-10-21T20:59:00Z");
    expect(await checkIns()).toEqual([]);
  });

  it("isn't there while an interview is still to come, nor after a reply or a Status change", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, at("2026-10-13T10:00", "2026-10-13T11:00"));
    await tracker.setInterview(id, at("2026-10-27T10:00", "2026-10-27T11:00"));
    clock.set("2026-10-24T08:00:00Z");
    expect((await due(tracker)).filter((d) => d.includes("check-in"))).toEqual([]);

    const other = await add(tracker, { company: "Ostwind Cloud" });
    await tracker.setInterview(other, at("2026-10-14T10:00", "2026-10-14T11:00"));
    expect((await due(tracker)).filter((d) => d.includes("check-in"))).toEqual(["Ostwind Cloud:check-in:2026-10-21"]);
    await tracker.setStatus(other, "offer");
    expect((await due(tracker)).filter((d) => d.includes("check-in"))).toEqual([]);
  });

  it("follows the check-in delay setting", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, at("2026-10-13T10:00", "2026-10-13T11:00"));
    await tracker.saveFollowUpSettings({ checkInAfterDays: 4 });

    clock.set("2026-10-17T08:00:00Z");
    expect((await due(tracker)).filter((d) => d.includes("check-in"))).toEqual(["Medora:check-in:2026-10-17"]);
  });
});

describe("the interview as a calendar file (.ics)", () => {
  /** The .ics with folded lines joined again, one property per line. */
  const unfold = (text: string) => text.replace(/\r\n /g, "").split("\r\n");

  it("keeps the interview's own time zone and its details", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    const { interview } = await tracker.setInterview(id, {
      start: "2026-10-20T14:00", end: "2026-10-20T15:00", timeZone: "Europe/London", format: "video", place: "Google Meet",
      people: ["Mara Ivanova, Engineering Manager", "Teo Lindqvist"], round: "1 of 2", notes: "Teo is in Stockholm; bring the take-home questions.",
    });

    const ics = (await tracker.interviewIcs(interview.id))!;

    expect(ics.fileName).toBe("interview-medora-2026-10-20.ics");
    const lines = unfold(ics.text);
    expect(lines).toEqual(expect.arrayContaining([
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "END:VEVENT", "END:VCALENDAR",
      "TZID:Europe/London", "TZOFFSETTO:+0100",
      "DTSTART;TZID=Europe/London:20261020T140000",
      "DTEND;TZID=Europe/London:20261020T150000",
      "SUMMARY:Interview: Full-stack Engineer at Medora (1 of 2)",
      "LOCATION:Google Meet",
      "DESCRIPTION:Round: 1 of 2\\nFormat: Video call\\nWith: Mara Ivanova\\, Engineering Manager\\; Teo Lindqvist\\nNotes: Teo is in Stockholm\\; bring the take-home questions.",
    ]));
    expect(ics.text.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("uses the offset of the day itself (Sofia after the clocks go back), an hour when no end is given, and isn't there without a time", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    const { interview } = await tracker.setInterview(id, at("2026-11-02T10:00"));
    const lines = unfold((await tracker.interviewIcs(interview.id))!.text);
    expect(lines).toEqual(expect.arrayContaining(["TZOFFSETTO:+0200", "DTSTART;TZID=Europe/Sofia:20261102T100000", "DTEND;TZID=Europe/Sofia:20261102T110000"]));

    const { interview: none } = await tracker.setInterview(id, { ...at("2026-11-02T10:00"), start: null });
    expect(await tracker.interviewIcs(none.id)).toBeNull();
  });
});

type Recorded = { email: Parameters<typeof mailMessage>[0]; classification: EmailClassification };
const recorded = (JSON.parse(loadFixture("track-mail/emails.json")) as { emails: Record<string, Recorded> }).emails;

/** The fake Track assistant: recorded classifications per Message-ID, and the given prep sheet output. */
function fakeAssistant(prep: (input: PrepSheetInput) => PrepSheetDraft = () => ({ facts: [], questions: [] }), costUsd = 0.001) {
  const byId = new Map(Object.values(recorded).map((r) => [r.email.id, r.classification]));
  const prepCalls: PrepSheetInput[] = [];
  const assistant: TrackAssistant = {
    estimateClassifyUsd: () => costUsd,
    async classify(input) {
      const classification = byId.get(input.messageId);
      if (!classification) throw new Error(`no recorded classification for ${input.messageId}`);
      return { classification, costUsd, model: "fake/track-assistant" };
    },
    estimateDraftUsd: () => costUsd,
    draft: async () => { throw new Error("no drafts in these tests"); },
    estimatePrepSheetUsd: () => costUsd,
    async buildPrepSheet(input) {
      prepCalls.push(input);
      return { sheet: prep(input), costUsd, model: "fake/track-assistant" };
    },
  };
  return { assistant, prepCalls };
}

/** A Master profile held in memory: its confirmed stories, and the unconfirmed pieces handed to it. */
function fakeProfile(stories: ProfileStory[]) {
  const added: { text: string; source: string }[] = [];
  const profile: MasterProfile = {
    evidence: async () => [],
    stories: async () => stories,
    async addUnconfirmedPiece(piece) { added.push(piece); return { id: `piece-${added.length}` }; },
  };
  return { profile, added };
}

/** Discover and Track on one database and one mailbox read per check, as the service wires them. */
function withMail({ cap = 10, prep, stories = [] }: { cap?: number; prep?: (input: PrepSheetInput) => PrepSheetDraft; stories?: ProfileStory[] } = {}) {
  const clock = fakeClock();
  const mailbox = fakeMailbox(clock);
  const ai = fakeAssistant(prep);
  const me = fakeProfile(stories);
  let tracker: TrackerApi | null = null;
  const t = createTestEngine({ clock, mailReader: mailbox, aiMonthlyCapUsd: cap, onMailStored: (emails) => tracker!.processMail(emails) });
  tracker = createTracker({
    db: t.deps.db, clock, discovery: t.engine, assistant: ai.assistant, aiMonthlyCapUsd: cap, profile: me.profile, ownAddresses: ["sample.jobs@example.com"],
  });
  const receive = async (iso: string, ...names: string[]) => {
    for (const n of names) mailbox.deliver(mailMessage(recorded[n]!.email));
    clock.set(iso);
    await t.engine.checkAll();
  };
  const deliver = async (iso: string, email: Parameters<typeof mailMessage>[0]) => {
    mailbox.deliver(mailMessage(email));
    clock.set(iso);
    await t.engine.checkAll();
  };
  return { ...t, clock, tracker: tracker as TrackerApi, ai, me, receive, deliver };
}

describe("interview details from the invite email", () => {
  it("are pre-filled from a confidently matched invitation, shown as read from the invite email", async () => {
    const { tracker, receive } = withMail();
    const id = await add(tracker as Tracker, { company: "Varna Trust Bank", title: "Специалист информационна сигурност", status: "applied" });

    await receive("2026-10-13T06:00:00Z", "bulgarian-call");

    const app = (await tracker.get(id))!;
    expect(app.status).toBe("screening");
    expect(app.interviews).toEqual([expect.objectContaining({
      start: "2026-10-15T10:00", timeZone: "Europe/Sofia", startAt: "2026-10-15T07:00:00.000Z", endAt: "2026-10-15T08:00:00.000Z",
      format: "phone", people: ["Галина Иванова"], round: "Short phone call",
      readFrom: expect.objectContaining({ emailId: "<call-1@varnatrust.example>", subject: "Покана за телефонен разговор" }),
    })]);
    expect(app.timeline.map((e) => `${e.kind}:${e.cause}`).slice(0, 2)).toEqual(["email:email", "interview:email"]);
    expect(app.nextStep).toMatchObject({ kind: "interview", text: "Interview Thu 15 Oct, 10:00 Sofia time" });
  });

  it("come with an invitation you match yourself, in the time zone it names; editing them makes them yours", async () => {
    const { tracker, receive } = withMail();
    const id = await add(tracker as Tracker, { company: "Ostwind Cloud", title: "Cloud Security Engineer", status: "screening" });

    await receive("2026-10-16T09:00:00Z", "second-invitation");
    await tracker.answerEmail("<inv-2@nimbus-cloud.example>", { choice: "application", applicationId: id, move: true });

    const [interview] = (await tracker.get(id))!.interviews;
    expect(interview).toMatchObject({
      start: "2026-10-20T14:00", end: "2026-10-20T15:00", timeZone: "Europe/Berlin", startAt: "2026-10-20T12:00:00.000Z",
      round: "Technical interview", notes: "The email says 14:00 CET.", readFrom: { subject: "Next round: technical interview" }, editedAt: null,
    });

    await tracker.setInterview(id, { ...interview!, interviewId: interview!.id, people: ["Ivo Marinov", "Dara Kim"] });

    expect((await tracker.get(id))!.interviews[0]).toMatchObject({ people: ["Ivo Marinov", "Dara Kim"], readFrom: null, editedAt: "2026-10-16T09:00:00.000Z" });
  });

  it("an invitation without a time gives an interview to fill in, and no thank-you note", async () => {
    const { tracker, receive, clock } = withMail();
    const id = await add(tracker as Tracker, { company: "Northwind Labs", title: "Security Engineer", status: "applied", contact: "northwind-labs.example" });

    await receive("2026-10-14T12:00:00Z", "late-screening-invitation");
    await clock.advance(5 * day);

    const app = (await tracker.get(id))!;
    expect(app.interviews).toEqual([expect.objectContaining({ start: null, startAt: null, people: ["Mira Petrova"], round: "20-minute intro call" })]);
    expect(app.thankYous).toEqual([]);
  });
});

describe("the prep sheet", () => {
  const stories: ProfileStory[] = [
    { id: "piece-ts", text: "Moved the Velora dashboard's 40k lines to strict TypeScript", where: "Velora · 2023" },
    { id: "piece-remote", text: "Weekly written updates on a remote team", where: "Velora" },
  ];
  const output = (): PrepSheetDraft => ({
    facts: [
      { text: "Booking software for private clinics.", source: "posting" },
      { text: "Raised a Series B in 2025.", source: "unverified" },
      { text: "You liked that the posting lists salary.", source: "notes" },
    ],
    questions: [
      { requirement: "TypeScript, 2+ yrs", question: "Walk me through a codebase you made safer with TypeScript.", storyId: "piece-ts" },
      { requirement: "Postgres (preferred)", question: "Tell me about a slow query you tracked down.", storyId: "piece-made-up" },
      { requirement: "Testing (preferred)", question: "How do you decide what to test?", storyId: null },
    ],
  });

  it("never holds a story the Master profile doesn't have: an unknown story is \"No story yet\"", async () => {
    const { tracker, ai } = withMail({ prep: output, stories });
    const id = await add(tracker as Tracker);

    const sheet = await tracker.buildPrepSheet(id);

    expect(sheet.questions.map((q) => [q.requirement, q.story?.text ?? "No story yet"])).toEqual([
      ["TypeScript, 2+ yrs", "Moved the Velora dashboard's 40k lines to strict TypeScript"],
      ["Postgres (preferred)", "No story yet"],
      ["Testing (preferred)", "No story yet"],
    ]);
    expect(ai.prepCalls[0]!.stories).toEqual(stories);
  });

  it("tags each company fact with its source; one claimed from the posting or your notes when there's neither is unverified", async () => {
    const { tracker } = withMail({ prep: output, stories });
    const id = await add(tracker as Tracker);

    expect((await tracker.buildPrepSheet(id)).facts).toEqual([
      { text: "Booking software for private clinics.", tag: "unverified" },
      { text: "Raised a Series B in 2025.", tag: "unverified" },
      { text: "You liked that the posting lists salary.", tag: "unverified" },
    ]);

    const other = await add(tracker as Tracker, { company: "Ostwind Cloud" });
    await tracker.addNote(other, "Liked that the posting lists salary.");
    expect((await tracker.buildPrepSheet(other)).facts.map((f) => f.tag)).toEqual(["unverified", "unverified", "notes"]);
  });

  it("is built once per Application", async () => {
    const { tracker, ai } = withMail({ prep: output, stories });
    const id = await add(tracker as Tracker);
    expect(await tracker.prepSheet(id)).toBeNull();

    await tracker.buildPrepSheet(id);
    await tracker.buildPrepSheet(id);

    expect(ai.prepCalls).toHaveLength(1);
    expect(await tracker.prepSheet(id)).toMatchObject({ applicationId: id, builtAt: "2026-10-12T07:30:00.000Z" });
  });

  it("isn't built when the AI budget is out: no assistant call", async () => {
    const { tracker, ai } = withMail({ prep: output, stories, cap: 0 });
    const id = await add(tracker as Tracker);

    await expect(tracker.buildPrepSheet(id)).rejects.toMatchObject({ problem: "budget" });
    expect(ai.prepCalls).toEqual([]);
    expect(await tracker.prepSheet(id)).toBeNull();
  });

  it("keeps practised marks, and a story you add goes to the Master profile as an unconfirmed piece", async () => {
    const { tracker, me } = withMail({ prep: output, stories });
    const id = await add(tracker as Tracker);
    const sheet = await tracker.buildPrepSheet(id);

    await tracker.markPractised(id, sheet.questions[0]!.id, true);
    const after = await tracker.addPrepStory(id, sheet.questions[2]!.id, "  Wrote the test plan for the booking API at Velora.  ");

    expect(after.questions.map((q) => q.practised)).toEqual([true, false, false]);
    expect(after.questions[2]).toMatchObject({ story: null, yourStory: { text: "Wrote the test plan for the booking API at Velora." } });
    expect(me.added).toEqual([{
      text: "Wrote the test plan for the booking API at Velora.",
      source: "Prep sheet for Full-stack Engineer at Medora: \"How do you decide what to test?\"",
    }]);
    await expect(tracker.addPrepStory(id, sheet.questions[1]!.id, " ")).rejects.toMatchObject({ problem: "invalid" });
  });
});

describe("Needs you and Stats with interviews", () => {
  it("Needs you lists interviews in the next 7 days with their prep sheet, and counts them", async () => {
    const { tracker } = withMail();
    const id = await add(tracker as Tracker);
    await tracker.setInterview(id, at("2026-10-15T14:00", "2026-10-15T15:00"));
    const later = await add(tracker as Tracker, { company: "Ostwind Cloud" });
    await tracker.setInterview(later, at("2026-10-26T10:00"));

    const n = await tracker.needsYou();

    expect(n.interviews.map((i) => `${i.application.company} ${i.interview.startAt}`)).toEqual(["Medora 2026-10-15T11:00:00.000Z"]);
    expect(n.interviews[0]!.prep).toBeNull();
    expect(n.count).toBe(1);
    expect((await tracker.get(id))!.next).toEqual({ kind: "interview", startAt: "2026-10-15T11:00:00.000Z", start: "2026-10-15T14:00", timeZone: "Europe/Sofia" });
  });

  it("Stats counts interviews upcoming and held so far", async () => {
    const { tracker, clock } = withMail();
    const id = await add(tracker as Tracker);
    await tracker.setInterview(id, at("2026-10-13T10:00"));
    await tracker.setInterview(id, at("2026-10-20T10:00"));
    const closed = await add(tracker as Tracker, { company: "Pixelmoor", status: "rejected" });
    await tracker.setInterview(closed, at("2026-10-21T10:00"));
    await add(tracker as Tracker, { company: "Lumio Maps", status: "offer" });

    clock.set("2026-10-14T08:00:00Z");

    expect((await tracker.stats()).interviews).toEqual({ upcoming: 1, soFar: 2, companies: 2 });
  });
});

describe("writing a thank-you note", () => {
  it("asks for one thing discussed and builds the outline from it; Open in Mail has the contact and subject; Mark sent stops it", async () => {
    const { tracker, clock } = withMail();
    const id = await add(tracker as Tracker, { company: "Ostwind Cloud", title: "Cloud Security Engineer", contact: "ivo.marinov@ostwind.example" });
    await tracker.setInterview(id, { ...at("2026-10-12T16:00", "2026-10-12T17:00"), people: ["Ivo Marinov"] });
    clock.set("2026-10-12T14:05:00Z");
    const thanks = (await tracker.get(id))!.thankYous[0]!;

    const { outline } = await tracker.saveFollowUpTopic(thanks.id, "Catching IAM drift between Terraform and the live accounts");
    const draft = (await tracker.followUp(thanks.id))!;

    expect(outline[0]).toBe("Thank Ivo Marinov for the interview for Cloud Security Engineer on Mon 12 Oct.");
    expect(draft.outline[1]).toBe("The thing you discussed: \"Catching IAM drift between Terraform and the live accounts\". Say in a sentence why it interested you.");
    expect(draft.mail).toEqual({ to: "ivo.marinov@ostwind.example", subject: "Thank you: Cloud Security Engineer interview" });
    expect(draft.words).toEqual({ min: 70, max: 130 });
    expect((await tracker.get(id))!.nextStep).toMatchObject({ kind: "follow-up", followUp: { id: thanks.id } });

    const { event } = await tracker.markFollowUpSent(thanks.id);
    expect(event).toMatchObject({ kind: "follow-up-sent", text: "Thank-you note sent" });
    expect((await tracker.needsYou()).items).toEqual([expect.objectContaining({ done: true })]);
  });
});

describe("a sent copy in the job mailbox", () => {
  it("marks the thank-you note sent by email when it goes to the interview's contact after the interview", async () => {
    const { tracker, deliver } = withMail();
    const id = await add(tracker as Tracker, { company: "Ostwind Cloud", title: "Cloud Security Engineer", contact: "ivo.marinov@ostwind.example" });
    await tracker.setInterview(id, { ...at("2026-10-12T16:00", "2026-10-12T17:00"), people: ["Ivo Marinov"] });

    await deliver("2026-10-12T16:30:00Z", {
      id: "<sent-thanks@example.com>", from: "Alex Doe <sample.jobs@example.com>", to: ["Ivo Marinov <ivo.marinov@ostwind.example>"],
      subject: "Thank you: Cloud Security Engineer interview", receivedAt: "2026-10-12T16:20:00Z", text: "Thank you for the conversation today.",
    });

    expect((await tracker.get(id))!.thankYous[0]).toMatchObject({ state: "sent", doneBy: "email" });
  });
});
