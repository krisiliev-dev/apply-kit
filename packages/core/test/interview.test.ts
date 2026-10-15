import { describe, expect, it } from "vitest";
import type { CoachTopic, CoachTurn, CoachTurnInput, PieceInput, WriterRequest } from "../src/index.ts";
import { createTestPreparation, fakeWriter, plainCoachTurn, type RecordedOutputs } from "./preparation-harness.ts";
import { memoryDb } from "./harness.ts";

// The coach interview (ticket #57), through the preparation engine with the fake writer's recorded
// outputs and a fake clock (2026-10-12 unless a test moves it). Made-up person only: Mira Petrova.

const role = (title: string, organisation: string, start: string, end: string | null): PieceInput => ({
  kind: "role", text: "", entry: { title, organisation, city: "Sofia", start, end }, angles: ["security"],
});

/** Two confirmed roles with eight months between them (Jul 2020 – Feb 2021). */
function withRoles(recorded: RecordedOutputs = {}, roles = [
  role("IT Support Technician", "Linden Clinics", "2019-01", "2020-06"),
  role("Junior Security Analyst", "Orbital Bank", "2021-03", null),
]) {
  const writer = fakeWriter(recorded);
  const t = createTestPreparation({ writer });
  const ids = roles.map((r) => {
    const saved = t.preparation.savePiece(r);
    if (!saved.saved) throw new Error(saved.problems[0]!.message);
    return saved.piece.id;
  });
  return { ...t, writer, ids };
}

const coachCalls = (calls: WriterRequest[]) => calls.flatMap((c) => (c.task === "coach-turn" ? [c.input as CoachTurnInput] : []));
const kinds = (topics: (CoachTopic | null)[]) => topics.map((x) => x?.kind ?? null);

describe("the questions in scope", () => {
  it("asks about a gap of more than three months between roles, computed from their dates", async () => {
    const t = withRoles();

    t.preparation.startInterview();
    await t.preparation.interviewSettled();

    const first = coachCalls(t.writer.calls)[0]!;
    expect(first.asked).toBeNull();
    expect(first.next).toEqual({
      kind: "gap", from: "2020-07", to: "2021-02", months: 8,
      before: { id: t.ids[0], kind: "role", title: "IT Support Technician", organisation: "Linden Clinics", start: "2019-01", end: "2020-06" },
      after: { id: t.ids[1], kind: "role", title: "Junior Security Analyst", organisation: "Orbital Bank", start: "2021-03", end: null },
    });
    expect(t.preparation.interview().turns).toEqual([
      expect.objectContaining({ who: "coach", text: "Nothing is listed from 2020-07 to 2021-02. What were you doing then?" }),
    ]);
  });
});

describe("gaps in the timeline", () => {
  const ended = (clockAt: string) => {
    const t = withRoles({}, [role("Junior Security Analyst", "Orbital Bank", "2021-03", "2026-03")]);
    t.clock.set(clockAt);
    return t;
  };

  it("asks about the time since the last role ended, up to last month", async () => {
    const t = ended("2026-10-12T08:00:00Z");

    t.preparation.startInterview();
    await t.preparation.interviewSettled();

    expect(coachCalls(t.writer.calls)[0]!.next).toMatchObject({ kind: "gap", from: "2026-04", to: "2026-09", months: 6, after: null });
  });

  it("doesn't ask about three months or less", async () => {
    const t = ended("2026-07-12T08:00:00Z");

    const started = t.preparation.startInterview();
    await t.preparation.interviewSettled();

    expect(started.scope.map((s) => s.kind)).not.toContain("gap");
    expect(kinds(coachCalls(t.writer.calls).map((c) => c.next))).toEqual(["skill"]);
  });
});

