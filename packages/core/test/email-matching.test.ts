// Email matching (Track #31), at the tracker's public interface: after each read of the job mailbox,
// new non-alert emails are classified by the Track assistant (a fake answering with recorded outputs)
// and matched to Applications by deterministic signals. A confident unique match moves the Status by
// email; anything doubtful waits as "Email to match". Fake clock, in-memory database, recorded
// synthetic emails (made-up companies and people), no live IMAP and no live AI.
import { describe, expect, it } from "vitest";
import {
  createTracker, MailboxError, type EmailClassification, type MailMessage, type Status, type TrackAssistant, type Tracker,
} from "../src/index.ts";
import { alertEmail, createTestEngine, fakeClock, fakeMailbox, loadFixture, mailMessage } from "./harness.ts";

type Recorded = { email: Parameters<typeof mailMessage>[0]; classification: EmailClassification };
const recorded = (JSON.parse(loadFixture("track-mail/emails.json")) as { emails: Record<string, Recorded> }).emails;
type Name = keyof typeof recorded & string;
const email = (name: Name): MailMessage => mailMessage(recorded[name]!.email);

/** The fake Track assistant: answers with the recorded classification for each email, keyed by its Message-ID. */
function fakeAssistant({ costUsd = 0.0005 } = {}) {
  const byId = new Map(Object.values(recorded).map((r) => [r.email.id, r.classification]));
  const calls: string[] = [];
  const assistant: TrackAssistant = {
    estimateClassifyUsd: () => costUsd,
    async classify(input) {
      calls.push(input.messageId);
      const classification = byId.get(input.messageId);
      if (!classification) throw new Error(`no recorded classification for ${input.messageId}`);
      return { classification, costUsd, model: "fake/track-assistant" };
    },
    estimateDraftUsd: () => costUsd,
    draft: async () => { throw new Error("no drafts in these tests"); },
  };
  return { assistant, calls };
}

/** Discover and Track on one database and one mailbox read per check, as the service wires them. */
function setup({ cap = 10, start = "2026-10-12T07:30:00Z" }: { cap?: number; start?: string } = {}) {
  const clock = fakeClock(start);
  const mailbox = fakeMailbox(clock);
  const ai = fakeAssistant();
  let tracker: Tracker | null = null;
  const t = createTestEngine({
    clock, mailReader: mailbox, aiMonthlyCapUsd: cap,
    onMailStored: (emails) => tracker!.processMail(emails),
  });
  tracker = createTracker({ db: t.deps.db, clock, discovery: t.engine, assistant: ai.assistant, aiMonthlyCapUsd: cap });
  const tr = tracker;
  /** Delivers emails and runs a check at the time given (the mailbox is read once, Track matches what's new). */
  const receive = async (at: string, ...names: Name[]) => {
    for (const n of names) mailbox.deliver({ ...email(n), receivedAt: email(n).receivedAt });
    clock.set(at);
    await t.engine.checkAll();
  };
  const add = async (company: string, title: string, opts: { status?: Exclude<Status, "accepted">; contact?: string; appliedOn?: string } = {}) => {
    const r = await tr.addByHand({ job: { company, title }, appliedOn: opts.appliedOn ?? "2026-10-05", status: opts.status ?? "applied", contact: opts.contact });
    if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
    return r.application.id;
  };
  return { ...t, clock, mailbox, tracker: tr, ai, receive, add };
}

const statusOf = async (tracker: Tracker, id: string) => (await tracker.get(id))!.status;

