// The master profile: profile pieces (roles, achievements, skills, education) with their tags,
// angles, source and status, grouped by the role they belong to. Everything tailoring draws from;
// nothing goes into a CV, letter or answer that isn't here. Stored in SQLite (ADR 0003).
// Free of Node-only imports: the UI imports its constants and labels as "@apply-kit/core/profile".
import type { Angle } from "../fit/angles.ts";
import { angles as allAngles } from "../fit/angles.ts";

export { angles } from "../fit/angles.ts";
export { angleRules } from "./angles.ts";
import type { Clock, SqlDatabase } from "../ports.ts";
import { asPercent, closest, quantities, within } from "./numbers.ts";

export type PieceKind = "role" | "achievement" | "skill" | "education";
export const pieceKinds: readonly PieceKind[] = ["role", "achievement", "skill", "education"];

/** Confirmed pieces are used everywhere; unconfirmed ones only where they came from; flagged ones wait for a decision. */
export type PieceStatus = "confirmed" | "unconfirmed" | "flagged";

/** Where a number in a piece comes from, so tailoring states it with the right confidence. */
export type NumberSource = "measured" | "estimate" | "told";
export const numberSources: readonly NumberSource[] = ["measured", "estimate", "told"];

/** A role's or an education entry's facts, always used exactly as stored. Months are "YYYY-MM". */
export interface PieceEntry {
  /** The job title, or the degree. */
  title: string;
  /** The employer, or the school. */
  organisation: string;
  city: string | null;
  start: string;
  /** Null while it's current. */
  end: string | null;
}

/** Where a piece came from: a file and the words it was drafted from, a conversation, or Kris by hand. */
export interface PieceSource {
  /** "CV-2025.pdf, page 1", "Coach interview", or "Added in Profile". */
  from: string;
  /** The source's own words, kept word for word; null for a piece Kris wrote herself. */
  quote: string | null;
}

export interface ProfilePiece {
  /** Bulgarian title or skill wording explicitly verified by the user. */
  bulgarian?: string;
  id: string;
  kind: PieceKind;
  /** What Kris did (an achievement), the skill, or a role's or education's description (may be empty). */
  text: string;
  /** Roles and education only. */
  entry: PieceEntry | null;
  /** The role or education this piece sits under, or null (a skill not tied to a role). */
  belongsTo: string | null;
  tags: string[];
  angles: Angle[];
  /** Set whenever the text has a number. */
  numberSource: NumberSource | null;
  status: PieceStatus;
  source: PieceSource;
  /** Other files that said the same, merged into this piece on import (see the import's merges). */
  alsoFrom: PieceSource[];
  /** Read by text recognition from a scan, which misreads: check it against the original. Cleared on Confirm. */
  checkThis: boolean;
  /** Set while the sources it came from disagree (the piece is flagged until Kris picks a version). */
  dispute: PieceDispute | null;
  createdAt: string;
  updatedAt: string;
}

/** One source's version of a piece its sources disagree about. */
export interface PieceVersion {
  from: string;
  quote: string | null;
  /** How that source words it (an achievement or skill), or the role's or education's facts. */
  text: string;
  entry: PieceEntry | null;
}

/** Sources that disagree about a piece: each version, the piece's own first. */
export interface PieceDispute {
  versions: PieceVersion[];
  /** Kris passed the question to the coach interview instead of picking now. */
  askCoach: boolean;
}

/** What Kris decided about a piece whose sources disagree: one version (its index) is true, or ask in the interview. */
export type DisputeChoice = { version: number } | { askCoach: true };

/** A new piece (no id) or an edit of one (its id). The source and status are kept on edit. */
export interface PieceInput {
  bulgarian?: string;
  id?: string;
  kind: PieceKind;
  text: string;
  entry?: PieceEntry | null;
  belongsTo?: string | null;
  tags?: string[];
  angles?: Angle[];
  numberSource?: NumberSource | null;
}

/** How a new piece came to be. Import, the coach and packages pass one; the Profile form adds pieces by hand. */
export interface PieceOrigin {
  from: string;
  quote: string | null;
  status?: PieceStatus;
  /** Read by text recognition (import): marked "check this". */
  checkThis?: boolean;
}

/** The form field a problem belongs to; title, organisation, start and end are a role's or education's. */
export type PieceField = "kind" | "text" | "title" | "organisation" | "start" | "end" | "belongsTo" | "numberSource";

