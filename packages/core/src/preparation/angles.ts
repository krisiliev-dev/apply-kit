// Angles: the three framings of the master profile (developer, security, design) that tailoring
// starts from. Each has a summary line and an ordered list of the pieces that lead; a package picks
// the closest one for its Job. Stored in SQLite (ADR 0003). Every tunable number is in `angleRules`.
import { angleKeywords, angleLabel, angles, type Angle } from "../fit/angles.ts";
import { fitWeights } from "../fit/weights.ts";
import type { Clock, SqlDatabase } from "../ports.ts";
import { phrasesIn, words } from "../words.ts";
import type { ProfilePiece } from "./profile.ts";

/** Every tunable number behind angles, in one place. Starting guesses: tune them against real packages. */
export const angleRules = {
  /**
   * A thin angle: fewer confirmed pieces than `minPieces`, or fewer than `minWithResult` of them with a
   * result (a number: measured, an estimate, or something someone told Kris). Either makes it thin.
   */
  thin: { minPieces: 10, minWithResult: 3 },
  /** How many pieces lead an angle until Kris orders them himself. */
  defaultLeads: 4,
  /** A summary line is one or two sentences: this many characters at most. */
  maxSummaryLength: 300,
  /** The closest angle: Discover's keyword score (as in Fit), plus this much per piece tag the posting names. */
  closest: { perTag: fitWeights.angle.perExtraWord },
} as const;

/** What the closest angle is chosen from: a Job's title and requirements (a JobDetail fits). */
export interface AnglePosting {
  title: string;
  titleTranslation: string | null;
  requirements: { text: string }[];
}

/** The angle a package starts from, why, and what it starts with. */
export interface AngleChoice {
  angle: Angle;
  /** Why, in plain words: what in the posting points to it. */
  reason: string;
  summary: string;
  /** The pieces that lead, in Kris's order. */
  leads: ProfilePiece[];
}

/** A new summary line, a new lead order (piece ids), or both; what's left out stays as it was. */
export interface SaveAngleInput {
  angle: Angle;
  summary?: string;
  leads?: string[];
}

export interface AngleProblem {
  field: "summary" | "leads";
  message: string;
}

export type SaveAngleResult = { saved: true; angle: AngleView } | { saved: false; problems: AngleProblem[] };

/** One angle as Profile shows it and a package starts from it. */
export interface AngleView {
  angle: Angle;
  label: string;
  /** The line a CV's summary starts from; empty until Kris writes one. */
  summary: string;
  /** The pieces that lead, in order. */
  leads: ProfilePiece[];
  /** Confirmed pieces with this angle: what tailoring from it can use. */
  available: number;
  /** How many packages started from it. */
  packagesUsed: number;
  /** Set when the angle is thin (see `angleRules.thin`), with the reason. */
  thin: { reason: string } | null;
}

export interface AngleStore {
  list(): AngleView[];
  save(input: SaveAngleInput): SaveAngleResult;
  closest(posting: AnglePosting): AngleChoice;
}

