// Unusual drops: each Source learns its normal volume from its own Check history. A Check listing
// less than half the usual count is unusual: nothing it no longer lists is marked gone, so its Jobs
// stay open. After two more Checks just as low, Kris is asked to confirm (a Needs-you item); only
// his confirmation closes anything, and undoing it puts everything back.
//
// Failed Checks are ignored here: they neither count as low nor end a drop. Confirming a drop
// starts the normal volume afresh from the Checks after it, so the new level isn't a drop again.
import type { SqlDatabase } from "./ports.ts";

/** How many of a Source's latest good Checks its normal volume is learned from. */
const learnFrom = 14;
/** A Check listing less than this share of the usual count is an unusual drop. */
const dropShare = 0.5;
/** How many more Checks just as low before Kris is asked to confirm. */
export const confirmAfter = 2;

/** What a Source usually lists, learned from its latest good Checks that weren't drops. */
export interface NormalVolume {
  /** The median count per Check. */
  usual: number;
  /** The lowest and highest count in those Checks: the normal range. */
  low: number;
  high: number;
  /** How many Checks it was learned from. */
  checks: number;
}

/** The words for one drop, the same on the Feed and on Sources. */
export interface DropWording {
  /** "SumUp listed 0 jobs. It usually has 30–36." */
  headline: string;
  /** "Its 34 open jobs stay open: nothing closes on its own." */
  kept: string;
  /** What happens next if nobody acts. */
  next: string;
  /** The Needs-you question: "Are SumUp's 34 jobs really gone?" */
  question: string;
  /** The close button, with the count: "Close 34 SumUp jobs". */
  close: string;
}

/** A Source in an unusual drop that Kris hasn't confirmed. */
export interface UnusualDrop {
  sourceId: string;
  name: string;
  /** The first Check of the drop. */
  since: string;
  /** The latest Check, still as low. */
  latestAt: string;
  /** How many postings the latest Check listed. */
  listed: number;
  normal: NormalVolume;
  /** Checks just as low since the first one. At 2, Kris is asked. */
  checksSince: number;
  /** True once Kris is asked to confirm (a Needs-you item). Nothing closes until he does. */
  needsYou: boolean;
  /** Open Jobs this Source lists: every one stays open. */
  jobsKept: number;
  /** Open Jobs that confirming would close: those no other Source still lists. */
  closing: number;
  wording: DropWording;
}

/** The latest Check Kris's still-standing confirmation of a drop covered, or 0. */
function confirmedThrough(db: SqlDatabase, sourceId: string): number {
  const row = db.prepare("SELECT MAX(check_id) AS id FROM drop_confirmation WHERE source_id = ? AND undone_at IS NULL").get(sourceId);
  return Number(row?.id ?? 0);
}

export function normalVolume(db: SqlDatabase, sourceId: string): NormalVolume | null {
  const totals = db.prepare(
    `SELECT total FROM source_check WHERE source_id = ? AND outcome = 'ok' AND unusual = 0 AND id > ?
     ORDER BY id DESC LIMIT ${learnFrom}`,
  ).all(sourceId, confirmedThrough(db, sourceId)).map((r) => Number(r.total));
  if (totals.length === 0) return null;
  const sorted = [...totals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const usual = Math.round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
  return { usual, low: sorted[0]!, high: sorted.at(-1)!, checks: totals.length };
}

/** Whether a Check listing `total` postings is an unusual drop for this Source (asked before it is recorded). */
export function isDrop(db: SqlDatabase, sourceId: string, total: number): boolean {
  const normal = normalVolume(db, sourceId);
  return normal != null && total < normal.usual * dropShare;
}

/** The drop a Source is in, without counts of Jobs, or null. */
export function currentDrop(db: SqlDatabase, sourceId: string) {
  const after = confirmedThrough(db, sourceId);
  const checks = db.prepare(
    `SELECT id, checked_at, total, unusual FROM source_check WHERE source_id = ? AND outcome = 'ok' AND id > ?
     ORDER BY id DESC LIMIT 200`,
  ).all(sourceId, after);
  const run: Record<string, unknown>[] = [];
  for (const c of checks) {
    if (Number(c.unusual) !== 1) break;
    run.push(c);
  }
  const latest = run[0];
  const normal = normalVolume(db, sourceId);
  if (!latest || !normal) return null;
  return {
    sourceId,
    since: String(run.at(-1)!.checked_at),
    latestAt: String(latest.checked_at),
    latestCheckId: Number(latest.id),
    listed: Number(latest.total),
    normal,
    checksSince: run.length - 1,
    needsYou: run.length - 1 >= confirmAfter,
  };
}

const jobsWord = (n: number) => (n === 1 ? "job" : "jobs");

export function dropWording(d: { name: string; listed: number; normal: NormalVolume; checksSince: number; needsYou: boolean; jobsKept: number; closing: number }): DropWording {
  const range = d.normal.low === d.normal.high ? `${d.normal.usual}` : `${d.normal.low}–${d.normal.high}`;
  const left = confirmAfter - d.checksSince;
  return {
    headline: `${d.name} listed ${d.listed} ${jobsWord(d.listed)}. It usually has ${range}.`,
    kept: `Its ${d.jobsKept} open ${jobsWord(d.jobsKept)} ${d.jobsKept === 1 ? "stays" : "stay"} open: nothing closes on its own.`,
    next: d.needsYou
      ? `${d.name} has been this low for ${d.checksSince + 1} checks in a row, so you're asked to confirm.`
      : `If the next ${left === 1 ? "check is" : `${left} checks are`} just as low, a Needs-you item asks you to confirm.`,
    question: `Are ${d.name}'s ${d.closing} ${jobsWord(d.closing)} really gone?`,
    close: `Close ${d.closing} ${d.name} ${jobsWord(d.closing)}`,
  };
}
