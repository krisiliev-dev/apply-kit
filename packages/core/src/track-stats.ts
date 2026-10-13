// Track's Stats (spec #24, "Stats rules"), computed from the tracker's own tables. Weeks run Monday to
// Sunday in Sofia time and Applications count by date applied, which is already the user's day in
// Sofia (YYYY-MM-DD), so week arithmetic is plain calendar arithmetic on those days.
import type { SqlDatabase } from "./ports.ts";

/** How many weeks the chart shows, this week included. */
const shownWeeks = 9;

export interface WeekCount {
  /** The Monday the week starts on (YYYY-MM-DD). */
  weekOf: string;
  count: number;
  /** This week, still running ("so far"). */
  current: boolean;
}

export interface TrackStats {
  /** The last 9 weeks, oldest first; the last one is this week. */
  weeks: WeekCount[];
  /** The median of the last 8 complete weeks (may be a half); 0 when there is none to go by. */
  pace: number;
  /** This week so far; a win only when it is above the pace. */
  thisWeek: { count: number; win: boolean };
  /**
   * Replies over Applications applied at least 14 days ago. `excluded` are the newer ones left out;
   * `rate` is null while none are old enough, and `countsFrom` then says the day the first one is.
   */
  responseRate: { replied: number; counted: number; excluded: number; rate: number | null; countsFrom: string | null };
}

type Row = Record<string, unknown>;

/** How old (in days) an Application must be to count in the response rate and What's working. */
const replyWindowDays = 14;
/**
 * A Status that only a reply moves an Application to. Until email matching exists, replies are these
 * manual moves (and an Application added by hand already at one of them); a withdrawal alone is none.
 */
const replyStatuses = ["screening", "interviewing", "offer", "accepted", "rejected"];

export function computeStats(db: SqlDatabase, today: string): TrackStats {
  const apps = db.prepare("SELECT id, applied_on FROM application WHERE removed_at IS NULL").all();
  const thisMonday = mondayOf(today);
  const perWeek = new Map<string, number>();
  for (const a of apps) {
    const w = mondayOf(String(a.applied_on));
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  const weeks: WeekCount[] = [];
  for (let i = shownWeeks - 1; i >= 0; i--) {
    const weekOf = addDays(thisMonday, -7 * i);
    weeks.push({ weekOf, count: perWeek.get(weekOf) ?? 0, current: i === 0 });
  }
  const pace = median(completeWeeks(perWeek, thisMonday));
  const count = weeks.at(-1)!.count;

  // An Application has a reply when any standing Event (not undone) moved it to a reply Status.
  const repliedIds = new Set((db.prepare(
    `SELECT DISTINCT application_id FROM application_event WHERE undone_at IS NULL AND kind IN ('created', 'status')
     AND to_status IN (${replyStatuses.map(() => "?").join(", ")})`,
  ).all(...replyStatuses)).map((r) => String(r.application_id)));
  const cutoff = addDays(today, -replyWindowDays);
  const old = apps.filter((a) => String(a.applied_on) <= cutoff);
  const young = apps.filter((a) => String(a.applied_on) > cutoff);
  const replied = old.filter((a) => repliedIds.has(String(a.id))).length;
  const firstYoung = young.map((a) => String(a.applied_on)).sort()[0];
  const responseRate = {
    replied, counted: old.length, excluded: young.length,
    rate: old.length ? replied / old.length : null,
    countsFrom: !old.length && firstYoung ? addDays(firstYoung, replyWindowDays) : null,
  };

  return { weeks, pace, thisWeek: { count, win: pace > 0 && count > pace }, responseRate };
}

/** How many complete weeks the pace is the median of. */
const paceWeeks = 8;

/** Counts of the 8 complete weeks before this one. */
function completeWeeks(perWeek: Map<string, number>, thisMonday: string): number[] {
  return Array.from({ length: paceWeeks }, (_, i) => perWeek.get(addDays(thisMonday, -7 * (i + 1))) ?? 0);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 ? s[Math.floor(mid)]! : (s[mid - 1]! + s[mid]!) / 2;
}

const asUtc = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = asUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}

/** The Monday of the week a day falls in. */
function mondayOf(day: string): string {
  const back = (asUtc(day).getUTCDay() + 6) % 7;
  return addDays(day, -back);
}