describe("the scope", () => {
  it("asks about imported pieces first, then gaps, then forgotten skills, then standard answers", async () => {
    const t = withRoles();
    const imported = t.preparation.savePiece({ kind: "achievement", text: "Took part in the response to 3 phishing incidents.", angles: ["security"] }, { from: "CV-2023.txt", quote: "Took part in the response to 3 phishing incidents.", status: "unconfirmed" });
    if (!imported.saved) throw new Error("not saved");

    const view = t.preparation.startInterview();
    await t.preparation.interviewSettled();

    expect(view.scope.map((s) => [s.kind, s.done, s.total, s.state])).toEqual([
      ["check", 0, 1, "current"], ["gap", 0, 1, "next"], ["skill", 0, 4, "next"], ["standard", 0, 6, "next"],
    ]);
    expect(kinds(coachCalls(t.writer.calls).map((c) => c.next))).toEqual(["check"]);
  });

  it("about one angle, asks only that angle's unchecked pieces and likely skills", async () => {
    const t = withRoles();

    const view = t.preparation.startInterview("security");

    expect(view.id).toBe("angle:security");
    expect(view.scope.map((s) => s.kind)).toEqual(["skill"]);
  });
});

/** A coach that, on Kris's answer to the gap, writes one piece citing her answer's line. */
const writesFromAnswer = (piece: Partial<CoachTurn["pieces"][number]> = {}): RecordedOutputs => ({
  coachTurn: (input: CoachTurnInput): CoachTurn => {
    if (!input.asked) return { reply: "", ask: "What were you doing from July 2020 to February 2021?", followUp: false, pieces: [], answer: null };
    const answer = input.asked.lines.filter((l) => l.who === "you").at(-1)!;
    return {
      reply: "I'll write that down.", ask: "Next question.", followUp: false, answer: null,
      pieces: [{
        turn: answer.id, updates: null, kind: "achievement", text: "Built a booking site for a dental clinic in Varna", entry: null,
        role: null, tags: ["React"], angles: ["developer"], numberSource: null, claim: "as-said", honest: null, ...piece,
      }],
    };
  },
});

async function answered(recorded: RecordedOutputs, text = "I freelanced: a booking site for a dental clinic in Varna, about a third of my week.") {
  const t = withRoles(recorded);
  t.preparation.startInterview();
  await t.preparation.interviewSettled();
  const sent = t.preparation.answerInterview("setup", text);
  await t.preparation.interviewSettled();
  return { ...t, sent };
}

describe("pieces written from answers", () => {
  it("stay unconfirmed until Finish, each citing the line of Kris's it came from", async () => {
    const t = await answered(writesFromAnswer());

    const waiting = t.preparation.interview("setup");
    expect(waiting.items.map((i) => [i.change, i.piece?.text, i.piece?.status, i.piece?.source.from])).toEqual([
      ["new", "Built a booking site for a dental clinic in Varna", "unconfirmed", "Coach interview"],
    ]);
    const answerLine = waiting.turns.find((x) => x.who === "you")!;
    expect(waiting.items[0]!.turnId).toBe(answerLine.id);
    expect(waiting.items[0]!.piece!.source.quote).toBe(answerLine.text);

    const done = t.preparation.finishInterview("setup");

    expect(done).toMatchObject({ finished: true, confirmed: 1, answers: 0, refused: [] });
    expect(t.preparation.piece(waiting.items[0]!.piece!.id)!.status).toBe("confirmed");
  });

  it("never offers a piece that cites no line of Kris's, or one the coach wrote itself", async () => {
    const t = await answered(writesFromAnswer({ turn: "turn:1" }));

    expect(t.preparation.interview("setup").items).toEqual([]);
    expect(t.preparation.listPieces().total).toBe(2);
  });

  it("never offers a piece with a number Kris didn't give", async () => {
    const t = await answered(writesFromAnswer({ text: "Built booking sites for 12 dental clinics", numberSource: "told" }));

    expect(t.preparation.interview("setup").items).toEqual([]);
  });

  it("can be removed before Finish; an updated piece goes back to what it said", async () => {
    const recorded: RecordedOutputs = {
      coachTurn: (input) => {
        if (!input.asked) return { reply: "", ask: "Anything between the clinic and the bank?", followUp: false, pieces: [], answer: null };
        const answer = input.asked.lines.filter((l) => l.who === "you").at(-1)!;
        const before = (input.asked.topic as Extract<CoachTopic, { kind: "gap" }>).after!;
        return {
          reply: "", ask: "", followUp: false, answer: null,
          pieces: [{
            turn: answer.id, updates: before.id, kind: "role", text: "", role: null, tags: [], angles: ["security"], numberSource: null, claim: "as-said", honest: null,
            entry: { title: before.title, organisation: before.organisation, city: "Sofia", start: "2020-07", end: null },
          }],
        };
      },
    };
    const t = await answered(recorded, "I started at Orbital Bank in July 2020, not March 2021.");
    const [updated] = t.preparation.interview("setup").items;
    expect([updated!.change, updated!.piece!.entry!.start, updated!.before!.entry!.start]).toEqual(["updated", "2020-07", "2021-03"]);

    t.preparation.removeInterviewItem(updated!.id);

    expect(t.preparation.piece(updated!.piece!.id)).toMatchObject({ status: "confirmed", entry: { start: "2021-03" } });
    expect(t.preparation.interview("setup").items).toEqual([]);
  });
});

