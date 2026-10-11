// Every tunable number behind Fit, in one place. These are STARTING GUESSES, not calibrated:
// nothing has been measured yet (see docs/knowledge/job-discovery.md on the old project's invented
// weights). Tune them against what Kris actually saves and passes.

export const fitWeights = {
  /** Share of each part in the Fit. A part that can't be determined is left out and the rest rescaled. */
  parts: {
    /** Requirements met, from the master profile. The biggest part once there is one. */
    requirements: 0.35,
    /** How closely the job matches one of the three angles. */
    angle: 0.25,
    /** Location priority. */
    location: 0.2,
    /** Salary against the minimum. */
    salary: 0.1,
    /** How recently the job was posted. */
    freshness: 0.1,
  },

  /** Angle score: a title word counts most, each further word in the title or requirements adds a little. */
  angle: { titleMatch: 0.7, perExtraWord: 0.1 },

  /** Requirement score for each determinable required item (preferred items only ever add). */
  requirements: { met: 1, partly: 0.5, gap: 0, preferredMetBonus: 0.05 },

  /**
   * Location score per tier. `unclear` is for a location that may be first priority but doesn't say
   * ("Remote" with no region, "Bulgaria" with no city); no location at all is left out.
   */
  location: { first: 1, unclear: 0.6, relocation: 0.4, other: 0 },

  /** Salary score: whole range at or above the minimum, range reaching it, or entirely below it. */
  salary: { above: 1, reaches: 0.7, below: 0 },

  /** Freshness: full score up to `freshDays` old, falling to zero at `staleDays`. */
  freshness: { freshDays: 3, staleDays: 30 },

  /** Bands named on the Job page: strong is 85 and up, good 70–84, stretch below 70. */
  bands: { strong: 85, good: 70 },
} as const;

/**
 * Approximate euro value of one unit of each currency, for comparing salaries with the minimum.
 * BGN is the fixed euro rate; the others drift and should be refreshed now and then.
 */
export const eurPer: Record<string, number> = { EUR: 1, BGN: 1 / 1.95583, CHF: 1.07, GBP: 1.17, USD: 0.92, PLN: 0.23, RON: 0.2, CZK: 0.04, SEK: 0.088, DKK: 0.134, NOK: 0.085 };

/** Working periods per month, to turn yearly, daily and hourly salaries into monthly ones. */
export const perMonth: Record<string, number> = { year: 1 / 12, month: 1, day: 21, hour: 168 };
