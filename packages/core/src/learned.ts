// Learned ranking adjustments: what the ranking learned from Kris, only when he opted in (a pass
// reason with "rank lower" ticked, "Show this job" with "rank higher" ticked, or a boost). Each one
// says which Jobs it moves (its matcher) and by how many Fit points. Pure: the engine stores them
// and asks which apply to a Job. The point sizes are in fit/weights.ts.
import { slugFor } from "./companies.ts";
import { angleLabel, type Angle } from "./fit/angles.ts";
import { fitWeights } from "./fit/weights.ts";
import { hasPhrase, words } from "./words.ts";

/** Which Jobs an adjustment moves. */
export type AdjustmentMatcher =
  /** Jobs at a company (by its normalised name), optionally only those of one Angle. */
  | { by: "company"; company: string; slug: string; angle: Angle | null }
  /** Jobs that require this item (whole words, in their read requirements). */
  | { by: "requirement"; requirement: string }
  /** Jobs at this place, as Fit labels it ("Sofia · on-site"). */
  | { by: "place"; place: string };

export type AdjustmentOrigin = "pass" | "unhide" | "boost";

/** What the engine knows about a Job when it asks which adjustments apply. */
export interface AdjustableJob {
  company: string;
  angle: Angle | null;
  place: string;
  /** The read required items' texts (empty until the posting is read). */
  required: string[];
}

export function matches(m: AdjustmentMatcher, job: AdjustableJob): boolean {
  switch (m.by) {
    case "company": return slugFor(job.company) === m.slug && (m.angle == null || m.angle === job.angle);
    case "requirement": return job.required.some((r) => hasPhrase(words(r), m.requirement));
    case "place": return job.place === m.place;
  }
}

/** A stable key for a matcher, so the same lesson isn't learned twice. */
export const matcherKey = (m: AdjustmentMatcher): string =>
  m.by === "company" ? `company:${m.slug}:${m.angle ?? ""}` : m.by === "requirement" ? `requirement:${words(m.requirement).join(" ")}` : `place:${m.place}`;

/** "Jobs at Unity Bank", "Security jobs at Kestrel", "Jobs that require Kubernetes", "Jobs in Sofia · on-site". */
export function appliesTo(m: AdjustmentMatcher): string {
  switch (m.by) {
    case "company": return m.angle ? `${angleLabel[m.angle]} jobs at ${m.company}` : `Jobs at ${m.company}`;
    case "requirement": return `Jobs that require ${m.requirement}`;
    case "place": return `Jobs in ${m.place}`;
  }
}

/** How the adjustment reads in a why-line, e.g. "ranked lower: you passed a job at Unity Bank". */
export function whyText(origin: AdjustmentOrigin, m: AdjustmentMatcher, passReason: string | null): string {
  if (origin === "boost") return `ranked higher: you boosted ${m.by === "company" && m.angle ? `${angleLabel[m.angle]} jobs at ` : ""}${m.by === "company" ? m.company : appliesTo(m)}`;
  if (origin === "unhide") return `ranked higher: you showed a hidden job at ${m.by === "company" ? m.company : appliesTo(m)}`;
  switch (m.by) {
    case "company": return `ranked lower: you passed a job at ${m.company}${passReason === "salary" ? " over salary" : ""}`;
    case "requirement": return `ranked lower: requires ${m.requirement}, which you passed a job over`;
    case "place": return `ranked lower: you passed a job in ${m.place}`;
  }
}

/** Fit points for an adjustment of this origin: passes push down, unhides and boosts lift. */
export const pointsFor = (origin: AdjustmentOrigin): number =>
  origin === "pass" ? -fitWeights.learned.lower : origin === "boost" ? fitWeights.learned.boost : fitWeights.learned.higher;

export const companyMatcher = (company: string, angle: Angle | null = null): AdjustmentMatcher =>
  ({ by: "company", company, slug: slugFor(company), angle });