describe("near-the-line pieces", () => {
  const precise = writesFromAnswer({ text: "Spent 33% of my week building a booking site for a dental clinic", numberSource: "estimate" });

  it("need their own decision before Finish confirms anything", async () => {
    const t = await answered(precise);
    const [piece] = t.preparation.interview("setup").items;
    expect(piece!.nearTheLine).toEqual({
      honest: "Spent about a third of my week building a booking site for a dental clinic",
      stronger: "Spent 33% of my week building a booking site for a dental clinic",
      why: 'You said "about a third". 33% is more precise than that: fine only if you\'d defend it when asked how it was measured.',
    });

    const refused = t.preparation.finishInterview("setup");
    expect(refused).toMatchObject({ finished: false, undecided: [piece!.id] });
    expect(t.preparation.piece(piece!.piece!.id)!.status).toBe("flagged");

    t.preparation.decideInterviewPiece(piece!.id, "honest");
    const done = t.preparation.finishInterview("setup");

    expect(done).toMatchObject({ finished: true, confirmed: 1 });
    expect(t.preparation.piece(piece!.piece!.id)).toMatchObject({ status: "confirmed", text: "Spent about a third of my week building a booking site for a dental clinic" });
  });
});

describe("a model timeout", () => {
  const timeout = () => Object.assign(new Error("The model host timed out."), { name: "TimeoutError" });

  it("keeps the typed answer as not sent yet, and tries again later", async () => {
    let down = false;
    const coach = writesFromAnswer().coachTurn as (input: CoachTurnInput) => CoachTurn;
    const recorded: RecordedOutputs = { coachTurn: (input) => (down ? timeout() : coach(input)) };
    const t = withRoles(recorded);
    t.preparation.startInterview();
    await t.preparation.interviewSettled();
    down = true;

    t.preparation.answerInterview("setup", "I freelanced: a booking site for a dental clinic in Varna.");
    await t.preparation.interviewSettled();

    const failed = t.preparation.interview("setup");
    expect(failed.status).toBe("failed");
    expect(failed.turns.at(-1)).toMatchObject({ who: "you", text: "I freelanced: a booking site for a dental clinic in Varna.", sent: false });
    expect(failed.failure).toEqual({ message: "The model host timed out.", failures: 1, retryAt: "2026-10-12T07:30:20.000Z" });
    expect(t.preparation.answerInterview("setup", "Something else").changed).toBe(false);

    down = false;
    t.preparation.retryInterview("setup");
    await t.preparation.interviewSettled();

    const sent = t.preparation.interview("setup");
    expect(sent.turns.filter((x) => x.who === "you")).toEqual([expect.objectContaining({ text: "I freelanced: a booking site for a dental clinic in Varna.", sent: true })]);
    expect(sent.items).toHaveLength(1);
  });

  it("resumes at the same question after the app restarts, with the answer still there", async () => {
    const db = memoryDb();
    const first = createTestPreparation({ db, writer: fakeWriter({ coachTurn: (input) => (input.asked ? timeout() : plainCoachTurn(input)) }) });
    first.preparation.savePiece(role("IT Support Technician", "Linden Clinics", "2019-01", "2020-06"));
    first.preparation.savePiece(role("Junior Security Analyst", "Orbital Bank", "2021-03", null));
    first.preparation.startInterview();
    await first.preparation.interviewSettled();
    first.preparation.answerInterview("setup", "I was travelling.");
    await first.preparation.interviewSettled();
    const question = first.preparation.interview("setup").question;

    const again = createTestPreparation({ db, writer: fakeWriter(writesFromAnswer()) });
    const resumed = again.preparation.startInterview();
    expect(resumed.question).toEqual(question);
    await again.preparation.interviewSettled();

    const after = again.preparation.interview("setup");
    expect(after.turns.filter((x) => x.who === "you")).toEqual([expect.objectContaining({ text: "I was travelling.", sent: true })]);
    expect(after.question?.kind).toBe("skill");
  });

  it("waits for the budget without losing the answer", async () => {
    const t = withRoles();
    t.preparation.startInterview();
    await t.preparation.interviewSettled();
    // Something else spends the rest of the month's budget.
    await t.budget.call({ task: "tailor-cv", estimateUsd: 0 }, async () => ({ costUsd: 10 }));

    t.preparation.answerInterview("setup", "I was travelling.");
    await t.preparation.interviewSettled();

    const waiting = t.preparation.interview("setup");
    expect(waiting.status).toBe("budget");
    expect(waiting.turns.at(-1)).toMatchObject({ text: "I was travelling.", sent: false });
  });
});