describe("a confident match moves the Status by email", () => {
  it("a rejection from the company's domain naming the job moves it to Rejected, by email, with the signals it matched on", async () => {
    const { tracker, add, receive } = setup();
    const id = await add("Northwind Labs", "Security Engineer", { contact: "northwind-labs.example" });

    await receive("2026-10-14T10:00:00Z", "rejection");

    const app = (await tracker.get(id))!;
    expect(app.status).toBe("rejected");
    expect(app.timeline[0]).toMatchObject({ kind: "email", cause: "email", from: "applied", to: "rejected", undoable: true });
    expect(app.movedByEmail).toMatchObject({
      from: "applied", to: "rejected",
      email: { subject: "Your application for Security Engineer", from: "Mira Petrova <mira.petrova@northwind-labs.example>" },
    });
    expect(app.movedByEmail!.signals).toEqual(expect.arrayContaining([
      expect.stringContaining("northwind-labs.example"),
      expect.stringContaining("Security Engineer"),
    ]));
  });
});

describe("undoing an email's move", () => {
  it("restores the Status and keeps the email on the timeline as not a Status change", async () => {
    const { tracker, add, receive } = setup();
    const id = await add("Northwind Labs", "Security Engineer", { contact: "northwind-labs.example" });
    await receive("2026-10-14T10:00:00Z", "rejection");
    const moved = (await tracker.get(id))!.movedByEmail!;

    await tracker.undoEvent(moved.eventId);

    const app = (await tracker.get(id))!;
    expect(app.status).toBe("applied");
    expect(app.movedByEmail).toBeNull();
    const email = app.timeline.find((e) => e.kind === "email")!;
    expect(email).toMatchObject({ undoable: false, email: { subject: "Your application for Security Engineer" } });
    expect(email.undoneAt).not.toBeNull();
    expect(app.timeline[0]).toMatchObject({ kind: "undo", text: "Undone: back to Applied. The email stays, as not a Status change" });
    // An email that wasn't a Status change is no reply either.
    expect((await tracker.stats()).responseRate.replied).toBe(0);
  });

  it("\"Looks right\" takes the banner away and leaves the move and the email as they are", async () => {
    const { tracker, add, receive } = setup();
    const id = await add("Northwind Labs", "Security Engineer", { contact: "northwind-labs.example" });
    await receive("2026-10-14T10:00:00Z", "rejection");

    await tracker.confirmEmailMove((await tracker.get(id))!.movedByEmail!.eventId);

    const app = (await tracker.get(id))!;
    expect(app.movedByEmail).toBeNull();
    expect(app.status).toBe("rejected");
    expect(app.timeline.find((e) => e.kind === "email")).toMatchObject({ undoable: true });
  });
});