/** One way to put a refused piece right, in one click: the whole new text. */
export interface PieceFix {
  label: string;
  text: string;
}

export interface PieceProblem {
  field: PieceField;
  message: string;
  /** Honest fixes for the text, when there are any. */
  fixes: PieceFix[];
}

export type SavePieceResult = { saved: true; piece: ProfilePiece } | { saved: false; problems: PieceProblem[] };

export interface PieceQuery {
  kind?: PieceKind;
  angle?: Angle;
  /** Matches the text, tags and a role's title, organisation and city, ignoring case. */
  search?: string;
}

/** The pieces under one role or education entry, or the ones tied to none. */
export interface PieceGroup {
  /** The role's or education's piece id, or "none". */
  id: string;
  /** "Security Analyst · Northwind Bank, Sofia · Mar 2022 – present", or "Skills and languages not tied to a role". */
  label: string;
  pieces: ProfilePiece[];
}

export interface PieceList {
  groups: PieceGroup[];
  /** Pieces in the whole profile, and how many of them are confirmed. */
  total: number;
  confirmed: number;
  /** Per type, among pieces matching the angle and search (for the type filter's counts). */
  byKind: Record<PieceKind, number>;
}

/**
 * What Profile holds and what waits for Kris, per section. The section counts add up to the nav
 * badge. Angles and voice count nothing until their tickets build them; the answer bank counts portal edits waiting for "keep new or old".
 */
export interface ProfileSummary {
  pieces: number;
  confirmed: number;
  needsYou: { masterProfile: number; angles: number; answerBank: number; voice: number };
  needsYouTotal: number;
  /** Of the master profile's, the pieces learned during packages (Profile › Learned during packages). */
  learned?: number;
}

/** An achievement is one sentence: this many characters at most. */
export const maxAchievementLength = 200;

export const unattachedGroupLabel = "Skills and languages not tied to a role";
const handSource: PieceSource = { from: "Added in Profile", quote: null };

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const monthLabel = (m: string) => {
  const [, y, mm] = MONTH.exec(m) ?? [];
  return y ? `${monthNames[Number(mm) - 1]} ${y}` : m;
};

/** "Security Analyst · Northwind Bank, Sofia · Mar 2022 – present". */
export function entryLabel(e: PieceEntry): string {
  const where = e.city ? `${e.organisation}, ${e.city}` : e.organisation;
  return `${e.title} · ${where} · ${monthLabel(e.start)} – ${e.end ? monthLabel(e.end) : "present"}`;
}

export interface ProfileStore {
  save(input: PieceInput, origin?: PieceOrigin): SavePieceResult;
  /** Another source words a drafted piece differently: the piece is flagged with every version, until Kris picks one. */
  dispute(id: string, version: PieceVersion): void;
  /** Kris picked the true version (it becomes the piece, unconfirmed and no longer flagged), or passed it to the coach. */
  resolveDispute(id: string, choice: DisputeChoice): SavePieceResult;
  /** Kris said a drafted piece is wrong: it leaves the profile but can be restored. */
  discard(id: string): ProfilePiece | null;
  restore(id: string): ProfilePiece | null;
  /** Discarded pieces, oldest first. */
  discarded(): ProfilePiece[];
  /** Undoes a Confirm: the piece waits to be checked again. */
  unconfirm(id: string): ProfilePiece | null;
  /** Every piece, discarded ones too (import merges a repeat into a discarded piece, so it stays discarded). */
  everything(): ProfilePiece[];
  sourceVersions(id: string): ProfilePiece[];
  /** These pieces grouped by role, as the list groups them (a discarded role still heads its pieces). */
  grouped(pieces: ProfilePiece[]): PieceGroup[];
  /** Kris checked the piece: it becomes confirmed, once it passes every check a confirmed piece must. */
  confirm(id: string): SavePieceResult;
  /**
   * Rewrites a piece from a new source (the coach, from Kris's answer): its content, source and status
   * change and a dispute ends, after the same checks as any save. A refused revision changes nothing.
   */
  revise(id: string, input: PieceInput, origin: PieceOrigin): SavePieceResult;
  /** Puts a piece back exactly as it was before (undoing a revision). */
  reinstate(piece: ProfilePiece): void;
  get(id: string): ProfilePiece | null;
  all(): ProfilePiece[];
  list(query?: PieceQuery): PieceList;
  remove(id: string): DeletedPiece;
  summary(): ProfileSummary;
}

