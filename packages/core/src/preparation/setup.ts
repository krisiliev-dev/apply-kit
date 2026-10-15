// Setup (ticket #55): the guided steps around the import (Import, Check drafts, Interview, Your
// search), where Kris stopped so a 30–45 minute setup can be split up, the check-drafts list with
// its filters and "Confirm N unflagged" per role, the search check pre-filled from the profile, and
// the finish. Flagged pieces (sources that disagree) are never confirmed in bulk.
import { angles, type Angle } from "../fit/angles.ts";
import type { Clock, SqlDatabase } from "../ports.ts";
import type { SearchSettings } from "../search-settings.ts";
import type { PieceGroup, ProfilePiece, ProfileStore, PieceProblem } from "./profile.ts";

export type SetupStep = "import" | "review" | "interview" | "search" | "done";
export const setupSteps: readonly SetupStep[] = ["import", "review", "interview", "search", "done"];

/** The check-drafts filters: to check (unconfirmed and flagged), flagged, confirmed, discarded. */
export type DraftFilter = "to-check" | "flagged" | "confirmed" | "discarded";
export const draftFilters: readonly DraftFilter[] = ["to-check", "flagged", "confirmed", "discarded"];

export interface DraftCounts {
  /** Pieces in the profile (not discarded), and how many are confirmed. */
  pieces: number;
  confirmed: number;
  /** Waiting for Kris: unconfirmed and flagged. */
  toCheck: number;
  flagged: number;
  discarded: number;
}

/** A role's (or education's, or no role's) pieces under the filter, with what Kris can do to the whole role. */
export interface DraftGroup extends PieceGroup {
  /** The role's pieces waiting for Kris, whatever the filter. */
  toCheck: number;
  /** Of those, the ones "Confirm N unflagged" confirms (flagged ones never are). */
  unflagged: number;
}

export interface DraftsToCheck {
  show: DraftFilter;
  groups: DraftGroup[];
  counts: DraftCounts;
}

export interface ConfirmGroupResult {
  /** Pieces confirmed now. */
  confirmed: number;
  /** Flagged pieces left waiting (never confirmed in bulk). */
  flagged: number;
  /** Pieces that couldn't be confirmed yet (a missing month, where a number comes from), each with why. */
  refused: { id: string; problems: PieceProblem[] }[];
}

export interface SetupProgress {
  /** Where Kris is, or stopped: the step to land on when Setup opens again. */
  step: SetupStep;
  /** Setup was never opened: Setup starts at Import. */
  started: boolean;
  /** When Kris last moved or changed something in Setup (for "You stopped … yesterday at 21:40"). */
  updatedAt: string | null;
  /** Kris skipped setup for a quick start; Setup stays open to come back to. */
  skipped: boolean;
  finishedAt: string | null;
  counts: DraftCounts;
}

export interface SetupStore {
  drafts(show?: DraftFilter): DraftsToCheck;
  confirmGroup(groupId: string): ConfirmGroupResult;
  progress(): SetupProgress;
  /** Kris moved to a step (or changed something on it): that's where Setup opens next time. */
  goTo(step: SetupStep): SetupProgress;
  skip(): SetupProgress;
  /** Kris did something in the step she's on: the time she stopped moves on. */
  touch(): void;
}

const waiting = (p: ProfilePiece) => p.status !== "confirmed";

