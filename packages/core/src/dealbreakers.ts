// Dealbreakers: which of Kris's rules a read Job breaks, each with a reason in plain words. Pure:
// the engine gathers the reading and where the Job is. Only the screening reading counts, so a
// preferred item, or one still waiting for Kris to confirm, never hides a Job.
import type { Screening } from "./extraction/reading.ts";
import { formatSalary } from "./extraction/reading.ts";
import { eurPer, perMonth } from "./fit/weights.ts";
import type { Place } from "./locations.ts";
import type { SearchSettings } from "./search-settings.ts";

/** The rule a hidden Job breaks. */
export type DealbreakerRule = "language" | "years" | "salary" | "location";

/** One reason a Job is hidden. */
export interface HiddenReason {
  rule: DealbreakerRule;
  /** Stable for this Job's reading: "language:German", "years", "salary", "location". */
  key: string;
  /** In plain words, e.g. "Asks for 7+ years (your limit: 4)". */
  text: string;
  /** What "Not a dealbreaker for me" would change, in plain words. */
  relax: string;
}

const eur = (n: number) => `€${Math.round(n).toLocaleString("en-GB")}`;

/** A stated salary's monthly range in euros, or null when its currency or period is unclear. */
export function monthlyEur(salary: NonNullable<Screening["salary"]>): { low: number; high: number } | null {
  const rate = salary.currency ? eurPer[salary.currency.toUpperCase()] : undefined;
  const factor = salary.period ? perMonth[salary.period] : undefined;
  const low = salary.min ?? salary.max;
  const high = salary.max ?? salary.min;
  if (rate == null || factor == null || low == null || high == null) return null;
  return { low: low * rate * factor, high: high * rate * factor };
}

/** `levels`: the level each language is asked at ("fluent", "C1"), from the posting's facts. */
export function dealbreakersOf(screening: Screening, place: Place, settings: SearchSettings, levels: Record<string, string | null> = {}): HiddenReason[] {
  const rules = settings.dealbreakers;
  const out: HiddenReason[] = [];

  for (const language of screening.languagesRequired) {
    const level = levels[language];
    if (!rules.languagesNotSpoken.some((l) => l.toLowerCase() === language.toLowerCase())) continue;
    out.push({
      rule: "language", key: `language:${language}`,
      text: `Requires ${language}${level ? ` (${level})` : ""}: a language you don't speak`,
      relax: `Remove ${language} from the languages you don't speak`,
    });
  }

  const years = screening.yearsRequired;
  if (rules.maxYearsRequired != null && years != null && years > rules.maxYearsRequired) {
    out.push({
      rule: "years", key: "years",
      text: `Asks for ${years}+ years (your limit: ${rules.maxYearsRequired})`,
      relax: `Raise your limit to ${years} years`,
    });
  }

  // Net salaries are left alone: a net figure below a gross minimum may still be above it gross.
  const s = screening.salary;
  const money = s && s.basis !== "net" ? monthlyEur(s) : null;
  if (rules.salaryBelowMinimum && money && money.high < settings.minMonthlySalaryEur) {
    const floor = Math.floor(money.high);
    out.push({
      rule: "salary", key: "salary",
      text: `Salary ${formatSalary(s!)}, below your ${eur(settings.minMonthlySalaryEur)} minimum`,
      relax: `Lower your minimum to ${eur(floor)} a month`,
    });
  }

  if (rules.outsideLocations && place.tier === "other") {
    out.push({
      rule: "location", key: "location",
      text: place.label === "Outside your locations" ? "Outside your locations" : place.label,
      relax: "Stop hiding jobs outside your locations (they stay ranked lower)",
    });
  }
  return out;
}
