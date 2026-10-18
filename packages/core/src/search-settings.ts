// Kris's search settings: what Fit and dealbreakers are measured against. Deliberately minimal
// until onboarding builds the full profile. The engine stores them (the settings form edits them);
// until Kris saves any, it uses the ones it was given, else these defaults. Place names are
// resolved through the alias table in locations.ts.

export interface SearchSettings {
  /** Prioritise junior/entry roles; missing on older saved settings means enabled. */
  preferJunior?: boolean;
  /** Lowest acceptable gross monthly salary, in euros. Salaries are compared against it. */
  minMonthlySalaryEur: number;
  locations: {
    /** Cities that count as first priority (on-site or hybrid), e.g. ["Sofia"]. */
    cities: string[];
    /** Remote work within European time zones (about ±2h of Sofia) also counts as first priority. */
    remoteInEurope: boolean;
    /** Countries Kris would relocate to: a separate, lower-priority list. */
    relocation: string[];
  };
  /**
   * What hides a Job from the main Feed (always with the reason shown). Only confidently required
   * items count: preferred ones, and anything still waiting for Kris to confirm, never hide a Job.
   */
  dealbreakers: {
    /** Languages Kris doesn't speak, by English name: a Job requiring one is hidden. */
    languagesNotSpoken: string[];
    /** Most years of experience Kris accepts being asked for; null turns the rule off. */
    maxYearsRequired: number | null;
    /** Hide a Job whose stated salary is entirely below `minMonthlySalaryEur`. Jobs without a salary stay. */
    salaryBelowMinimum: boolean;
    /** Hide a Job outside Kris's location groups (cities, remote in Europe, relocation). Unclear places stay. */
    outsideLocations: boolean;
  };
}

/** From docs/design/PRODUCT.md (search profile) and the hi-fi ("your minimum (€2,000)", "your limit: 4"). */
export const defaultSearchSettings: SearchSettings = {
  minMonthlySalaryEur: 2000,
  locations: {
    cities: ["Sofia"],
    remoteInEurope: true,
    relocation: ["Switzerland", "Spain"],
  },
  dealbreakers: {
    languagesNotSpoken: [],
    maxYearsRequired: 4,
    salaryBelowMinimum: true,
    outsideLocations: true,
  },
};

/**
 * Checks settings from outside (the settings form) and returns them cleaned up: names trimmed,
 * empty and duplicate entries dropped. Throws with a plain-language message when one is invalid.
 */
export function parseSearchSettings(input: unknown): SearchSettings {
  const o = object(input, "Search settings");
  const loc = object(o.locations, "Locations");
  const db = object(o.dealbreakers, "Dealbreakers");
  const min = o.minMonthlySalaryEur;
  if (typeof min !== "number" || !Number.isFinite(min) || min < 0) throw new Error("The minimum monthly salary must be a number of euros, 0 or more");
  const years = db.maxYearsRequired;
  if (years !== null && (typeof years !== "number" || !Number.isInteger(years) || years < 0)) {
    throw new Error("The most years asked for must be a whole number, or empty to turn the rule off");
  }
  return {
    ...(o.preferJunior!==undefined?{preferJunior:bool(o.preferJunior,"Junior role priority")}:{}),
    minMonthlySalaryEur: Math.round(min),
    locations: {
      cities: names(loc.cities, "Cities"),
      remoteInEurope: bool(loc.remoteInEurope, "Remote in Europe"),
      relocation: names(loc.relocation, "Relocation countries"),
    },
    dealbreakers: {
      languagesNotSpoken: names(db.languagesNotSpoken, "Languages you don't speak"),
      maxYearsRequired: years,
      salaryBelowMinimum: bool(db.salaryBelowMinimum, "Salary below your minimum"),
      outsideLocations: bool(db.outsideLocations, "Outside your locations"),
    },
  };
}

function object(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what} are missing`);
  return v as Record<string, unknown>;
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${what} must be on or off`);
  return v;
}

function names(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`${what} must be a list of names`);
  const out: string[] = [];
  for (const raw of v as string[]) {
    const name = raw.trim();
    if (name && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}
