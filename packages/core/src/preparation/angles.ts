// Angles: the three framings of the master profile (developer, security, design) that tailoring
// starts from. Each has a summary line and an ordered list of the pieces that lead; a package picks
// the closest one for its Job. Stored in SQLite (ADR 0003). Every tunable number is in `angleRules`.
import { angleKeywords, angleLabel, angles, type Angle } from "../fit/angles.ts";
import { fitWeights } from "../fit/weights.ts";
import type { SqlDatabase } from "../ports.ts";
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
  /** The closest angle: Discover's keyword score (as in Fit), plus this much per piece tag the posting names. */
  closest: { perTag: fitWeights.angle.perExtraWord },
} as const;

/** What the closest angle is chosen from: a Job's title and requirements (a JobDetail fits). */
export interface AnglePosting {
  title: string;
  titleTranslation: string | null;
  requirements: { text: string }[];
}

export interface AngleChoice {
  angle: Angle;
  /** Why, in plain words: what in the posting points to it. */
  reason: string;
}

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
  closest(posting: AnglePosting): AngleChoice;
}

export function createAngleStore({ pieces }: { db: SqlDatabase; pieces: () => ProfilePiece[] }): AngleStore {
  /** Confirmed pieces of an angle: what tailoring from it can use. */
  const available = (angle: Angle) => pieces().filter((p) => p.status === "confirmed" && p.angles.includes(angle));

  function view(angle: Angle): AngleView {
    const mine = available(angle);
    return {
      angle,
      label: angleLabel[angle],
      summary: "",
      leads: [...mine].sort(leadFirst).slice(0, angleRules.defaultLeads),
      available: mine.length,
      packagesUsed: 0,
      thin: thinness(mine),
    };
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
    return { angle: top.angle, reason: `${parts.join(", and ")}.` };
  }

  return { list: () => angles.map(view), closest };
}

const hasResult = (p: ProfilePiece) => p.numberSource !== null;

/** The thin-angle rule (`angleRules.thin`): too few pieces, or too few with a result. */
function thinness(pieces: ProfilePiece[]): AngleView["thin"] {
  const { minPieces, minWithResult } = angleRules.thin;
  const n = pieces.length;
  const results = pieces.filter(hasResult).length;
  if (n >= minPieces && results >= minWithResult) return null;
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
