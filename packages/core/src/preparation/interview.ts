// The coach interview (ticket #57): phase B of setup, and a short session for a thin angle. The
// engine decides what is asked, in order: imported pieces that are disputed or unchecked, gaps of
// more than three months between roles (from their dates), skills Kris likely has but never wrote
// down (per angle), then standard answers for the answer bank. The writer only phrases each turn and
// turns Kris's answers into pieces, each citing the line of Kris's it came from; a piece that cites
// anything else, or states a number Kris didn't give, is never offered. Pieces wait, unconfirmed,
// until Kris finishes and confirms them in one list; a near-the-line one needs its own decision.
// Kris's answer is saved before it's sent, so a timeout or the budget loses nothing.
import type { AiBudget, BudgetInfo } from "../budget.ts";
import { angles as allAngles, type Angle } from "../fit/angles.ts";
import type { Clock, SqlDatabase } from "../ports.ts";
import { hasPhrase, words } from "../words.ts";
import type { CoachEntry, CoachLine, CoachTopic, CoachTurn, CoachTurnInput, Writer } from "../writing/writer.ts";
import type { AnswerInput, AnswerLanguage, AnswerMatch, AnswerOrigin, SaveAnswerResult } from "./answers.ts";
import { closest, quantities, within } from "./numbers.ts";
import type { PieceEntry, PieceInput, PieceKind, PieceProblem, ProfilePiece, ProfileStore } from "./profile.ts";

/** Every tunable number behind the interview, in one place. */
export const interviewRules = {
  /** A gap between roles is asked about when it is longer than this many months. */
  gapOverMonths: 3,
  /** At most this many likely-unwritten skills are asked about per angle. */
  skillsPerAngle: 4,
  /** A coach turn is tried this many times in all before the interview waits to try again. */
  attempts: 2,
  /** After a failed turn, the next try is this long away, doubling with each failure up to the most. */
  retryAfterMs: 20_000,
  retryAfterMostMs: 5 * 60_000,
} as const;

/** Where pieces the coach writes say they came from. */
export const interviewSource = "Coach interview";

export type InterviewQuestionKind = "check" | "gap" | "skill" | "standard";
export const interviewQuestionKinds: readonly InterviewQuestionKind[] = ["check", "gap", "skill", "standard"];

/**
 * Skills Kris likely has when her pieces mention one of `with`, but that no piece names (any of
 * `named`). Data, not logic: edit freely. Keep entries specific, so the coach asks sensible questions.
 */
export const likelySkills: Record<Angle, { skill: string; named: string[]; with: string[] }[]> = {
  developer: [
    { skill: "Payments (e.g. Stripe)", named: ["stripe", "payments", "payment", "paypal"], with: ["booking", "shop", "e-commerce", "ecommerce", "checkout", "store"] },
    { skill: "Calendar integrations", named: ["calendar"], with: ["booking", "appointments", "scheduling"] },
    { skill: "Automated testing", named: ["testing", "tests", "jest", "vitest", "playwright", "cypress"], with: ["react", "node", "typescript", "javascript", "api"] },
    { skill: "Git", named: ["git", "github", "gitlab"], with: ["react", "node", "python", "developer", "typescript", "javascript"] },
    { skill: "SQL databases", named: ["sql", "postgres", "postgresql", "mysql", "sqlite"], with: ["backend", "node", "api", "django", "booking"] },
  ],
  security: [
    { skill: "Incident response", named: ["incident response"], with: ["phishing", "incident", "incidents", "soc"] },
    { skill: "SIEM queries", named: ["siem", "kql", "spl"], with: ["splunk", "elastic", "sentinel", "soc"] },
    { skill: "Writing runbooks", named: ["runbook", "runbooks", "playbook", "playbooks"], with: ["soc", "incident", "phishing"] },
    { skill: "Email security", named: ["email security", "dmarc", "spf", "dkim"], with: ["phishing", "mailbox", "email"] },
    { skill: "Vulnerability scanning", named: ["vulnerability", "vulnerabilities", "nessus", "qualys"], with: ["security", "soc", "patching"] },
  ],
  design: [
    { skill: "Figma", named: ["figma"], with: ["design", "ui", "ux", "prototype", "prototypes", "wireframes"] },
    { skill: "User research", named: ["user research", "usability testing", "interviews"], with: ["ux", "users", "design"] },
    { skill: "Accessibility", named: ["accessibility", "wcag", "a11y"], with: ["ui", "frontend", "react", "design", "web"] },
    { skill: "Design systems", named: ["design system", "design systems", "component library"], with: ["ui", "components", "figma"] },
  ],
};

