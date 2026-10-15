// The honesty validator (spec #51): a pure, deep module that holds every tailored CV the writer
// returns to the master profile, independent of the model's own claims. Hard rules: a line that
// breaks one is never offered; it falls back to its piece's own wording, with a tailoring note.
//
// - Roles: employers, titles and dates exactly as in the profile; a role that isn't there is left out.
// - Lines cite pieces that exist and are confirmed (or learned in this package); a bullet's pieces
//   belong to the role it sits under.
// - Skills: every skill listed is a skill piece; a line names nothing (a tool, an employer) that
//   isn't somewhere in the profile.
// - Numbers: every number is in the cited pieces, within the rounding their number source allows and
//   keeping the piece's hedge (not "30%" or "over 30%" for "nearly 30%", see `keepsHedge`); years of
//   experience are at most what the cited roles' dates add up to.
// - Soft rule: a "stronger" claim is a near-the-line edit. It is held back (the piece's wording is
//   used) and becomes a flag for Kris to decide (#64): the stronger draft is never offered, the
//   writer's honest wording is, once it passes the hard rules, and so is Kris's own (checkWording).
import type { TailoredCv, TailoredLine } from "../writing/writer.ts";
import { closest, exactly, quantities, within } from "./numbers.ts";
import type { NumberSource, ProfilePiece } from "./profile.ts";

export interface HonestyProfile {
  /** The whole master profile; only confirmed pieces (and `packagePieces`) may be used. */
  pieces: readonly ProfilePiece[];
  /** Unconfirmed pieces learned in this package, usable only in it. */
  packagePieces?: readonly string[];
  /** Names a line may use that aren't in the profile: the posting's company. */
  alsoNamed?: readonly string[];
  /** For years of experience from role dates. */
  now: Date;
}

export type HonestyRule = "role" | "skill" | "number" | "citation";

export interface HonestyProblem {
  rule: HonestyRule;
  /** What the draft did, finishing "The draft …": "names Kubernetes, which isn't in your profile". */
  message: string;
}

/** A line as the CV uses it. `kept` is set when the draft's wording wasn't used, and why. */
export interface ValidatedLine {
  text: string;
  pieceIds: string[];
  /** Why it changed from the profile ("" when it didn't, or when it fell back). */
  why: string;
  kept:
    | { reason: "failed"; draft: string; problems: HonestyProblem[] }
    | { reason: "near-the-line"; draft: string; problems: HonestyProblem[]; /** The writer's honest wording, when it passes the hard rules. */ honest: string | null }
    | null;
}

/** A stronger summary held back for Kris's decision (the angle's summary stays meanwhile). */
export interface HeldSummary {
  draft: string;
  honest: string | null;
  pieceIds: string[];
}

export interface ValidatedCv {
  /** Null when the draft's summary couldn't be used: the angle's own summary stays. */
  summary: ValidatedLine | null;
  /** Roles of the profile, in the draft's order, with their checked bullets. Facts come from the profile. */
  roles: { pieceId: string; bullets: ValidatedLine[]; why: string }[];
  /** Skill piece ids, in the draft's order. */
  skills: string[];
  /** Usable pieces the draft cited per posting requirement (by index). */
  evidence: { requirement: number; pieceIds: string[] }[];
  /** The draft's tailoring notes, then one for each correction. */
  notes: string[];
  /** How many times each hard rule caught the draft. */
  caught: Record<HonestyRule, number>;
  /** Stronger wordings held back for Kris's decision. */
  heldBack: number;
  heldSummary: HeldSummary | null;
  /** Every draft line the hard rules refused, word for word, where it was and why (for the tailoring evaluation). */
  rejected: RejectedLine[];
}

/** A draft line the hard rules refused: where it was ("Summary", "Bullet under Northwind Bank", "Role", "Skills"), its words and why. */
export interface RejectedLine {
  where: string;
  line: string;
  /** Each problem, finishing "The draft …". */
  problems: string[];
}

const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().replace(/[.;]$/, "").toLowerCase();

/** A line as a note quotes it: at most 57 characters, cut between words. */
export function quoteOf(text: string): string {
  const t = text.trim().replace(/\.$/, "");
  if (t.length <= 60) return t;
  let out = "";
  for (const word of t.split(" ")) {
    if ((out ? out.length + 1 : 0) + word.length > 57) break;
    out = out ? `${out} ${word}` : word;
  }
  return `${out}…`;
}