describe("a doubtful email waits as Email to match", () => {
  it("a low-confidence invitation changes nothing; answering it teaches the sender, and the next email from them matches without asking", async () => {
    const { tracker, add, receive } = setup();
    const ostwind = await add("Ostwind Cloud", "Platform Security Engineer");
    await add("Tidewater Pay", "Application Security Engineer");

    await receive("2026-10-13T10:00:00Z", "unsure-invitation");

    expect(await statusOf(tracker, ostwind)).toBe("applied");
    const [waiting, ...more] = await tracker.emailsToMatch();
    expect(more).toEqual([]);
    expect(waiting).toMatchObject({
      email: { subject: "Interview invitation", from: "Nina Doe <talent@nimbus-cloud.example>", kind: "interview-invitation" },
      moveTo: "interviewing",
      newApplication: { company: "Nimbus", title: "Platform Security" },
      remembers: "nimbus-cloud.example",
    });
    expect(waiting!.why).toContain("nothing has changed");
    // It counts in Needs you beside the two follow-ups already due (both applied 8 days ago).
    expect(await tracker.needsYou()).toMatchObject({ count: 3, emailsToMatch: 1, items: [{}, {}] });

    await tracker.answerEmail(waiting!.email.id, { choice: "application", applicationId: ostwind, move: true });
    expect(await statusOf(tracker, ostwind)).toBe("interviewing");
    expect(await tracker.emailsToMatch()).toEqual([]);

    // The next email from the same sender names neither company nor job: the taught sender matches it.
    await tracker.setStatus(ostwind, "screening");
    await receive("2026-10-16T09:00:00Z", "second-invitation");
    expect(await tracker.emailsToMatch()).toEqual([]);
    const app = (await tracker.get(ostwind))!;
    expect(app.status).toBe("interviewing");
    expect(app.movedByEmail!.signals).toEqual([expect.stringContaining("talent@nimbus-cloud.example")]);
  });

  it("even a unique match waits when the reading is unsure", async () => {
    const { tracker, add, receive } = setup();
    const nimbus = await add("Nimbus", "Platform Security", { contact: "nimbus-cloud.example" });

    await receive("2026-10-13T10:00:00Z", "unsure-invitation");

    expect(await statusOf(tracker, nimbus)).toBe("applied");
    const [waiting] = await tracker.emailsToMatch();
    expect(waiting!.why).toContain("isn't sure enough");
    expect(waiting!.candidates.map((c) => c.application.id)).toEqual([nimbus]);
  });

  it("an email can be matched without moving the Status", async () => {
    const { tracker, add, receive } = setup();
    const ostwind = await add("Ostwind Cloud", "Platform Security Engineer");
    await receive("2026-10-13T10:00:00Z", "unsure-invitation");
    const [waiting] = await tracker.emailsToMatch();

    const answered = await tracker.answerEmail(waiting!.email.id, { choice: "application", applicationId: ostwind, move: false });

    expect(answered.event).toMatchObject({ kind: "email", cause: "you", from: null, to: null });
    const app = (await tracker.get(ostwind))!;
    expect(app.status).toBe("applied");
    expect(app.timeline[0]).toMatchObject({ kind: "email", email: { subject: "Interview invitation", matchedBy: "you" } });
  });

  it("an answer with no choice is refused with why, and nothing changes", async () => {
    const { tracker, add, receive } = setup();
    await add("Ostwind Cloud", "Platform Security Engineer");
    await receive("2026-10-13T10:00:00Z", "unsure-invitation");
    const [waiting] = await tracker.emailsToMatch();

    await expect(tracker.answerEmail(waiting!.email.id, {} as never)).rejects.toMatchObject({
      problem: "invalid", message: "Choose where this email belongs first.",
    });
    expect(await tracker.emailsToMatch()).toHaveLength(1);
  });

  it("a recruiter writing from a new domain lists the Application whose job it names, with the reason", async () => {
    const { tracker, add, receive } = setup();
    const orbitly = await add("Orbitly", "Backend Engineer (Go)");

    await receive("2026-10-13T13:00:00Z", "recruiter-new-domain");

    const [waiting] = await tracker.emailsToMatch();
    expect(waiting!.candidates).toEqual([
      { application: expect.objectContaining({ id: orbitly }), reasons: ['It names the job: "Backend Engineer (Go)".'] },
    ]);
    expect(waiting!.moveTo).toBeNull();
  });

  it("\"a new Application\" adds one from the email; \"not about an application\" leaves that sender's mail alone from then on", async () => {
    const { tracker, receive, mailbox } = setup();
    await receive("2026-10-13T10:00:00Z", "unsure-invitation");
    const [nimbus] = await tracker.emailsToMatch();

    const added = await tracker.answerEmail(nimbus!.email.id, { choice: "new", move: true });
    expect(added.application).toMatchObject({ company: "Nimbus", title: "Platform Security", status: "interviewing", createdHow: "from-email" });

    await receive("2026-10-13T13:00:00Z", "recruiter-new-domain");
    const [hireloop] = await tracker.emailsToMatch();
    await tracker.answerEmail(hireloop!.email.id, { choice: "none" });
    expect(await tracker.emailsToMatch()).toEqual([]);

    // The dismissed recruiter writes again: left alone. A rejection from elsewhere still waits.
    mailbox.deliver({ ...email("recruiter-new-domain"), id: "<info-2@hireloop.example>", subject: "One more question", receivedAt: new Date("2026-10-14T12:00:00Z") });
    await receive("2026-10-14T13:00:00Z", "rejection");
    expect((await tracker.emailsToMatch()).map((e) => e.email.subject)).toEqual(["Your application for Security Engineer"]);
  });
});