export function createSetupStore({ db, clock, profile }: { db: SqlDatabase; clock: Clock; profile: ProfileStore }): SetupStore {
  const now = () => clock.now().toISOString();

  function counts(): DraftCounts {
    const pieces = profile.all();
    return {
      pieces: pieces.length,
      confirmed: pieces.filter((p) => p.status === "confirmed").length,
      toCheck: pieces.filter(waiting).length,
      flagged: pieces.filter((p) => p.status === "flagged").length,
      discarded: profile.discarded().length,
    };
  }

  function drafts(show: DraftFilter = "to-check"): DraftsToCheck {
    const pieces = profile.all();
    const shown = show === "discarded" ? profile.discarded()
      : pieces.filter((p) => (show === "to-check" ? waiting(p) : show === "flagged" ? p.status === "flagged" : p.status === "confirmed"));
    const byGroup = new Map(profile.grouped(pieces).map((g) => [g.id, g.pieces]));
    const groups = profile.grouped(shown).map((g) => {
      const all = byGroup.get(g.id) ?? [];
      return { ...g, toCheck: all.filter(waiting).length, unflagged: all.filter((p) => p.status === "unconfirmed").length };
    });
    return { show, groups, counts: counts() };
  }

  function confirmGroup(groupId: string): ConfirmGroupResult {
    const group = profile.grouped(profile.all()).find((g) => g.id === groupId);
    const result: ConfirmGroupResult = { confirmed: 0, flagged: 0, refused: [] };
    for (const p of group?.pieces ?? []) {
      if (p.status === "flagged") result.flagged++;
      if (p.status !== "unconfirmed") continue;
      const confirmed = profile.confirm(p.id);
      if (confirmed.saved) result.confirmed++;
      else result.refused.push({ id: p.id, problems: confirmed.problems });
    }
    touch();
    return result;
  }

  const row = () => db.prepare("SELECT * FROM setup_progress WHERE id = 1").get();

  function progress(): SetupProgress {
    const r = row();
    return {
      step: (r?.step as SetupStep | undefined) ?? "import",
      started: !!r,
      updatedAt: r ? String(r.updated_at) : null,
      skipped: Number(r?.skipped ?? 0) === 1,
      finishedAt: r?.finished_at == null ? null : String(r.finished_at),
      counts: counts(),
    };
  }

  function save(step: SetupStep, skipped: boolean) {
    const at = now();
    db.prepare(
      `INSERT INTO setup_progress (id, step, skipped, started_at, updated_at, finished_at) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET step = excluded.step, skipped = excluded.skipped, updated_at = excluded.updated_at,
         finished_at = COALESCE(setup_progress.finished_at, excluded.finished_at)`,
    ).run(step, skipped ? 1 : 0, at, at, step === "done" ? at : null);
  }

  function touch() {
    if (row()) db.prepare("UPDATE setup_progress SET updated_at = ? WHERE id = 1").run(now());
  }

  return {
    drafts,
    confirmGroup,
    progress,
    goTo(step) {
      save(step, false);
      return progress();
    },
    skip() {
      save(row() ? (String(row()!.step) as SetupStep) : "import", true);
      return progress();
    },
    touch,
  };
}

/** Work experience read from the role dates: months worked (overlapping roles counted once), and the angle with the most. */
export interface Experience {
  months: number;
  /** The angle whose roles cover the most months; null when no role has an angle. */
  angle: Angle | null;
}

/** The search settings Setup shows, filled from the profile while Kris hasn't saved her own. */
export interface SearchSuggestion {
  settings: SearchSettings;
  /** Kris saved search settings before: they're shown as they are. */
  saved: boolean;
  /** Null when no role has dates. */
  experience: Experience | null;
}

/** What the profile holds when setup ends. */
export interface SetupSummary {
  pieces: DraftCounts;
  angles: { count: number; thinnest: string | null };
  /** Standard and screening answers in the bank. */
  answerBank: number;
  /** Voice samples that could be read, and the voice rules learned from them. */
  voice: { samples: number; rules: number };
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const monthIndex = (m: string) => {
  const [, y, mm] = MONTH.exec(m) ?? [];
  return y ? Number(y) * 12 + Number(mm) - 1 : null;
};

/** Months covered by these roles: an ended role through its last month, a current one up to this month. */
function monthsOf(roles: ProfilePiece[], now: Date): number {
  const thisMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const covered = new Set<number>();
  for (const r of roles) {
    const start = r.entry ? monthIndex(r.entry.start) : null;
    if (start === null) continue;
    const end = r.entry!.end ? monthIndex(r.entry!.end) : thisMonth - 1;
    for (let m = start; end !== null && m <= end; m++) covered.add(m);
  }
  return covered.size;
}

export function experienceOf(pieces: ProfilePiece[], now: Date): Experience | null {
  const roles = pieces.filter((p) => p.kind === "role" && p.entry && MONTH.test(p.entry.start));
  if (roles.length === 0) return null;
  let angle: Angle | null = null;
  let most = 0;
  for (const a of angles) {
    const months = monthsOf(roles.filter((r) => r.angles.includes(a)), now);
    if (months > most) [angle, most] = [a, months];
  }
  return { months: monthsOf(roles, now), angle };
}

/** Jobs asking up to a year more than Kris has stay in the Feed: whole years, rounded up, plus one. */
export const maxYearsFor = (e: Experience) => Math.ceil(e.months / 12) + 1;