/** The standard answers the coach collects, each with the wordings portals use for it. */
export const coachStandardQuestions: { key: string; question: string; wordings: string[] }[] = [
  { key: "right-to-work", question: "Do you have the right to work in the EU?", wordings: ["Right to work", "Are you legally authorised to work in the EU?", "Work authorisation", "Право на работа"] },
  { key: "notice-period", question: "Notice period", wordings: ["What is your notice period?", "How much notice do you need to give?", "Срок на предизвестие"] },
  { key: "sponsorship", question: "Do you need visa sponsorship?", wordings: ["Will you require sponsorship?", "Visa sponsorship", "Do you require a work permit?"] },
  { key: "start-date", question: "When could you start?", wordings: ["Earliest start date", "Available from", "Start date", "Кога можете да започнете?"] },
  { key: "relocation", question: "Would you relocate?", wordings: ["Are you willing to relocate?", "Relocation", "Open to relocation"] },
  { key: "links", question: "Links to your work", wordings: ["Links", "Portfolio links", "Other links", "Additional links"] },
];

/** A question with its key, in the order the interview asks it. */
interface Scoped {
  key: string;
  topic: CoachTopic;
}

export type InterviewQuestionState = "open" | "answered" | "dont-remember" | "skipped";

/** One line of the transcript. Kris's answer is "not sent yet" until the coach has it. */
export interface InterviewTurn {
  id: string;
  who: "coach" | "you";
  text: string;
  sent: boolean;
  at: string;
}

/** A part of the interview's scope, as a chip: "Gaps in the timeline · 1 of 2". */
export interface InterviewScopePart {
  kind: InterviewQuestionKind;
  done: number;
  total: number;
  /** Asked now, finished, or still to come. */
  state: "current" | "done" | "next";
}

/** A near-the-line piece: what Kris said, what the piece says, and why it needs a conscious decision. */
export interface NearTheLine {
  /** The wording that keeps to what Kris said; null when there's none to offer. */
  honest: string | null;
  /** The piece's own wording, stronger than what Kris said. */
  stronger: string;
  why: string;
}

/** Something the interview wrote from Kris's answer, waiting for Finish. */
export interface InterviewItem {
  id: string;
  /** The line of Kris's it was written from. */
  turnId: string;
  type: "piece" | "answer";
  /** New, or an existing piece the coach updated (with what it said before). */
  change: "new" | "updated" | null;
  piece: ProfilePiece | null;
  before: { text: string; entry: PieceEntry | null } | null;
  nearTheLine: NearTheLine | null;
  /** Kris's decision on a near-the-line piece; null until she makes one. */
  decision: "honest" | "stronger" | null;
  /** A standard answer for the answer bank. */
  answer: { key: string; question: string; text: string } | null;
}

/**
 * Where the interview is: Kris's turn (asking), the coach writing, a failed turn (Kris's answer
 * kept, tried again at `failure.retryAt`), waiting for the AI budget, paused, or nothing left to ask.
 */
export type InterviewStatus = "asking" | "writing" | "failed" | "budget" | "paused" | "complete";

export interface InterviewView {
  /** "setup", or "angle:<angle>" for a session about one angle. */
  id: string;
  angle: Angle | null;
  status: InterviewStatus;
  /** The question being asked, or null when none is left. */
  question: { key: string; kind: InterviewQuestionKind } | null;
  scope: InterviewScopePart[];
  /** Questions not yet asked or answered, per kind (for "Left: 1 gap, 4 skill questions"). */
  left: Record<InterviewQuestionKind, number>;
  turns: InterviewTurn[];
  items: InterviewItem[];
  failure: { message: string; failures: number; retryAt: string | null } | null;
  budget: BudgetInfo;
  pausedAt: string | null;
  finishedAt: string | null;
}

export type InterviewChange = { changed: true; interview: InterviewView } | { changed: false; reason: string; interview: InterviewView };

export type FinishInterviewResult =
  | { finished: true; confirmed: number; answers: number; refused: { itemId: string; problems: { message: string }[] }[]; interview: InterviewView }
  | { finished: false; reason: string; undecided: string[]; interview: InterviewView };

/** A question Kris skipped, kept so a package can ask it when a job needs it. */
export interface SkippedQuestion {
  interviewId: string;
  key: string;
  kind: InterviewQuestionKind;
  topic: CoachTopic;
  skippedAt: string;
}

export interface InterviewDeps {
  db: SqlDatabase;
  clock: Clock;
  budget: AiBudget;
  writer: Writer;
  profile: ProfileStore;
  findAnswer(question: string, language: AnswerLanguage): AnswerMatch | null;
  saveAnswer(input: AnswerInput, origin?: AnswerOrigin): SaveAnswerResult;
}

