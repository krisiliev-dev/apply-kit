// Kris's search settings: what Fit and (later) dealbreakers are measured against. Deliberately
// minimal: #12 (dealbreakers and the settings form) extends this shape and stores it; until then
// the engine uses these defaults. Place names are resolved through the alias table in locations.ts.

export interface SearchSettings {
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
}

/** From docs/design/PRODUCT.md (search profile) and the hi-fi ("your minimum (€2,000)"). */
export const defaultSearchSettings: SearchSettings = {
  minMonthlySalaryEur: 2000,
  locations: {
    cities: ["Sofia"],
    remoteInEurope: true,
    relocation: ["Switzerland", "Spain"],
  },
};