/** A piece's text as a CV line: no closing full stop. */
export const lineText = (p: ProfilePiece) => p.text.trim().replace(/\.$/, "");

// ---------------------------------------------------------------- names

const token = /[\p{L}\p{N}][\p{L}\p{N}+#./-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu;

/**
 * The words in a line that name something (a tool, an employer, a place): a capitalised word that
 * doesn't start a sentence, a word with capitals inside it ("SIEM", "PowerShell"), or letters and
 * digits mixed ("k3s"). Ordinary words, including the posting's term for the same thing, aren't names.
 */
function namesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(token)) {
    const w = m[0];
    if (w.length < 2 || /^[\p{N}.,]+$/u.test(w)) continue;
    const before = text.slice(0, m.index).trimEnd();
    const starts = before === "" || /[.!?:;(•–—-]$/.test(before);
    const inner = /\p{Lu}/u.test(w.slice(1));
    const mixed = /\p{L}/u.test(w) && /\p{N}/u.test(w) && !/^\d+(k|m|x|%)?$/i.test(w);
    if (inner || mixed || (/^\p{Lu}/u.test(w) && !starts)) out.push(w);
  }
  return out;
}

const wholeWord = (haystack: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(haystack);

// ---------------------------------------------------------------- numbers

/** How far a claim may round its piece's number, by where the number comes from. */
export const roundingRules: Record<NumberSource | "none", "favourable" | "exact"> = {
  /** Measured, or an estimate Kris would defend: favourable but plausible rounding (within a tenth). */
  measured: "favourable",
  estimate: "favourable",
  /** Someone told Kris: stated exactly as told. */
  told: "exact",
  /** No source given: exactly as written. */
  none: "exact",
};

const yearsAfter = /^\s*\+?\s*(?:years?|yrs|години|година)\b/iu;

/** Whole years the roles add up to (each from its start to its end, or to now). */
function yearsOf(roles: ProfilePiece[], now: Date): number {
  const month = (ym: string) => { const [y, m] = ym.split("-").map(Number); return y! * 12 + ((m ?? 1) - 1); };
  const nowM = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const months = roles.reduce((n, r) => n + Math.max(0, (r.entry!.end ? month(r.entry!.end) + 1 : nowM) - month(r.entry!.start)), 0);
  return Math.floor(months / 12);
}

// ---------------------------------------------------------------- one line

interface Context {
  usable: Map<string, ProfilePiece>;
  /** Everything in the profile a line may name, lower-cased. */
  vocabulary: string;
  now: Date;
}

/** The hard rules for one line against the pieces it cites (the role it sits under, for a bullet). */
function lineProblems(line: TailoredLine, ctx: Context): HonestyProblem[] {
  const problems: HonestyProblem[] = [];
  const cited = line.pieceIds.map((id) => ctx.usable.get(id));
  if (cited.some((p) => !p)) problems.push({ rule: "citation", message: "cites a piece that isn't confirmed in your profile" });
  const pieces = cited.filter((p): p is ProfilePiece => !!p);

  for (const name of namesIn(line.text)) {
    if (!wholeWord(ctx.vocabulary, name)) problems.push({ rule: "skill", message: `names "${name}", which isn't in your profile` });
  }

  const roles = [...new Set(pieces.flatMap((p) => (p.kind === "role" ? [p] : p.belongsTo && ctx.usable.get(p.belongsTo)?.kind === "role" ? [ctx.usable.get(p.belongsTo)!] : [])))];
  const allRoles = [...ctx.usable.values()].filter((p) => p.kind === "role" && p.entry);
  for (const q of quantities(line.text)) {
    const rest = line.text.slice(q.index + q.raw.length);
    const years = yearsAfter.exec(rest);
    if (years && q.kind === "count") {
      if (q.value > yearsOf(roles.length ? roles : allRoles, ctx.now)) {
        problems.push({ rule: "number", message: `says "${(q.raw + years[0]).trim()}", which its piece doesn't back` });
      }
      continue;
    }
    const backed = pieces.some((p) => {
      const source = closest(q, quantities(p.text, { source: true }));
      if (!source) return false;
      return roundingRules[p.numberSource ?? "none"] === "favourable" ? within(q, source) : exactly(q, source);
    });
    if (!backed) problems.push({ rule: "number", message: `says "${q.raw}", which its piece doesn't back` });
  }
  return problems;
}

// ---------------------------------------------------------------- the CV

function roleProblems(role: TailoredCv["roles"][number], entry: NonNullable<ProfilePiece["entry"]>): string[] {
  const changed: string[] = [];
  if (norm(role.employer) !== norm(entry.organisation)) changed.push("employer");
  if (norm(role.title) !== norm(entry.title)) changed.push("title");
  if (role.start.trim() !== entry.start || (role.end?.trim() || null) !== entry.end) changed.push("dates");
  return changed;
}

/** A role as the draft states it: "Title · Employer, 2022-03 – present". */
const roleLine = (r: TailoredCv["roles"][number]) => `${r.title.trim()} · ${r.employer.trim()}, ${r.start.trim()} – ${r.end?.trim() || "present"}`;

function contextOf(profile: HonestyProfile): Context {
  const usable = new Map(profile.pieces.filter((p) => p.status === "confirmed" || profile.packagePieces?.includes(p.id)).map((p) => [p.id, p]));
  const vocabulary = [
    ...[...usable.values()].flatMap((p) => [p.text, ...p.tags, ...(p.entry ? [p.entry.title, p.entry.organisation, p.entry.city ?? ""] : [])]),
    ...(profile.alsoNamed ?? []),
  ].join("\n").toLowerCase();
  return { usable, vocabulary, now: profile.now };
}

/**
 * The hard rules for one wording Kris (or the writer) offers for a line relying on these pieces:
 * every problem, finishing "The wording …". Empty when it can be used.
 */
export function checkWording(text: string, pieceIds: readonly string[], profile: HonestyProfile): HonestyProblem[] {
  if (!text.trim()) return [{ rule: "citation", message: "is empty" }];
  return lineProblems({ text: text.trim(), pieceIds: [...pieceIds], claim: "reworded", why: "", honest: null }, contextOf(profile));
}

/** The writer's honest wording for a stronger line: offered only when it passes and is neither the piece's words nor the draft's. */
function honestOf(line: TailoredLine, fallback: string | null, ctx: Context): string | null {
  const honest = line.honest?.trim();
  if (!honest || norm(honest) === norm(line.text) || (fallback !== null && norm(honest) === norm(fallback))) return null;
  return lineProblems({ ...line, text: honest }, ctx).length === 0 ? honest : null;
}

export function validateCv(output: TailoredCv, profile: HonestyProfile): ValidatedCv {
  const ctx = contextOf(profile);
  const { usable } = ctx;
  const notes = output.notes.map((n) => n.trim()).filter(Boolean);
  const caught: Record<HonestyRule, number> = { role: 0, skill: 0, number: 0, citation: 0 };
  let heldBack = 0;
  const rejected: RejectedLine[] = [];
  const refuse = (where: string, line: string, problems: string[]) => rejected.push({ where, line: line.trim(), problems });
  const under = (role: string | null) => `Bullet under ${(role && usable.get(role)?.entry?.organisation) || "a role"}`;

  /**
   * A checked line: the draft's words when they pass; otherwise the first cited piece's own words
   * (under `role`, only its achievements), or null when there's no piece to fall back to.
   */
  function check(line: TailoredLine, role: string | null): ValidatedLine | null {
    const problems = lineProblems(line, ctx);
    const own = line.pieceIds.map((id) => usable.get(id)).filter((p): p is ProfilePiece => !!p);
    if (role !== null && own.some((p) => p.kind === "achievement" && p.belongsTo !== role)) {
      caught.role += 1;
      refuse(under(role), line.text, ["puts it under a role it isn't from"]);
      notes.push(`Left out "${quoteOf(line.text)}": the draft puts it under a role it isn't from.`);
      return null;
    }
    const fallback = own.find((p) => p.kind === "achievement" && lineText(p));
    for (const p of problems) caught[p.rule] += 1;
    if (problems.length) refuse(under(role), line.text, problems.map((p) => p.message));
    else if (own.length === 0) refuse(under(role), line.text, ["cites no piece from your profile"]);
    if (problems.length === 0 && own.length > 0) {
      if (line.claim !== "stronger") return { text: line.text.trim(), pieceIds: own.map((p) => p.id), why: line.why.trim(), kept: null };
      if (role !== null && fallback) {
        heldBack += 1;
        notes.push(`Held back a stronger wording for "${quoteOf(lineText(fallback))}": your profile's words are used until you decide.`);
        return {
          text: lineText(fallback), pieceIds: [fallback.id], why: "",
          kept: { reason: "near-the-line", draft: line.text.trim(), problems: [], honest: honestOf(line, lineText(fallback), ctx) },
        };
      }
    }
    if (own.length === 0) {
      if (!problems.some((p) => p.rule === "citation")) caught.citation += 1;
      notes.push(`Left out "${quoteOf(line.text)}": the draft cites no piece from your profile.`);
      return null;
    }
    const why = problems[0]?.message ?? "holds a stronger wording back";
    if (role === null || !fallback) return null;
    notes.push(`Kept your profile's wording for "${quoteOf(lineText(fallback))}": the draft ${why}.`);
    return { text: lineText(fallback), pieceIds: [fallback.id], why: "", kept: { reason: "failed", draft: line.text.trim(), problems } };
  }

  const roles: ValidatedCv["roles"] = [];
  for (const role of output.roles) {
    const p = usable.get(role.pieceId);
    if (!p || p.kind !== "role" || !p.entry) {
      caught.role += 1;
      refuse("Role", roleLine(role), ["lists a role that isn't in your profile"]);
      notes.push(`The draft listed a role at ${role.employer.trim() || "an employer"}, which isn't in your profile. It was left out.`);
      continue;
    }
    const changed = roleProblems(role, p.entry);
    if (changed.length) {
      caught.role += 1;
      refuse("Role", roleLine(role), [`changes the ${changed.join(", ")}`]);
      notes.push(`The draft changed ${p.entry.title} at ${p.entry.organisation} (${changed.join(", ")}). The CV keeps it exactly as in your profile.`);
    }
    const bullets = role.bullets.map((b) => check(b, p.id)).filter((b): b is ValidatedLine => b !== null);
    roles.push({ pieceId: p.id, bullets, why: role.why.trim() });
  }

  // The summary: when the draft's can't be used, the angle's own summary stays.
  const summaryProblems = lineProblems(output.summary, ctx);
  const summaryPieces = output.summary.pieceIds.filter((id) => usable.has(id));
  let summary: ValidatedLine | null = null;
  let heldSummary: HeldSummary | null = null;
  if (summaryProblems.length || summaryPieces.length === 0) {
    for (const p of summaryProblems) caught[p.rule] += 1;
    if (summaryPieces.length === 0 && !summaryProblems.some((p) => p.rule === "citation")) caught.citation += 1;
    refuse("Summary", output.summary.text, summaryProblems.length ? summaryProblems.map((p) => p.message) : ["cites no piece from your profile"]);
    notes.push(`Kept your angle's summary: the draft ${summaryProblems[0]?.message ?? "cites no piece from your profile"}.`);
  } else if (output.summary.claim === "stronger") {
    heldBack += 1;
    heldSummary = { draft: output.summary.text.trim(), honest: honestOf(output.summary, null, ctx), pieceIds: summaryPieces };
    notes.push("Held back a stronger summary: your angle's summary is used until you decide.");
  } else {
    summary = { text: output.summary.text.trim(), pieceIds: summaryPieces, why: output.summary.why.trim(), kept: null };
  }

  // Skills: each must be a skill piece of the profile (by its words, whichever piece the draft cited).
  const skills: string[] = [];
  for (const skill of output.skills) {
    const own = [...usable.values()].filter((p) => p.kind === "skill" && norm(p.text) === norm(skill.text))
      .sort((a, b) => Number(skill.pieceIds.includes(b.id)) - Number(skill.pieceIds.includes(a.id)))[0];
    if (!own) {
      caught.skill += 1;
      refuse("Skills", skill.text, ["lists a skill that isn't in your profile"]);
      notes.push(`Left "${skill.text.trim()}" off the skills: it isn't a skill in your profile.`);
    } else if (!skills.includes(own.id)) skills.push(own.id);
  }

  const evidence = output.evidence
    .map((e) => ({ requirement: e.requirement, pieceIds: [...new Set(e.pieceIds.filter((id) => usable.has(id)))] }))
    .filter((e) => e.pieceIds.length > 0);

  return { summary, roles, skills, evidence, notes, caught, heldBack, heldSummary, rejected };
}