export interface InterviewStore {
  start(angle?: Angle | null): InterviewView;
  view(id: string): InterviewView;
  answer(id: string, text: string): InterviewChange;
  dontRemember(id: string): InterviewChange;
  skip(id: string): InterviewChange;
  pause(id: string): InterviewView;
  retry(id: string): InterviewChange;
  decide(itemId: string, choice: "honest" | "stronger"): InterviewChange;
  remove(itemId: string): InterviewChange;
  editAnswer(itemId: string, text: string): InterviewChange;
  finish(id: string): FinishInterviewResult;
  settled(): Promise<void>;
  skipped(): SkippedQuestion[];
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const monthIndex = (m: string | null | undefined) => {
  const [, y, mm] = MONTH.exec(m ?? "") ?? [];
  return y ? Number(y) * 12 + Number(mm) - 1 : null;
};
const monthOf = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const hedged = (raw: string) => /^(about|around|roughly|nearly|almost|approximately|over|more than|under|less than|up to|около|над|почти|близо)\s/i.test(raw);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const idOf = (angle: Angle | null) => (angle ? `angle:${angle}` : "setup");
const angleOf = (id: string) => (allAngles as readonly string[]).find((a) => id === `angle:${a}`) as Angle | undefined;

const entryOf = (p: ProfilePiece): CoachEntry => ({
  id: p.id, kind: p.kind as "role" | "education", title: p.entry!.title, organisation: p.entry!.organisation, start: p.entry!.start, end: p.entry!.end,
});
const inputOf = (p: ProfilePiece): PieceInput => ({
  id: p.id, kind: p.kind, text: p.text, entry: p.entry, belongsTo: p.belongsTo, tags: p.tags, angles: p.angles, numberSource: p.numberSource,
});

/**
 * Whether a piece states more than Kris said: a number more precise than her estimate ("33%" for
 * "about a third"), or a claim the writer marked stronger. Null when it keeps to her words.
 */
export function nearTheLine(text: string, said: string, writer: { claim: "as-said" | "stronger"; honest: string | null }): NearTheLine | null {
  const source = quantities(said, { source: true });
  for (const claim of quantities(text)) {
    const near = closest(claim, source.filter((q) => within(claim, q)));
    if (!near || (near.value === claim.value && hedged(near.raw) === hedged(claim.raw))) continue;
    const honest = text.slice(0, claim.index) + text.slice(claim.index).replace(claim.raw, near.raw);
    return {
      honest,
      stronger: text,
      why: `You said "${near.raw}". ${claim.raw} is more precise than that: fine only if you'd defend it when asked how it was measured.`,
    };
  }
  if (writer.claim === "stronger") {
    return { honest: writer.honest, stronger: text, why: "This says more than your answer did. Keep it only if you'd defend it in an interview." };
  }
  return null;
}

export function createInterviewStore(deps: InterviewDeps): InterviewStore {
  const { db, clock, profile } = deps;
  const now = () => clock.now().toISOString();
  /** The coach turn being written, per interview. */
  const running = new Map<string, Promise<void>>();

  // ---------- what is asked ----------

  function scope(id: string): Scoped[] {
    const angle = angleOf(id) ?? null;
    const pieces = profile.all();
    const out: Scoped[] = [];

    // Imported pieces Kris hasn't confirmed: disputed ones first (those passed to the coach before the rest).
    const unchecked = pieces.filter((p) => p.status !== "confirmed" && p.source.from !== interviewSource && (!angle || p.angles.includes(angle)));
    const rank = (p: ProfilePiece) => (p.dispute?.askCoach ? 0 : p.dispute ? 1 : 2);
    for (const p of [...unchecked].sort((a, b) => rank(a) - rank(b))) {
      out.push({
        key: `check:${p.id}`,
        topic: {
          kind: "check",
          piece: {
            id: p.id, kind: p.kind, text: p.text, from: p.source.from, quote: p.source.quote,
            entry: p.entry ? { title: p.entry.title, organisation: p.entry.organisation, start: p.entry.start, end: p.entry.end } : null,
          },
          versions: (p.dispute?.versions ?? []).map((v) => ({ from: v.from, text: v.text || (v.entry ? `${v.entry.title}, ${v.entry.organisation}, ${v.entry.start} – ${v.entry.end ?? "present"}` : "") })),
        },
      });
    }

    if (!angle) out.push(...gaps(pieces));

    // Skills the profile suggests but never names, for the angles Kris has pieces in (or the one asked about).
    const inScope = angle ? [angle] : allAngles.filter((a) => pieces.some((p) => p.angles.includes(a)));
    const textOf = (p: ProfilePiece) => words([p.text, ...p.tags, p.entry?.title ?? ""].join(" "));
    const all = pieces.map((p) => ({ p, w: textOf(p) }));
    for (const a of inScope) {
      let n = 0;
      for (const s of likelySkills[a]) {
        if (n >= interviewRules.skillsPerAngle) break;
        if (all.some(({ w }) => s.named.some((x) => hasPhrase(w, x)))) continue;
        const suggestedBy = all.filter(({ w }) => s.with.some((x) => hasPhrase(w, x))).slice(0, 3).map(({ p }) => ({ id: p.id, text: p.text || (p.entry ? `${p.entry.title}, ${p.entry.organisation}` : "") }));
        if (suggestedBy.length === 0) continue;
        out.push({ key: `skill:${a}:${s.skill}`, topic: { kind: "skill", angle: a, skill: s.skill, suggestedBy } });
        n++;
      }
    }

    if (!angle) {
      for (const q of coachStandardQuestions) {
        if (deps.findAnswer(q.question, "en")) continue;
        out.push({ key: `standard:${q.key}`, topic: { kind: "standard", key: q.key, question: q.question } });
      }
    }
    return out;
  }

  /** Gaps of more than three months between roles, and since the last one ended (none while a role is current). */
  function gaps(pieces: ProfilePiece[]): Scoped[] {
    const thisMonth = clock.now().getUTCFullYear() * 12 + clock.now().getUTCMonth();
    const roles = pieces
      .filter((p) => p.kind === "role" && p.entry && monthIndex(p.entry.start) !== null)
      .map((p) => ({ p, start: monthIndex(p.entry!.start)!, end: p.entry!.end ? (monthIndex(p.entry!.end) ?? thisMonth) : thisMonth }))
      .sort((a, b) => a.start - b.start);
    const out: Scoped[] = [];
    let reach: (typeof roles)[number] | null = null;
    const gap = (from: number, to: number, before: ProfilePiece | null, after: ProfilePiece | null) => {
      const months = to - from + 1;
      if (months <= interviewRules.gapOverMonths) return;
      const topic: CoachTopic = { kind: "gap", from: monthOf(from), to: monthOf(to), months, before: before && entryOf(before), after: after && entryOf(after) };
      out.push({ key: `gap:${topic.from}:${topic.to}`, topic });
    };
    for (const r of roles) {
      if (reach && r.start > reach.end + 1) gap(reach.end + 1, r.start - 1, reach.p, r.p);
      if (!reach || r.end > reach.end) reach = r;
    }
    // Since the last role ended, up to last month.
    if (reach && reach.end < thisMonth && reach.p.entry!.end) gap(reach.end + 1, thisMonth - 1, reach.p, null);
    return out;
  }

  // ---------- storage ----------

  interface Row { id: string; angle: Angle | null; currentKey: string | null; pausedAt: string | null; finishedAt: string | null; failures: number; error: string | null; retryAt: string | null; budget: boolean }
  const row = (id: string): Row | null => {
    const r = db.prepare("SELECT * FROM interview WHERE id = ?").get(id);
    return r ? {
      id, angle: (r.angle ?? null) as Angle | null, currentKey: r.current_key == null ? null : String(r.current_key),
      pausedAt: r.paused_at == null ? null : String(r.paused_at), finishedAt: r.finished_at == null ? null : String(r.finished_at),
      failures: Number(r.failures), error: r.error == null ? null : String(r.error), retryAt: r.retry_at == null ? null : String(r.retry_at),
      budget: Number(r.waits_for_budget) === 1,
    } : null;
  };
  const update = (id: string, fields: Record<string, string | number | null>) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE interview SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]!), now(), id);
  };

  interface QuestionRow { key: string; kind: InterviewQuestionKind; topic: CoachTopic; state: InterviewQuestionState; endedAt: string | null }
  const questions = (id: string): QuestionRow[] =>
    db.prepare("SELECT * FROM interview_question WHERE interview_id = ? ORDER BY opened_at, rowid").all(id).map((r) => ({
      key: String(r.key), kind: r.kind as InterviewQuestionKind, topic: JSON.parse(String(r.topic)) as CoachTopic,
      state: r.state as InterviewQuestionState, endedAt: r.ended_at == null ? null : String(r.ended_at),
    }));
  const question = (id: string, key: string) => questions(id).find((q) => q.key === key) ?? null;
  const open = (id: string, s: Scoped) => {
    db.prepare("INSERT OR IGNORE INTO interview_question (interview_id, key, kind, topic, state, opened_at) VALUES (?, ?, ?, ?, 'open', ?)")
      .run(id, s.key, s.topic.kind, JSON.stringify(s.topic), now());
  };
  const end = (id: string, key: string, state: InterviewQuestionState) => {
    db.prepare("UPDATE interview_question SET state = ?, ended_at = ? WHERE interview_id = ? AND key = ?").run(state, now(), id, key);
  };

  interface TurnRow extends InterviewTurn { questionKey: string }
  const turns = (id: string): TurnRow[] =>
    db.prepare("SELECT * FROM interview_turn WHERE interview_id = ? ORDER BY seq").all(id).map((r) => ({
      id: String(r.id), who: r.who as "coach" | "you", text: String(r.text), sent: Number(r.sent) === 1, at: String(r.at), questionKey: String(r.question_key),
    }));
  const addTurn = (id: string, key: string, who: "coach" | "you", text: string, sent = true) => {
    const n = Number(db.prepare("SELECT COUNT(*) AS n FROM interview_turn").get()?.n ?? 0) + 1;
    const turnId = `turn:${n}`;
    db.prepare("INSERT INTO interview_turn (id, interview_id, question_key, who, text, sent, at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(turnId, id, key, who, text, sent ? 1 : 0, now());
    return turnId;
  };

  interface ItemRow { id: string; interviewId: string; turnId: string; type: "piece" | "answer"; pieceId: string | null; change: "new" | "updated" | null; before: ProfilePiece | null; near: NearTheLine | null; decision: "honest" | "stronger" | null; answer: InterviewItem["answer"] }
  const itemRow = (r: Record<string, unknown>): ItemRow => ({
    id: String(r.id), interviewId: String(r.interview_id), turnId: String(r.turn_id), type: r.type as "piece" | "answer",
    pieceId: r.piece_id == null ? null : String(r.piece_id), change: (r.change ?? null) as ItemRow["change"],
    before: r.before == null ? null : (JSON.parse(String(r.before)) as ProfilePiece), near: r.near == null ? null : (JSON.parse(String(r.near)) as NearTheLine),
    decision: (r.decision ?? null) as ItemRow["decision"], answer: r.answer == null ? null : (JSON.parse(String(r.answer)) as InterviewItem["answer"]),
  });
  const items = (id: string) => db.prepare("SELECT * FROM interview_item WHERE interview_id = ? AND removed_at IS NULL AND settled_at IS NULL ORDER BY created_at, rowid").all(id).map(itemRow);
  const item = (itemId: string) => {
    const r = db.prepare("SELECT * FROM interview_item WHERE id = ? AND removed_at IS NULL AND settled_at IS NULL").get(itemId);
    return r ? itemRow(r) : null;
  };
  const addItem = (id: string, fields: Omit<ItemRow, "id" | "interviewId" | "decision">) => {
    db.prepare("INSERT INTO interview_item (id, interview_id, turn_id, type, piece_id, change, before, near, answer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      `interview-item:${crypto.randomUUID()}`, id, fields.turnId, fields.type, fields.pieceId, fields.change,
      fields.before ? JSON.stringify(fields.before) : null, fields.near ? JSON.stringify(fields.near) : null,
      fields.answer ? JSON.stringify(fields.answer) : null, now(),
    );
  };

  // ---------- where the interview is ----------

  /** The first question in scope not yet ended, other than `except`. */
  function nextQuestion(id: string, except: string | null): Scoped | null {
    const ended = new Set(questions(id).filter((q) => q.state !== "open").map((q) => q.key));
    return scope(id).find((s) => !ended.has(s.key) && s.key !== except) ?? null;
  }

  /** What waits for the coach: Kris's answer not sent yet, or the current question not yet asked. */
  function pending(id: string): { type: "reply"; key: string } | { type: "ask"; key: string } | null {
    const r = row(id);
    if (!r?.currentKey) return null;
    const ts = turns(id).filter((t) => t.questionKey === r.currentKey);
    if (ts.some((t) => t.who === "you" && !t.sent)) return { type: "reply", key: r.currentKey };
    if (!ts.some((t) => t.who === "coach")) return { type: "ask", key: r.currentKey };
    return null;
  }

  /** Moves on to the next question in scope (or to none). */
  function moveOn(id: string, from: string | null): Scoped | null {
    const next = nextQuestion(id, from);
    if (next) open(id, next);
    update(id, { current_key: next?.key ?? null });
    return next;
  }

  const entries = () => profile.all().filter((p) => (p.kind === "role" || p.kind === "education") && p.entry).map(entryOf);

  /** Writes what waits for the coach, one turn after another, each tried twice; a failure waits to be tried again. */
  function kick(id: string): void {
    if (running.has(id) || row(id)?.budget) return;
    const run = (async () => {
      for (let p = pending(id); p; p = pending(id)) {
        const q = question(id, p.key)!;
        const ownLines = (): CoachLine[] => turns(id).filter((t) => t.questionKey === p!.key).map((t) => ({ id: t.id, who: t.who, text: t.text }));
        const next = p.type === "reply" ? nextQuestion(id, p.key) : null;
        const input: CoachTurnInput = p.type === "ask"
          ? { asked: null, next: q.topic, entries: entries() }
          : { asked: { topic: q.topic, lines: ownLines() }, next: next?.topic ?? null, entries: entries() };
        let error: string | null = null;
        let turn: CoachTurn | null = null;
        for (let tries = 0; tries < interviewRules.attempts && !turn; tries++) {
          try {
            const outcome = await deps.budget.call(
              { task: "coach-turn", estimateUsd: deps.writer.estimateCostUsd({ task: "coach-turn", input }) },
              () => deps.writer.coachTurn(input),
            );
            if (outcome.refused) {
              update(id, { waits_for_budget: 1 });
              return;
            }
            if (p.type === "ask" && !outcome.result.output.ask.trim()) throw new Error("The coach answered without a question.");
            turn = outcome.result.output;
          } catch (err) {
            error = message(err);
          }
        }
        if (!turn) {
          const failures = (row(id)?.failures ?? 0) + 1;
          const wait = Math.min(interviewRules.retryAfterMs * 2 ** (failures - 1), interviewRules.retryAfterMostMs);
          update(id, { failures, error, retry_at: new Date(clock.now().getTime() + wait).toISOString() });
          return;
        }
        update(id, { failures: 0, error: null, retry_at: null });
        if (p.type === "ask") addTurn(id, p.key, "coach", turn.ask.trim());
        else apply(id, p.key, next, turn);
      }
    })().catch((err: unknown) => {
      // Never leave the interview spinning: whatever broke, Kris's answer stays, ready for Try now.
      update(id, { failures: (row(id)?.failures ?? 0) + 1, error: message(err), retry_at: null });
    }).finally(() => running.delete(id));
    running.set(id, run);
  }

  /** The coach's turn on Kris's answer: the answer is sent, its pieces are written, and the interview moves on. */
  function apply(id: string, key: string, next: Scoped | null, turn: CoachTurn) {
    db.prepare("UPDATE interview_turn SET sent = 1 WHERE interview_id = ? AND question_key = ? AND who = 'you'").run(id, key);
    const q = question(id, key)!;
    const said = new Map(turns(id).filter((t) => t.questionKey === key && t.who === "you").map((t) => [t.id, t.text]));
    // The coach may update only what this question is about, or what this interview wrote.
    const mayUpdate = new Set([...topicPieces(q.topic), ...items(id).flatMap((i) => (i.pieceId ? [i.pieceId] : []))]);

    for (const w of turn.pieces) {
      const quote = said.get(w.turn);
      if (!quote) continue; // Cites nothing Kris said: never offered.
      const near = nearTheLine(w.text, quote, w);
      const origin = { from: interviewSource, quote, status: near ? ("flagged" as const) : ("unconfirmed" as const) };
      const input: PieceInput = { kind: w.kind as PieceKind, text: w.text, entry: w.entry, belongsTo: w.role, tags: w.tags, angles: w.angles, numberSource: w.numberSource };
      if (w.updates) {
        const before = mayUpdate.has(w.updates) ? profile.get(w.updates) : null;
        if (!before) continue;
        // Kris said it's right as it stands: the piece keeps its own source.
        const same = w.text.trim() === before.text && JSON.stringify(w.entry ?? null) === JSON.stringify(before.entry);
        const revised = profile.revise(before.id, { ...input, kind: before.kind }, same ? { ...origin, from: before.source.from, quote: before.source.quote } : origin);
        if (!revised.saved) continue;
        const earlier = items(id).find((i) => i.pieceId === before.id);
        if (earlier) db.prepare("UPDATE interview_item SET near = ?, decision = NULL WHERE id = ?").run(near ? JSON.stringify(near) : null, earlier.id);
        else addItem(id, { turnId: w.turn, type: "piece", pieceId: before.id, change: "updated", before, near, answer: null });
      } else {
        const saved = profile.save(input, origin);
        if (!saved.saved) continue; // A number Kris didn't give, or a piece missing what it needs: never offered.
        addItem(id, { turnId: w.turn, type: "piece", pieceId: saved.piece.id, change: "new", before: null, near, answer: null });
      }
    }
    if (turn.answer && q.topic.kind === "standard" && said.has(turn.answer.turn) && turn.answer.text.trim()) {
      const std = coachStandardQuestions.find((s) => s.key === (q.topic as { key: string }).key)!;
      addItem(id, { turnId: turn.answer.turn, type: "answer", pieceId: null, change: null, before: null, near: null, answer: { key: std.key, question: std.question, text: turn.answer.text.trim() } });
    }

    if (turn.reply.trim()) addTurn(id, key, "coach", turn.reply.trim());
    if (turn.followUp && turn.ask.trim()) {
      addTurn(id, key, "coach", turn.ask.trim());
      return;
    }
    end(id, key, "answered");
    if (next) open(id, next);
    update(id, { current_key: next?.key ?? null });
    if (next && turn.ask.trim()) addTurn(id, next.key, "coach", turn.ask.trim());
  }

  const topicPieces = (t: CoachTopic): string[] =>
    t.kind === "check" ? [t.piece.id]
    : t.kind === "gap" ? [t.before?.id, t.after?.id].filter((x): x is string => !!x)
    : t.kind === "skill" ? t.suggestedBy.map((s) => s.id)
    : [];

  // ---------- the view ----------

  function view(id: string): InterviewView {
    const r = row(id);
    const angle = angleOf(id) ?? null;
    const qs = questions(id);
    const ended = new Set(qs.filter((q) => q.state !== "open").map((q) => q.key));
    const todo = scope(id).filter((s) => !ended.has(s.key));
    const current = r?.currentKey ? qs.find((q) => q.key === r.currentKey) ?? null : null;
    if (current && !todo.some((s) => s.key === current.key)) todo.unshift({ key: current.key, topic: current.topic });
    const left = Object.fromEntries(interviewQuestionKinds.map((k) => [k, todo.filter((s) => s.topic.kind === k).length])) as Record<InterviewQuestionKind, number>;
    const scopeParts = interviewQuestionKinds.flatMap((kind): InterviewScopePart[] => {
      const done = qs.filter((q) => q.kind === kind && q.state !== "open").length;
      const total = done + left[kind];
      if (total === 0) return [];
      return [{ kind, done, total, state: current?.kind === kind ? "current" : left[kind] === 0 ? "done" : "next" }];
    });
    const waiting = pending(id);
    const writing = running.has(id);
    const status: InterviewStatus = writing ? "writing"
      : r?.budget && waiting ? "budget"
      : waiting ? "failed"
      : r?.pausedAt ? "paused"
      : current ? "asking"
      : "complete";
    return {
      id,
      angle,
      status,
      question: current ? { key: current.key, kind: current.kind } : null,
      scope: scopeParts,
      left,
      turns: turns(id).map((t) => ({ id: t.id, who: t.who, text: t.text, sent: t.sent, at: t.at })),
      items: items(id).map((i) => ({
        id: i.id, turnId: i.turnId, type: i.type, change: i.change,
        piece: i.pieceId ? profile.get(i.pieceId) : null,
        before: i.before ? { text: i.before.text, entry: i.before.entry } : null,
        nearTheLine: i.near, decision: i.decision, answer: i.answer,
      })).filter((i) => i.type === "answer" || i.piece),
      failure: status === "failed" ? { message: r?.error ?? "Not sent yet: the app stopped before the coach answered.", failures: r?.failures ?? 0, retryAt: r?.retryAt ?? null } : null,
      budget: deps.budget.info(),
      pausedAt: r?.pausedAt ?? null,
      finishedAt: r?.finishedAt ?? null,
    };
  }

  // ---------- what Kris does ----------

  function start(angle: Angle | null = null): InterviewView {
    const id = idOf(angle);
    if (!row(id)) {
      db.prepare("INSERT INTO interview (id, angle, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, angle, now(), now());
    } else {
      update(id, { paused_at: null, finished_at: null, waits_for_budget: 0 });
    }
    const r = row(id)!;
    const current = r.currentKey ? question(id, r.currentKey) : null;
    if (!current || current.state !== "open") moveOn(id, null);
    kick(id);
    return view(id);
  }

  /** Refuses while the coach is writing or Kris's last answer isn't sent yet; otherwise runs the change. */
  function onCurrent(id: string, change: (key: string) => void): InterviewChange {
    const r = row(id);
    const refuse = (reason: string): InterviewChange => ({ changed: false, reason, interview: view(id) });
    if (!r) return refuse("Start the interview first.");
    if (!r.currentKey) return refuse("There's nothing left to ask.");
    if (running.has(id)) return refuse("The coach is still writing. Wait a moment.");
    if (pending(id)?.type === "reply") return refuse("Your last answer isn't sent yet. Try now, or wait for the next try.");
    change(r.currentKey);
    update(id, { paused_at: null, waits_for_budget: 0 });
    kick(id);
    return { changed: true, interview: view(id) };
  }

  function answer(id: string, text: string): InterviewChange {
    const said = text.trim();
    if (!said) return { changed: false, reason: "Type your answer first, or choose \"I don't remember\".", interview: view(id) };
    return onCurrent(id, (key) => { addTurn(id, key, "you", said, false); });
  }

  function leave(id: string, state: "dont-remember" | "skipped", line: string): InterviewChange {
    return onCurrent(id, (key) => {
      addTurn(id, key, "you", line);
      end(id, key, state);
      moveOn(id, key);
    });
  }

  function retry(id: string): InterviewChange {
    if (!row(id)) return { changed: false, reason: "Start the interview first.", interview: view(id) };
    if (running.has(id)) return { changed: false, reason: "The coach is already writing.", interview: view(id) };
    if (!pending(id)) return { changed: false, reason: "Nothing is waiting to be sent.", interview: view(id) };
    update(id, { waits_for_budget: 0, retry_at: null });
    kick(id);
    return { changed: true, interview: view(id) };
  }

  function decide(itemId: string, choice: "honest" | "stronger"): InterviewChange {
    const i = item(itemId);
    if (!i) return { changed: false, reason: "That piece is no longer waiting.", interview: view("setup") };
    const piece = i.pieceId ? profile.get(i.pieceId) : null;
    if (!piece || !i.near) return { changed: false, reason: "That piece doesn't need a decision.", interview: view(i.interviewId) };
    if (choice === "honest" && !i.near.honest) return { changed: false, reason: "There's no other wording to keep.", interview: view(i.interviewId) };
    const text = choice === "honest" ? i.near.honest! : i.near.stronger;
    const revised = profile.revise(piece.id, { ...inputOf(piece), text }, { from: piece.source.from, quote: piece.source.quote, status: "unconfirmed" });
    if (!revised.saved) return { changed: false, reason: revised.problems[0]!.message, interview: view(i.interviewId) };
    db.prepare("UPDATE interview_item SET decision = ? WHERE id = ?").run(choice, itemId);
    return { changed: true, interview: view(i.interviewId) };
  }

  function remove(itemId: string): InterviewChange {
    const i = item(itemId);
    if (!i) return { changed: false, reason: "That is no longer waiting.", interview: view("setup") };
    if (i.type === "piece" && i.pieceId) {
      if (i.change === "updated" && i.before) profile.reinstate(i.before);
      else profile.remove(i.pieceId);
    }
    db.prepare("UPDATE interview_item SET removed_at = ? WHERE id = ?").run(now(), itemId);
    return { changed: true, interview: view(i.interviewId) };
  }

  function editAnswer(itemId: string, text: string): InterviewChange {
    const i = item(itemId);
    if (!i?.answer) return { changed: false, reason: "That answer is no longer waiting.", interview: view(i?.interviewId ?? "setup") };
    if (!text.trim()) return { changed: false, reason: "Give the answer, or remove it.", interview: view(i.interviewId) };
    db.prepare("UPDATE interview_item SET answer = ? WHERE id = ?").run(JSON.stringify({ ...i.answer, text: text.trim() }), itemId);
    return { changed: true, interview: view(i.interviewId) };
  }

  function finish(id: string): FinishInterviewResult {
    const waiting = items(id);
    const undecided = waiting.filter((i) => i.near && !i.decision && i.pieceId && profile.get(i.pieceId)).map((i) => i.id);
    if (undecided.length > 0) {
      return {
        finished: false,
        reason: undecided.length === 1 ? "One piece says more than your answer did: keep your wording or the stronger one first." : `${undecided.length} pieces say more than your answers did: decide each one first.`,
        undecided,
        interview: view(id),
      };
    }
    let confirmed = 0;
    let answers = 0;
    const refused: { itemId: string; problems: { message: string }[] }[] = [];
    for (const i of waiting) {
      if (i.type === "piece" && i.pieceId) {
        if (!profile.get(i.pieceId)) continue;
        const r = profile.confirm(i.pieceId);
        if (r.saved) confirmed++;
        else refused.push({ itemId: i.id, problems: r.problems.map((p: PieceProblem) => ({ message: p.message })) });
        if (!r.saved) continue;
      } else if (i.answer) {
        const std = coachStandardQuestions.find((s) => s.key === i.answer!.key);
        const r = deps.saveAnswer(
          { question: i.answer.question, wordings: std?.wordings ?? [], versions: { en: i.answer.text }, category: "standard", kind: "text", mode: "fill" },
          { from: interviewSource },
        );
        if (r.saved) answers++;
        else { refused.push({ itemId: i.id, problems: r.problems.map((p) => ({ message: p.message })) }); continue; }
      }
      db.prepare("UPDATE interview_item SET settled_at = ? WHERE id = ?").run(now(), i.id);
    }
    if (row(id)) update(id, { finished_at: now(), paused_at: null });
    return { finished: true, confirmed, answers, refused, interview: view(id) };
  }

  return {
    start,
    view,
    answer,
    dontRemember: (id) => leave(id, "dont-remember", "I don't remember."),
    skip: (id) => leave(id, "skipped", "Skip this question."),
    pause(id) {
      if (row(id)) update(id, { paused_at: now() });
      return view(id);
    },
    retry,
    decide,
    remove,
    editAnswer,
    finish,
    async settled() {
      while (running.size > 0) await Promise.all([...running.values()]);
    },
    skipped: () => db.prepare("SELECT * FROM interview_question WHERE state = 'skipped' ORDER BY ended_at, rowid").all().map((r) => ({
      interviewId: String(r.interview_id), key: String(r.key), kind: r.kind as InterviewQuestionKind,
      topic: JSON.parse(String(r.topic)) as CoachTopic, skippedAt: String(r.ended_at),
    })),
  };
}
