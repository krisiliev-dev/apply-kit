// The master profile: profile pieces (roles, achievements, skills, education) with their tags,
// angles, source and status, grouped by the role they belong to. Everything tailoring draws from;
// nothing goes into a CV, letter or answer that isn't here. Stored in SQLite (ADR 0003).
import type { Angle } from "../fit/angles.ts";
import { angles as allAngles } from "../fit/angles.ts";
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
  createdAt: string;
  updatedAt: string;
}

/** A new piece (no id) or an edit of one (its id). The source and status are kept on edit. */
export interface PieceInput {
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
  get(id: string): ProfilePiece | null;
  all(): ProfilePiece[];
  list(query?: PieceQuery): PieceList;
  remove(id: string): boolean;
}

export function createProfileStore({ db, clock }: { db: SqlDatabase; clock: Clock }): ProfileStore {
  const rowToPiece = (r: Record<string, unknown>): ProfilePiece => ({
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
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });

  const get = (id: string) => {
    const r = db.prepare("SELECT * FROM profile_piece WHERE id = ?").get(id);
    return r ? rowToPiece(r) : null;
  };
  const all = () => db.prepare("SELECT * FROM profile_piece ORDER BY rowid").all().map(rowToPiece);

  function save(input: PieceInput, origin?: PieceOrigin): SavePieceResult {
    const before = input.id ? get(input.id) : null;
    if (input.id && !before) return { saved: false, problems: [{ field: "kind", message: "This piece no longer exists. It may have been deleted.", fixes: [] }] };
    const hasEntry = input.kind === "role" || input.kind === "education";
    const piece: ProfilePiece = {
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
      createdAt: before?.createdAt ?? clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    };
    const problems = [...required(piece, input), ...check(piece)];
    if (problems.length > 0) return { saved: false, problems };
    db.prepare(
      `INSERT INTO profile_piece (id, kind, text, entry, belongs_to, tags, angles, number_source, status, source_from, source_quote, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, text = excluded.text, entry = excluded.entry,
         belongs_to = excluded.belongs_to, tags = excluded.tags, angles = excluded.angles,
         number_source = excluded.number_source, updated_at = excluded.updated_at`,
    ).run(
      piece.id, piece.kind, piece.text, piece.entry ? JSON.stringify(piece.entry) : null, piece.belongsTo,
      JSON.stringify(piece.tags), JSON.stringify(piece.angles), piece.numberSource, piece.status,
      piece.source.from, piece.source.quote, piece.createdAt, piece.updatedAt,
    );
    return { saved: true, piece };
  }

  function list(query: PieceQuery = {}): PieceList {
    const pieces = all();
    const heads = new Map(pieces.filter((p) => p.entry).map((p) => [p.id, p]));
    const matching = pieces.filter((p) => (!query.angle || p.angles.includes(query.angle)) && matchesSearch(p, query.search));
    const byKind = Object.fromEntries(pieceKinds.map((k) => [k, matching.filter((p) => p.kind === k).length])) as Record<PieceKind, number>;
    const shown = matching.filter((p) => !query.kind || p.kind === query.kind);

    const groupOf = (p: ProfilePiece) => (p.entry ? p.id : p.belongsTo && heads.has(p.belongsTo) ? p.belongsTo : "none");
    const order = [...heads.values()].sort(byEntry).map((h) => h.id).concat("none");
    const groups = order
      .map((id) => ({
        id,
        label: id === "none" ? unattachedGroupLabel : entryLabel(heads.get(id)!.entry!),
        pieces: shown.filter((p) => groupOf(p) === id).sort(inGroup),
      }))
      .filter((g) => g.pieces.length > 0);
    return { groups, total: pieces.length, confirmed: pieces.filter((p) => p.status === "confirmed").length, byKind };
  }

  return { save, get, all, list, remove: () => false };
}

/** What every piece needs before it can be saved: its text, or a role's or education's facts. */
function required(piece: ProfilePiece, input: PieceInput): PieceProblem[] {
  const problems: PieceProblem[] = [];
  const say = (field: PieceField, message: string) => problems.push({ field, message, fixes: [] });
  if (piece.kind === "achievement" && !piece.text) say("text", "Say what you did, in one sentence.");
  if (piece.kind === "skill" && !piece.text) say("text", "Name the skill.");
  if (piece.kind === "role" || piece.kind === "education") {
    const role = piece.kind === "role";
    const e = piece.entry ?? cleanEntry({ title: "", organisation: "", city: null, start: "", end: null });
    if (!e.title) say("title", role ? "Give the role's title." : "Give the degree or course.");
    if (!e.organisation) say("organisation", role ? "Give the employer." : "Give the school.");
    if (!MONTH.test(e.start)) say("start", "Give the start as a month and year.");
    if (e.end && !MONTH.test(e.end)) say("end", "Give the end as a month and year, or leave it empty if it's current.");
    else if (e.end && MONTH.test(e.start) && e.end < e.start) say("end", "The end can't be before the start.");
  } else if (input.belongsTo && !piece.belongsTo) {
    say("belongsTo", "That role is no longer in your profile. Pick another, or none.");
  }
  return problems;
}

/** The honesty checks: every number in the text is one its source gives (within favourable rounding). */
function check(piece: ProfilePiece): PieceProblem[] {
  const problems: PieceProblem[] = [];
  const quote = piece.source.quote;
  if (quote) {
    const source = quantities(quote);
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
  if (quantities(piece.text).length > 0 && !piece.numberSource) {
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