describe("what email never does", () => {
  it("never moves a Status backwards: a screening invitation for an Application at Interviewing is filed, the Status stays", async () => {
    const { tracker, add, receive } = setup();
    const id = await add("Northwind Labs", "Security Engineer", { contact: "northwind-labs.example", status: "interviewing" });

    await receive("2026-10-14T12:00:00Z", "late-screening-invitation");

    const app = (await tracker.get(id))!;
    expect(app.status).toBe("interviewing");
    expect(app.movedByEmail).toBeNull();
    expect(app.timeline[0]).toMatchObject({ kind: "email", cause: "email", from: null, to: null, text: expect.stringContaining("Status stays") });
  });

  it("a confirmation is filed without changing anything and isn't a reply", async () => {
    const { tracker, add, receive } = setup({ start: "2026-10-01T07:30:00Z" });
    const id = await add("Northwind Labs", "Security Engineer", { appliedOn: "2026-09-20" });

    await receive("2026-10-12T07:30:00Z", "greenhouse-confirmation");

    const app = (await tracker.get(id))!;
    expect(app.status).toBe("applied");
    expect(app.timeline[0]).toMatchObject({ kind: "email", text: "Confirmation, filed", email: { kind: "confirmation" } });
    expect((await tracker.stats()).responseRate).toMatchObject({ replied: 0, counted: 1 });

    // A reply in its thread (a recruiter from another domain asking for details) is a reply.
    await receive("2026-10-15T11:00:00Z", "thread-reply");
    expect((await tracker.get(id))!.timeline[0]).toMatchObject({ kind: "email", email: { kind: "info-request" } });
    expect((await tracker.stats()).responseRate).toMatchObject({ replied: 1, counted: 1 });
  });

  it("job-alert emails are left to Discover: Track ignores them and they still reach the Feed from the same read", async () => {
    const { engine, tracker, mailbox, clock, ai } = setup();
    await engine.addSource({ kind: "email", config: "linkedin" });
    mailbox.deliver(alertEmail("email-linkedin.html", {
      id: "<alert-1@linkedin.example>", from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
      subject: "New jobs for security engineer", receivedAt: "2026-10-12T06:12:00Z",
    }));
    clock.set("2026-10-12T07:30:00Z");
    await engine.checkAll();

    expect((await engine.queryFeed({ view: "new" })).jobs.length).toBeGreaterThan(0);
    expect(ai.calls).toEqual([]);
    expect(await tracker.emailsToMatch()).toEqual([]);
    expect(mailbox.reads).toHaveLength(1);
  });
});

describe("when the AI budget is out", () => {
  it("makes no assistant call: rule-only matches apply and the rest wait as Email to match", async () => {
    const { tracker, add, receive, ai } = setup({ cap: 0 });
    const id = await add("Northwind Labs", "Security Engineer", { contact: "northwind-labs.example" });

    // A known job system's confirmation naming company and job; a reply in its thread; a rejection.
    await receive("2026-10-15T12:00:00Z", "greenhouse-confirmation", "thread-reply", "rejection");

    expect(ai.calls).toEqual([]);
    const app = (await tracker.get(id))!;
    expect(app.status).toBe("applied");
    expect(app.timeline.filter((e) => e.kind === "email").map((e) => e.email!.subject)).toEqual([
      "Re: Thank you for applying to Northwind Labs", "Thank you for applying to Northwind Labs",
    ]);
    const waiting = await tracker.emailsToMatch();
    expect(waiting.map((w) => w.email.subject)).toEqual(["Your application for Security Engineer"]);
    expect(waiting[0]!.why).toContain("AI budget is used up");
    expect(waiting[0]!.candidates[0]!.application.id).toBe(id);
  });
});