describe("questions Kris doesn't answer", () => {
  it("\"I don't remember\" moves on and writes nothing; a skipped question is kept for packages", async () => {
    const t = withRoles();
    t.preparation.startInterview();
    await t.preparation.interviewSettled();

    t.preparation.dontRemember("setup");
    await t.preparation.interviewSettled();
    t.preparation.skipQuestion("setup");
    await t.preparation.interviewSettled();

    const view = t.preparation.interview("setup");
    expect(view.items).toEqual([]);
    expect(view.scope.map((s) => [s.kind, s.done, s.total])).toEqual([["gap", 1, 1], ["skill", 1, 1], ["standard", 0, 6]]);
    expect(t.preparation.skippedQuestions().map((q) => q.key)).toEqual(["skill:security:Vulnerability scanning"]);
  });
});

describe("standard answers", () => {
  it("go to the answer bank when Kris finishes", async () => {
    const recorded: RecordedOutputs = {
      coachTurn: (input) => {
        if (!input.asked || input.asked.topic.kind !== "standard") return plainCoachTurn(input);
        const answer = input.asked.lines.filter((l) => l.who === "you").at(-1)!;
        return { reply: "", ask: "", followUp: false, pieces: [], answer: { turn: answer.id, text: "One month" } };
      },
    };
    const t = withRoles(recorded, []);
    t.preparation.startInterview();
    await t.preparation.interviewSettled();
    expect(t.preparation.interview("setup").question).toEqual({ key: "standard:right-to-work", kind: "standard" });
    t.preparation.skipQuestion("setup");
    await t.preparation.interviewSettled();

    t.preparation.answerInterview("setup", "One month's notice.");
    await t.preparation.interviewSettled();
    const done = t.preparation.finishInterview("setup");

    expect(done).toMatchObject({ finished: true, answers: 1 });
    expect(t.preparation.findAnswer("What is your notice period?", "en")?.fill).toEqual({ action: "fill", value: "One month" });
  });
});