export function createAngleStore({ db, clock, pieces }: { db: SqlDatabase; clock: Clock; pieces: () => ProfilePiece[] }): AngleStore {
  /** Confirmed pieces of an angle: what tailoring from it can use. */
  const available = (angle: Angle) => pieces().filter((p) => p.status === "confirmed" && p.angles.includes(angle));

  const stored = (angle: Angle) => {
    const r = db.prepare("SELECT summary, leads FROM angle WHERE angle = ?").get(angle);
    return { summary: r ? String(r.summary) : "", leads: r?.leads == null ? null : (JSON.parse(String(r.leads)) as string[]) };
  };

  function view(angle: Angle): AngleView {
    const mine = available(angle);
    const { summary, leads } = stored(angle);
    const byId = new Map(mine.map((p) => [p.id, p]));
    return {
      angle,
      label: angleLabel[angle],
      summary,
      // Kris's order, without pieces deleted or taken off the angle since; the default order until he sets one.
      leads: leads ? leads.flatMap((id) => byId.get(id) ?? []) : [...mine].sort(leadFirst).slice(0, angleRules.defaultLeads),
      available: mine.length,
      packagesUsed: 0,
      thin: thinness(mine),
    };
  }

  function save(input: SaveAngleInput): SaveAngleResult {
    const before = stored(input.angle);
    const summary = input.summary === undefined ? before.summary : input.summary.trim();
    const leads = input.leads === undefined ? before.leads : [...new Set(input.leads)];
    const problems: AngleProblem[] = [];
    if (summary.length > angleRules.maxSummaryLength) {
      problems.push({ field: "summary", message: `Keep the summary line to ${angleRules.maxSummaryLength} characters or fewer.` });
    }
    const ids = new Set(available(input.angle).map((p) => p.id));
    if (input.leads && leads!.some((id) => !ids.has(id))) {
      problems.push({ field: "leads", message: `Only confirmed ${input.angle} pieces can lead this angle. One of these was deleted, taken off the angle or isn't confirmed yet.` });
    }
    if (problems.length > 0) return { saved: false, problems };
    db.prepare(
      `INSERT INTO angle (angle, summary, leads, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(angle) DO UPDATE SET summary = excluded.summary, leads = excluded.leads, updated_at = excluded.updated_at`,
    ).run(input.angle, summary, leads ? JSON.stringify(leads) : null, clock.now().toISOString());
    return { saved: true, angle: view(input.angle) };
  }

  function closest(posting: AnglePosting): AngleChoice {
    const titleWords = words(`${posting.title} ${posting.titleTranslation ?? ""}`);
    const allWords = [...titleWords, ",", ...words(posting.requirements.map((r) => r.text).join(" , "))];
    const W = fitWeights.angle;
    const scored = angles.map((angle) => {
      const inTitle = phrasesIn(titleWords, angleKeywords[angle]);
      const said = [...inTitle, ...phrasesIn(allWords, angleKeywords[angle]).filter((p) => !inTitle.includes(p))];
      const saidWords = new Set(said.map((s) => s.toLowerCase()));
      const tags = [...new Map(available(angle).flatMap((p) => p.tags).map((t) => [t.toLowerCase(), t])).values()];
      const tagged = phrasesIn(allWords, tags).filter((t) => !saidWords.has(t.toLowerCase()));
      const score = (inTitle.length ? W.titleMatch + (inTitle.length - 1) * W.perExtraWord : 0)
        + (said.length - inTitle.length) * W.perExtraWord + tagged.length * angleRules.closest.perTag;
      return { angle, score, said, tagged };
    });
    const top = scored.reduce((a, b) => (b.score > a.score ? b : a));
    const quote = (xs: string[]) => xs.slice(0, 4).map((x) => `“${x}”`).join(", ");
    const parts = [
      top.said.length ? `The posting says ${quote(top.said)}` : null,
      top.tagged.length ? `your ${top.angle} pieces are tagged ${quote(top.tagged)}` : null,
    ].filter(Boolean);
    const { summary, leads } = view(top.angle);
    return { angle: top.angle, reason: `${parts.join(", and ")}.`, summary, leads };
  }

  return { list: () => angles.map(view), save, closest };
}

const hasResult = (p: ProfilePiece) => p.numberSource !== null;

/** The thin-angle rule (`angleRules.thin`): too few pieces, or too few with a result. */
function thinness(pieces: ProfilePiece[]): AngleView["thin"] {
  const { minPieces, minWithResult } = angleRules.thin;
  const n = pieces.length;
  const results = pieces.filter(hasResult).length;
  if (n >= minPieces && results >= minWithResult) return null;
  if (n === 0) return { reason: "No pieces yet." };
  const counted = `${n} ${n === 1 ? "piece" : "pieces"}`;
  const withResult = results === 0 ? "none has a result" : `${results} ${results === 1 ? "has" : "have"} a result`;
  if (n < minPieces) return { reason: `Only ${counted}, and ${withResult}.` };
  return { reason: `Only ${results} of ${counted} ${results === 1 ? "has" : "have"} a result.` };
}

/** The default lead order: achievements with a result, other achievements, roles (newest first), the rest. */
function leadFirst(a: ProfilePiece, b: ProfilePiece): number {
  const rank = (p: ProfilePiece) => (p.kind === "achievement" ? (hasResult(p) ? 0 : 1) : p.kind === "role" ? 2 : 3);
  return rank(a) - rank(b) || (a.entry && b.entry ? (b.entry.end ?? "9999").localeCompare(a.entry.end ?? "9999") || b.entry.start.localeCompare(a.entry.start) : 0);
}
