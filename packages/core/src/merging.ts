// Merging Postings into Jobs, splitting wrong merges and choosing the target posting. The rules for
// "same job" live in matching.ts; this module applies them to the database.
//
// Identity: a Job's id is `job:${postingId}` of the Posting that created it, and never changes.
// Merging moves Postings (posting.job_id); the absorbed Job keeps its row with merged_into set, so
// its state and decisions survive and a split can restore it.
//
// State when two Jobs merge: the most recent decision Kris made on either wins (a Job still New
// adds nothing). If it came from the absorbed Job, the decision is attached to the surviving Job
// too, so undoing it restores the surviving Job's state from before the merge.
//
// Split: the Job keeps its id, state and decisions with the Posting it was created from (the
// posting Kris judged it by). Splitting another Posting moves it to its own Job; splitting the
// creating Posting moves all the others, together, to a Job of their own. Either way the moved
// Postings' old Job comes back as it was if they had one (otherwise a new Job, in New), and every
// separated pair is remembered so later checks never merge them again.
import type { SqlDatabase } from "./ports.ts";
import { locationsCompatible, matchKey, type MergeReason } from "./matching.ts";
import { adapters } from "./sources/registry.ts";
import { linkKey } from "./capture/links.ts";

interface PostingRow {
  id: string;
  source_id: string;
  job_id: string;
  url: string;
  location: string | null;
  match_key: string | null;
  first_seen_at: string;
}

interface JobRow {
  id: string;
  created_at: string;
  state: string;
  state_changed_at: string | null;
  pass_reason: string | null;
  pass_note: string | null;
  closed_how: string | null;
  merged_into: string | null;
  target_posting_id: string | null;
}

const postingCols = "id, source_id, job_id, url, location, match_key, first_seen_at";

function postingsOf(db: SqlDatabase, jobId: string): PostingRow[] {
  return db.prepare(`SELECT ${postingCols} FROM posting WHERE job_id = ? ORDER BY first_seen_at, id`).all(jobId) as unknown as PostingRow[];
}

function jobRow(db: SqlDatabase, jobId: string): JobRow | undefined {
  return db.prepare("SELECT * FROM job WHERE id = ?").get(jobId) as unknown as JobRow | undefined;
}

const older = (a: JobRow, b: JobRow) => a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id);

function wasSplit(db: SqlDatabase, a: string, b: string): boolean {
  const [x, y] = a < b ? [a, b] : [b, a];
  return !!db.prepare("SELECT 1 AS hit FROM posting_split WHERE a = ? AND b = ?").get(x, y);
}

/** Why `p` is the same job as `other`, or null if it isn't. */
function sameJob(p: PostingRow, other: PostingRow): MergeReason | null {
  if (p.url === other.url) return { rule: "same-link", url: p.url };
  if (p.match_key && p.match_key === other.match_key && locationsCompatible(p.location, other.location)) {
    const [company, title] = p.match_key.split("|") as [string, string];
    return { rule: "same-role", company, title };
  }
  return null;
}

/**
 * Whether `p` may join the Job holding `members`, and why. Every member must agree on location
 * (or share the link), none may come from the same Source, and none may have been split from it.
 */
function fits(db: SqlDatabase, p: PostingRow, members: PostingRow[]): MergeReason | null {
  let reason: MergeReason | null = null;
  for (const m of members) {
    if (m.source_id === p.source_id || wasSplit(db, p.id, m.id)) return null;
    const r = sameJob(p, m);
    if (r) reason ??= r;
    else if (!locationsCompatible(p.location, m.location)) return null;
  }
  return reason;
}

/** Stores a Posting's match key from its current title and company. */
export function refreshMatchKey(db: SqlDatabase, postingId: string, p: { title: string; company: string }): void {
  db.prepare("UPDATE posting SET match_key = ? WHERE id = ?").run(matchKey(p), postingId);
}

/** Stores a Posting's link key (what two links to the same job share), for lookups by link. */
export function refreshLinkKey(db: SqlDatabase, postingId: string, url: string): void {
  db.prepare("UPDATE posting SET link_key = ? WHERE id = ?").run(linkKey(url), postingId);
}