describe("Bulgarian mail", () => {
  it("is matched the same way, with the English summary beside the original", async () => {
    const { tracker, add, receive } = setup();
    const id = await add("Varna Trust Bank", "Специалист информационна сигурност");

    await receive("2026-10-13T06:00:00Z", "bulgarian-call");

    const app = (await tracker.get(id))!;
    expect(app.status).toBe("screening");
    expect(app.movedByEmail).toMatchObject({
      from: "applied", to: "screening",
      email: { language: "bg", summary: "Thanks you for applying for IT Security Specialist and asks for a short phone call on Thu 15 Oct at 10:00." },
    });
  });
});

describe("the job mailbox's state on Applications", () => {
  it("says when it isn't connected, since when, and the fix; Stats may be missing replies since then", async () => {
    const { tracker, mailbox, receive } = setup();
    mailbox.fail(new MailboxError("not-configured", "GMAIL_ADDRESS isn't set"));

    await receive("2026-10-12T07:30:00Z");

    expect(await tracker.mailbox()).toMatchObject({
      state: "not-connected", problem: "not-configured", since: "2026-10-12T07:30:00.000Z",
      fix: expect.stringContaining("GMAIL_APP_PASSWORD"),
    });
    expect((await tracker.stats()).mayBeMissingRepliesSince).toBe("2026-10-12T07:30:00.000Z");
  });

  it("says when sign-in failed and since when; mail missed meanwhile is matched once it's fixed", async () => {
    const { tracker, mailbox, receive, add } = setup();
    const id = await add("Northwind Labs", "Security Engineer", { contact: "northwind-labs.example" });
    await receive("2026-10-12T07:30:00Z");
    mailbox.fail(new MailboxError("auth", "Invalid credentials (Failure)"));
    await receive("2026-10-13T07:30:00Z");
    await receive("2026-10-14T07:30:00Z", "rejection");

    expect(await tracker.mailbox()).toMatchObject({ state: "failing", problem: "auth", since: "2026-10-13T07:30:00.000Z", fix: expect.stringContaining("app password") });
    expect(await statusOf(tracker, id)).toBe("applied");

    mailbox.recover();
    await receive("2026-10-15T07:30:00Z");

    expect(await tracker.mailbox()).toMatchObject({ state: "connected", since: null });
    expect((await tracker.stats()).mayBeMissingRepliesSince).toBeNull();
    expect(await statusOf(tracker, id)).toBe("rejected");
  });
});

describe("replies and follow-ups", () => {
  it("a reply cancels the pending nudge; a rejection's move cancels it too, and undoing that brings it back", async () => {
    const { tracker, add, receive } = setup({ start: "2026-10-01T07:30:00Z" });
    const northwind = await add("Northwind Labs", "Security Engineer", { contact: "northwind-labs.example", appliedOn: "2026-10-01" });
    const orbitly = await add("Orbitly", "Backend Engineer (Go)", { contact: "hireloop.example", appliedOn: "2026-10-01" });
    const nudges = async () => (await tracker.needsYou()).items.map((i) => i.application.company).sort();
    await receive("2026-10-09T07:30:00Z");
    expect(await nudges()).toEqual(["Northwind Labs", "Orbitly"]);

    // A request for information is a reply, filed without moving anything.
    await receive("2026-10-13T13:00:00Z", "recruiter-new-domain");
    expect(await tracker.get(orbitly)).toMatchObject({ status: "applied", timeline: [{ kind: "email" }, {}] });
    expect(await nudges()).toEqual(["Northwind Labs"]);

    await receive("2026-10-14T10:00:00Z", "rejection");
    expect(await nudges()).toEqual([]);
    await tracker.undoEvent((await tracker.get(northwind))!.movedByEmail!.eventId);
    expect(await nudges()).toEqual(["Northwind Labs"]);
  });
});