/** Whether the piece was there to delete, and how many pieces under it (a role's) now belong to no role. */
export interface DeletedPiece {
  deleted: boolean;
  untied: number;
}

export function createProfileStore({ db, clock }: { db: SqlDatabase; clock: Clock }): ProfileStore {
  const rowToPiece = (r: Record<string, unknown>): ProfilePiece => ({
    ...(r.bulgarian ? { bulgarian: String(r.bulgarian) } : {}),
    id: String(r.id),
    kind: r.kind as PieceKind,
    text: String(r.text),
    entry: r.entry == null ? null : (JSON.parse(String(r.entry)) as PieceEntry),
    belongsTo: r.belongs_to == null ? null : String(r.belongs_to),
    tags: JSON.parse(String(r.tags)) as string[],
    angles: JSON.parse(String(r.angles)) as Angle[],
    numberSource: (r.number_source ?? null) as NumberSource | null,
    status: r.status as PieceStatus,
    source: { from: String(r.source_from), quote: r.source_quote == null ? null : String(r.source_quote) },
    alsoFrom: db.prepare(`SELECT source_from, source_quote FROM import_merge WHERE piece_id = ?
         UNION SELECT p.source_from, p.source_quote FROM profile_merge_source m JOIN profile_piece p ON p.id = m.piece_id WHERE m.into_id = ?
         UNION SELECT i.source_from, i.source_quote FROM profile_merge_source m JOIN import_merge i ON i.piece_id = m.piece_id WHERE m.into_id = ?`).all(String(r.id), String(r.id), String(r.id))
      .map((m) => ({ from: String(m.source_from), quote: m.source_quote == null ? null : String(m.source_quote) })),
    checkThis: Number(r.check_this ?? 0) === 1,
    dispute: r.dispute == null ? null : (JSON.parse(String(r.dispute)) as PieceDispute),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });

  const get = (id: string) => {
    const r = db.prepare("SELECT * FROM profile_piece WHERE id = ? AND discarded_at IS NULL").get(id);
    return r ? rowToPiece(r) : null;
  };
  const all = () => db.prepare("SELECT * FROM profile_piece WHERE discarded_at IS NULL ORDER BY rowid").all().map(rowToPiece);
  const discardedPiece = (id: string) => {
    const r = db.prepare("SELECT * FROM profile_piece WHERE id = ? AND discarded_at IS NOT NULL").get(id);
    return r ? rowToPiece(r) : null;
  };

  function save(input: PieceInput, origin?: PieceOrigin): SavePieceResult {
    const before = input.id ? get(input.id) : null;
    if (input.id && !before) return { saved: false, problems: [{ field: "kind", message: "This piece no longer exists. It may have been deleted.", fixes: [] }] };
    const hasEntry = input.kind === "role" || input.kind === "education";
    const translated = (typeof input.bulgarian === "string" ? input.bulgarian.trim() : before?.bulgarian) || undefined;
    const piece: ProfilePiece = {
      ...(!origin && (input.kind === "role" || input.kind === "skill") ? (translated ? { bulgarian: translated } : {}) : before?.bulgarian ? { bulgarian: before.bulgarian } : {}),
      id: before?.id ?? `piece:${crypto.randomUUID()}`,
      kind: input.kind,
      text: input.text.trim(),
      entry: hasEntry && input.entry ? cleanEntry(input.entry) : null,
      belongsTo: hasEntry || !input.belongsTo || !get(input.belongsTo)?.entry ? null : input.belongsTo,
      tags: uniqueTags(input.tags ?? []),
      angles: allAngles.filter((a) => (input.angles ?? []).includes(a)),
      numberSource: quantities(input.text).length > 0 ? (input.numberSource ?? null) : null,
      status: before?.status ?? origin?.status ?? "confirmed",
      source: before?.source ?? (origin ? { from: origin.from, quote: origin.quote } : handSource),
      alsoFrom: before?.alsoFrom ?? [],
      checkThis: before?.checkThis ?? origin?.checkThis ?? false,
      dispute: before?.dispute ?? null,
      createdAt: before?.createdAt ?? clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    };
    // A drafted piece waits for Kris: what only Kris can supply (the month, where a number comes from)
    // is asked for when it's confirmed. Its numbers are checked against its quote all the same.
    const strict = piece.status === "confirmed";
    const problems = [...required(piece, input, strict), ...check(piece, strict)];
    if (problems.length > 0) return { saved: false, problems };
    if (piece.bulgarian && piece.bulgarian.length > 200) return { saved: false, problems: [{ field: "text", message: "Keep the verified Bulgarian title or skill within 200 characters.", fixes: [] }] };
    write(piece);
    return { saved: true, piece };
  }

  function write(piece: ProfilePiece) {
    db.prepare(
      `INSERT INTO profile_piece (id, kind, text, entry, belongs_to, tags, angles, number_source, status, source_from, source_quote, check_this, dispute, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, text = excluded.text, entry = excluded.entry,
         belongs_to = excluded.belongs_to, tags = excluded.tags, angles = excluded.angles,
         number_source = excluded.number_source, status = excluded.status, source_from = excluded.source_from,
         source_quote = excluded.source_quote, check_this = excluded.check_this, dispute = excluded.dispute,
         updated_at = excluded.updated_at`,
    ).run(
      piece.id, piece.kind, piece.text, piece.entry ? JSON.stringify(piece.entry) : null, piece.belongsTo,
      JSON.stringify(piece.tags), JSON.stringify(piece.angles), piece.numberSource, piece.status,
      piece.source.from, piece.source.quote, piece.checkThis ? 1 : 0, piece.dispute ? JSON.stringify(piece.dispute) : null,
      piece.createdAt, piece.updatedAt,
    );
    db.prepare("UPDATE profile_piece SET bulgarian = ? WHERE id = ?").run(piece.bulgarian ?? null, piece.id);
  }

  function confirm(id: string): SavePieceResult {
    const before = get(id);
    if (!before) return { saved: false, problems: [{ field: "kind", message: "This piece no longer exists. It may have been deleted.", fixes: [] }] };
    if (before.dispute) return { saved: false, problems: [{ field: "text", message: "Your sources disagree about this piece. Pick the version that's true first.", fixes: [] }] };
    const piece: ProfilePiece = { ...before, status: "confirmed", checkThis: false, updatedAt: clock.now().toISOString() };
    const problems = [...required(piece, { ...piece }, true), ...check(piece, true)];
    if (problems.length > 0) return { saved: false, problems };
    write(piece);
    return { saved: true, piece };
  }

  function list(query: PieceQuery = {}): PieceList {
    const pieces = all();
    const heads = new Map(pieces.filter((p) => p.entry).map((p) => [p.id, p]));
    const matching = pieces.filter((p) => (!query.angle || p.angles.includes(query.angle)) && matchesSearch(p, query.search));
    const byKind = Object.fromEntries(pieceKinds.map((k) => [k, matching.filter((p) => p.kind === k).length])) as Record<PieceKind, number>;
    const shown = matching.filter((p) => !query.kind || p.kind === query.kind);

    return { groups: grouped(shown, heads), total: pieces.length, confirmed: pieces.filter((p) => p.status === "confirmed").length, byKind };
  }

  /** Pieces grouped under their role or education (roles first, current first), then the ones tied to none. */
  function grouped(shown: ProfilePiece[], heads = new Map(everything().filter((p) => p.entry).map((p) => [p.id, p]))): PieceGroup[] {
    const groupOf = (p: ProfilePiece) => (p.entry ? p.id : p.belongsTo && heads.has(p.belongsTo) ? p.belongsTo : "none");
    const order = [...heads.values()].sort(byEntry).map((h) => h.id).concat("none");
    return order
      .map((id) => ({
        id,
        label: id === "none" ? unattachedGroupLabel : entryLabel(heads.get(id)!.entry!),
        pieces: shown.filter((p) => groupOf(p) === id).sort(inGroup),
      }))
      .filter((g) => g.pieces.length > 0);
  }

  function remove(id: string): DeletedPiece {
    if (!get(id)) return { deleted: false, untied: 0 };
    db.exec("BEGIN");
    try {
      const untied = db.prepare("SELECT COUNT(*) AS n FROM profile_piece WHERE belongs_to = ?").get(id)?.n;
      db.prepare("UPDATE profile_piece SET belongs_to = NULL, updated_at = ? WHERE belongs_to = ?").run(clock.now().toISOString(), id);
      db.prepare("DELETE FROM profile_piece WHERE id = ?").run(id);
      db.exec("COMMIT");
      return { deleted: true, untied: Number(untied ?? 0) };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  function summary(): ProfileSummary {
    const rows = db.prepare("SELECT status, COUNT(*) AS n FROM profile_piece WHERE discarded_at IS NULL GROUP BY status").all();
    const count = (status: PieceStatus) => Number(rows.find((r) => r.status === status)?.n ?? 0);
    const needsYou = { masterProfile: count("unconfirmed") + count("flagged"), angles: 0, answerBank: 0, voice: 0 };
    return {
      pieces: count("confirmed") + needsYou.masterProfile,
      confirmed: count("confirmed"),
      needsYou,
      needsYouTotal: Object.values(needsYou).reduce((a, b) => a + b, 0),
    };
  }

  function dispute(id: string, version: PieceVersion) {
    const before = get(id);
    if (!before || before.status === "confirmed") return;
    const own: PieceVersion = { from: before.source.from, quote: before.source.quote, text: before.text, entry: before.entry };
    const versions = before.dispute?.versions ?? [own];
    if (versions.some((v) => v.from === version.from && v.quote === version.quote)) return;
    write({ ...before, status: "flagged", dispute: { versions: [...versions, version], askCoach: false }, updatedAt: clock.now().toISOString() });
  }

  function resolveDispute(id: string, choice: DisputeChoice): SavePieceResult {
    const before = get(id);
    const refuse = (message: string): SavePieceResult => ({ saved: false, problems: [{ field: "text", message, fixes: [] }] });
    if (!before) return refuse("This piece no longer exists. It may have been deleted.");
    if (!before.dispute) return refuse("Your sources don't disagree about this piece any more.");
    if ("askCoach" in choice) {
      const piece = { ...before, dispute: { ...before.dispute, askCoach: true }, updatedAt: clock.now().toISOString() };
      write(piece);
      return { saved: true, piece };
    }
    const v = before.dispute.versions[choice.version];
    if (!v) return refuse("That isn't one of the versions.");
    // The picked version becomes the piece, a drafted one Kris confirms like any other.
    const picked: ProfilePiece = {
      ...before, text: v.text, entry: v.entry, source: { from: v.from, quote: v.quote }, status: "unconfirmed", dispute: null,
      numberSource: quantities(v.text).length > 0 ? before.numberSource : null, updatedAt: clock.now().toISOString(),
    };
    write(picked);
    return { saved: true, piece: picked };
  }

  function discard(id: string) {
    const piece = get(id);
    if (!piece) return null;
    db.prepare("UPDATE profile_piece SET discarded_at = ?, updated_at = ? WHERE id = ?").run(clock.now().toISOString(), clock.now().toISOString(), id);
    return piece;
  }

  function restore(id: string) {
    if (!discardedPiece(id)) return null;
    db.prepare("UPDATE profile_piece SET discarded_at = NULL, updated_at = ? WHERE id = ?").run(clock.now().toISOString(), id);
    return get(id);
  }

  function unconfirm(id: string) {
    const piece = get(id);
    if (!piece || piece.status !== "confirmed") return piece;
    const back = { ...piece, status: "unconfirmed" as const, updatedAt: clock.now().toISOString() };
    write(back);
    return back;
  }

  function revise(id: string, input: PieceInput, origin: PieceOrigin): SavePieceResult {
    const before = get(id);
    if (!before) return { saved: false, problems: [{ field: "kind", message: "This piece no longer exists. It may have been deleted.", fixes: [] }] };
    // The new source and status first, so the save checks the text against the new source's words.
    write({ ...before, source: { from: origin.from, quote: origin.quote }, status: origin.status ?? "unconfirmed", dispute: null });
    const result = save({ ...input, id });
    if (!result.saved) write(before);
    return result;
  }

  const discarded = () => db.prepare("SELECT * FROM profile_piece WHERE discarded_at IS NOT NULL AND id NOT IN (SELECT piece_id FROM profile_merge_source) ORDER BY rowid").all().map(rowToPiece);
  const everything = () => db.prepare("SELECT * FROM profile_piece WHERE id NOT IN (SELECT piece_id FROM profile_merge_source) ORDER BY rowid").all().map(rowToPiece);

  const sourceVersions = (id: string) => db.prepare("SELECT p.* FROM profile_merge_source m JOIN profile_piece p ON p.id = m.piece_id WHERE m.into_id = ? ORDER BY p.rowid").all(id).map(rowToPiece);

  return { sourceVersions, save, revise, reinstate: write, confirm, get, all, list, remove, summary, dispute, resolveDispute, discard, restore, discarded, unconfirm, everything, grouped };
}

/** What every piece needs before it can be saved: its text, or a role's or education's facts. */
function required(piece: ProfilePiece, input: PieceInput, strict: boolean): PieceProblem[] {
  const problems: PieceProblem[] = [];
  const say = (field: PieceField, message: string) => problems.push({ field, message, fixes: [] });
  if (piece.kind === "achievement" && !piece.text) say("text", "Say what you did, in one sentence.");
  if (strict && piece.kind === "achievement" && piece.text.length > maxAchievementLength) {
    say("text", `Keep it to one sentence of ${maxAchievementLength} characters or fewer; split a longer story into pieces.`);
  }
  if (piece.kind === "skill" && !piece.text) say("text", "Name the skill.");
  if (piece.kind === "role" || piece.kind === "education") {
    const role = piece.kind === "role";
    const e = piece.entry ?? cleanEntry({ title: "", organisation: "", city: null, start: "", end: null });
    if (!e.title) say("title", role ? "Give the role's title." : "Give the degree or course.");
    if (!e.organisation) say("organisation", role ? "Give the employer." : "Give the school.");
    if (!strict) return problems;
    if (!MONTH.test(e.start)) say("start", "Give the start as a month and year.");
    if (e.end && !MONTH.test(e.end)) say("end", "Give the end as a month and year, or leave it empty if it's current.");
    else if (e.end && MONTH.test(e.start) && e.end < e.start) say("end", "The end can't be before the start.");
  } else if (input.belongsTo && !piece.belongsTo) {
    say("belongsTo", "That role is no longer in your profile. Pick another, or none.");
  }
  return problems;
}

/** The honesty checks: every number in the text is one its source gives (within favourable rounding). */
function check(piece: ProfilePiece, strict: boolean): PieceProblem[] {
  const problems: PieceProblem[] = [];
  const quote = piece.source.quote;
  if (quote) {
    const source = quantities(quote, { source: true });
    for (const claim of quantities(piece.text)) {
      if (source.some((q) => within(claim, q))) continue;
      const near = closest(claim, source);
      const replace = (by: string) => piece.text.slice(0, claim.index) + piece.text.slice(claim.index).replace(claim.raw, by);
      const fixes = near
        ? [near.raw, ...(near.kind === "proportion" && !near.raw.includes("%") ? [asPercent(near)] : [])].map((by) => ({ label: `Use "${by}"`, text: replace(by) }))
        : [{ label: "Use your source's words", text: quote }];
      problems.push({
        field: "text",
        message: near
          ? `Your source says "${near.raw}". ${claim.raw} is more than favourable rounding, and an interviewer asking how you measured it would catch it.`
          : `Your source doesn't give ${claim.raw}. Keep to the numbers you can point to; a new result belongs in its own piece.`,
        fixes,
      });
    }
  }
  if (strict && quantities(piece.text).length > 0 && !piece.numberSource) {
    problems.push({ field: "numberSource", message: "This piece has a number, so pick where it comes from.", fixes: [] });
  }
  return problems;
}

function cleanEntry(e: PieceEntry): PieceEntry {
  return { title: e.title.trim(), organisation: e.organisation.trim(), city: e.city?.trim() || null, start: e.start.trim(), end: e.end?.trim() || null };
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

function matchesSearch(p: ProfilePiece, search: string | undefined): boolean {
  const q = search?.trim().toLowerCase();
  if (!q) return true;
  const e = p.entry;
  return [p.text, ...p.tags, e?.title, e?.organisation, e?.city].some((s) => s?.toLowerCase().includes(q));
}

/** Roles before education, each reverse-chronological (current first). */
function byEntry(a: ProfilePiece, b: ProfilePiece): number {
  const rank = (p: ProfilePiece) => (p.kind === "role" ? 0 : 1);
  return rank(a) - rank(b) || (b.entry!.end ?? "9999").localeCompare(a.entry!.end ?? "9999") || b.entry!.start.localeCompare(a.entry!.start);
}

/** The role or education itself first, then achievements, then skills, oldest first (the sort is stable). */
function inGroup(a: ProfilePiece, b: ProfilePiece): number {
  const rank = (p: ProfilePiece) => (p.entry ? 0 : p.kind === "achievement" ? 1 : 2);
  return rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt);
}