/** Fills link keys for Postings stored before they were kept. */
export function backfillLinkKeys(db: SqlDatabase): void {
  const rows = db.prepare("SELECT id, url FROM posting WHERE link_key IS NULL").all();
  if (rows.length === 0) return;
  db.exec("BEGIN");
  try {
    for (const r of rows) refreshLinkKey(db, String(r.id), String(r.url));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Fills match keys for Postings stored before merging existed. */
export function backfillMatchKeys(db: SqlDatabase): void {
  const rows = db.prepare("SELECT id, title, company FROM posting WHERE match_key IS NULL").all();
  for (const r of rows) refreshMatchKey(db, String(r.id), { title: String(r.title), company: String(r.company) });
}

/**
 * Merges a Posting that sits alone in its own Job with every Job it is the same as. When it
 * matches, the older Job keeps its id: the Posting joins an older Job, or a newer single-Posting
 * Job joins the Posting's. Postings already merged, split off into a group, or sharing a Job are
 * left alone. Deterministic: the result doesn't depend on which Source finished first.
 */
export function reconcile(db: SqlDatabase, postingId: string): void {
  const ownJobId = `job:${postingId}`;
  const own = jobRow(db, ownJobId);
  if (!own || own.merged_into) return;
  const members = postingsOf(db, ownJobId);
  if (members.length !== 1 || members[0]!.id !== postingId) return;
  const p = members[0]!;

  const candidates = candidateJobs(db, p, ownJobId);
  if (candidates.length === 0) return;
  const oldest = candidates[0]!;
  if (older(oldest.job, own)) {
    absorb(db, own, oldest.job, [[p, oldest.reason]]);
    return;
  }
  // This Posting's Job is the oldest: newer single-Posting Jobs that match join it, one by one.
  for (const c of candidates) {
    const theirs = postingsOf(db, c.job.id);
    if (theirs.length !== 1) continue;
    const reason = fits(db, theirs[0]!, postingsOf(db, ownJobId));
    if (reason) absorb(db, c.job, own, [[theirs[0]!, reason]]);
  }
}

/** Live Jobs (other than `exceptJobId`) that `p` fits, oldest first. */
function candidateJobs(db: SqlDatabase, p: PostingRow, exceptJobId: string): { job: JobRow; reason: MergeReason }[] {
  const jobIds = db.prepare(
    `SELECT DISTINCT p.job_id FROM posting p JOIN job j ON j.id = p.job_id
     WHERE p.job_id != ? AND j.merged_into IS NULL AND (p.url = ? OR (p.match_key IS NOT NULL AND p.match_key = ?))`,
  ).all(exceptJobId, p.url, p.match_key).map((r) => String(r.job_id));
  const out: { job: JobRow; reason: MergeReason }[] = [];
  for (const id of jobIds) {
    const reason = fits(db, p, postingsOf(db, id));
    if (reason) out.push({ job: jobRow(db, id)!, reason });
  }
  return out.sort((a, b) => (older(a.job, b.job) ? -1 : 1));
}

/** Moves every Posting of `from` into `into`, recording why, and settles the merged state. */
function absorb(db: SqlDatabase, from: JobRow, into: JobRow, reasons: [PostingRow, MergeReason][]): void {
  for (const [posting, reason] of reasons) {
    db.prepare("UPDATE posting SET job_id = ?, merge_reason = ? WHERE id = ?").run(into.id, JSON.stringify(reason), posting.id);
  }
  db.prepare("UPDATE posting SET job_id = ? WHERE job_id = ?").run(into.id, from.id);
  db.prepare("UPDATE job SET merged_into = ? WHERE id = ?").run(into.id, from.id);
  db.prepare("UPDATE job SET merged_into = ? WHERE merged_into = ?").run(into.id, from.id);
  settleState(db, from, into);
}

function settleState(db: SqlDatabase, from: JobRow, into: JobRow): void {
  if (from.state === "new") return;
  const fromWins = into.state === "new" || (from.state_changed_at ?? "") > (into.state_changed_at ?? "");
  if (!fromWins) return;
  const latest = db.prepare(
    "SELECT decision_id FROM decision_job WHERE job_id = ? AND undone_at IS NULL ORDER BY rowid DESC LIMIT 1",
  ).get(from.id);
  if (latest) {
    db.prepare(
      `INSERT OR IGNORE INTO decision_job (decision_id, job_id, prev_state, prev_changed_at, prev_pass_reason, prev_pass_note, prev_closed_how)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(String(latest.decision_id), into.id, into.state, into.state_changed_at, into.pass_reason, into.pass_note, into.closed_how);
  }
  db.prepare("UPDATE job SET state = ?, state_changed_at = ?, pass_reason = ?, pass_note = ?, closed_how = ? WHERE id = ?").run(
    from.state, from.state_changed_at, from.pass_reason, from.pass_note, from.closed_how, into.id,
  );
}

/** The live Job a (possibly merged) Job id now lives in, or undefined if there's no such Job. */
export function liveJobId(db: SqlDatabase, jobId: string): string | undefined {
  let row = jobRow(db, jobId);
  for (let hops = 0; row?.merged_into && hops < 100; hops++) row = jobRow(db, row.merged_into);
  return row && !row.merged_into ? row.id : undefined;
}

/** Separates a Posting from its Job (see the rules at the top). Returns both Jobs' ids. */
export function split(db: SqlDatabase, jobId: string, postingId: string, now: string): { jobIds: [string, string] } {
  const job = jobRow(db, jobId);
  if (!job || job.merged_into) throw new Error(`No job "${jobId}"`);
  const members = postingsOf(db, jobId);
  if (!members.some((m) => m.id === postingId)) throw new Error(`Posting "${postingId}" isn't part of job "${jobId}"`);
  if (members.length < 2) throw new Error("This job has only one posting: there is nothing to split");

  const moving = jobId === `job:${postingId}` ? members.filter((m) => m.id !== postingId) : members.filter((m) => m.id === postingId);
  const staying = members.filter((m) => !moving.includes(m));
  const anchor = moving[0]!;
  const newJobId = `job:${anchor.id}`;

  const existing = jobRow(db, newJobId);
  if (existing) {
    db.prepare("UPDATE job SET merged_into = NULL, target_posting_id = NULL WHERE id = ?").run(newJobId);
  } else {
    const p = db.prepare("SELECT title, company FROM posting WHERE id = ?").get(anchor.id)!;
    db.prepare("INSERT INTO job (id, title, company, state, created_at) VALUES (?, ?, ?, 'new', ?)").run(newJobId, String(p.title), String(p.company), now);
  }
  for (const m of moving) db.prepare("UPDATE posting SET job_id = ? WHERE id = ?").run(newJobId, m.id);
  db.prepare("UPDATE posting SET merge_reason = NULL WHERE id = ?").run(anchor.id);
  for (const m of moving) {
    for (const s of staying) {
      const [a, b] = m.id < s.id ? [m.id, s.id] : [s.id, m.id];
      db.prepare("INSERT OR IGNORE INTO posting_split (a, b, created_at) VALUES (?, ?, ?)").run(a, b, now);
    }
  }
  if (job.target_posting_id && moving.some((m) => m.id === job.target_posting_id)) {
    db.prepare("UPDATE job SET target_posting_id = NULL WHERE id = ?").run(jobId);
  }
  return { jobIds: [jobId, newJobId] };
}

/** Kris's choice of target posting for a Job: one of the Postings it shows (not one of a removed Source). */
export function setTarget(db: SqlDatabase, jobId: string, postingId: string): void {
  const job = jobRow(db, jobId);
  if (!job || job.merged_into) throw new Error(`No job "${jobId}"`);
  const member = db.prepare(`SELECT 1 AS hit FROM posting p WHERE p.id = ? AND p.job_id = ? AND ${shownPostingSql("p")}`).get(postingId, jobId);
  if (!member) throw new Error(`Posting "${postingId}" isn't part of job "${jobId}"`);
  db.prepare("UPDATE job SET target_posting_id = ? WHERE id = ?").run(postingId, jobId);
}

export interface TargetChoice {
  postingId: string;
  chosenBy: "default" | "you";
}

const atsKinds = Object.entries(adapters).filter(([, a]) => a.category === "ats").map(([kind]) => `'${kind}'`).join(", ");

/** SQL: the Posting `p` isn't from a removed Source. */
const fromLiveSource = (p: string) => `NOT EXISTS (SELECT 1 FROM source rs WHERE rs.id = ${p}.source_id AND rs.removed_at IS NOT NULL)`;

/**
 * SQL condition for a Posting (alias `p`) a Job shows: one from a Source on the watchlist, or, when
 * every Posting of its Job is from a removed Source (the removal closed it), all of them.
 */
export const shownPostingSql = (p: string) => `(${fromLiveSource(p)} OR NOT EXISTS (
  SELECT 1 FROM posting vp WHERE vp.job_id = ${p}.job_id AND ${fromLiveSource("vp")}))`;

/**
 * SQL for a Job's target posting id, given SQL for the Job's id: Kris's choice, else the company's
 * own page (the first Posting from an ATS Source, the company's own system), else the first Posting
 * seen. Postings of removed Sources are passed over while the Job has any other.
 */
export const targetPostingSql = (jobIdSql: string) => `COALESCE(
  (SELECT p.id FROM posting p JOIN job tj ON tj.id = p.job_id WHERE tj.id = ${jobIdSql} AND p.id = tj.target_posting_id AND ${shownPostingSql("p")}),
  (SELECT p.id FROM posting p JOIN source s ON s.id = p.source_id
    WHERE p.job_id = ${jobIdSql} AND s.kind IN (${atsKinds}) AND ${shownPostingSql("p")} ORDER BY p.first_seen_at, p.id LIMIT 1),
  (SELECT p.id FROM posting p WHERE p.job_id = ${jobIdSql} AND ${shownPostingSql("p")} ORDER BY p.first_seen_at, p.id LIMIT 1))`;

/** The target posting (see targetPostingSql) and whether Kris chose it. */
export function targetOf(db: SqlDatabase, jobId: string): TargetChoice {
  const row = db.prepare(`SELECT ${targetPostingSql("?1")} AS id, target_posting_id AS chosen FROM job WHERE id = ?1`).get(jobId);
  const postingId = String(row?.id);
  return { postingId, chosenBy: row?.chosen != null && row.chosen === row.id ? "you" : "default" };
}
