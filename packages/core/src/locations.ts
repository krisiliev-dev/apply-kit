// Where a job is, against Kris's location priorities (docs/design/PRODUCT.md): Sofia and remote
// within European time zones are equally first; relocation to Switzerland or Spain is a separate,
// lower-priority list; everything else is outside his locations. Whole-word matching only (never
// substrings: "uk" must not match "Ukraine"), in Latin and Cyrillic.
import { defaultSearchSettings, type SearchSettings } from "./search-settings.ts";
import { hasPhrase, words } from "./words.ts";

/**
 * - first: a first-priority city, or remote within European time zones;
 * - relocation: a country Kris would relocate to (shown separately);
 * - other: somewhere else, or remote outside European time zones;
 * - unknown: no location stated, remote without saying where from, or the home country with no city.
 */
export type LocationTier = "first" | "relocation" | "other" | "unknown";

export interface Place {
  tier: LocationTier;
  /** In plain words: "Sofia · hybrid", "Remote · Europe", "Relocation: Spain", "Outside your locations". */
  label: string;
}

/** What a place may be stated from: the Source's location text and, once read, the posting's remote rules. */
export interface PlaceInput {
  location: string | null;
  remote?: { mode: "on-site" | "hybrid" | "remote" | "not-stated"; locations: string[] } | null;
}

/** Spellings a place name goes by, in Latin and Cyrillic. Names not listed match as themselves. */
const aliases: Record<string, string[]> = {
  sofia: ["sofia", "sofiya", "софия", "sofia city", "sofia grad"],
  switzerland: ["switzerland", "swiss", "schweiz", "suisse", "svizzera", "швейцария", "zurich", "zürich", "geneva", "genève", "basel", "bern", "lausanne", "lugano", "zug"],
  spain: ["spain", "españa", "espana", "испания", "madrid", "barcelona", "valencia", "seville", "sevilla", "malaga", "málaga", "bilbao"],
};

/** The country of each first-priority city, for postings that name only the country. */
const countryOfCity: Record<string, { name: string; spellings: string[] }> = {
  sofia: { name: "Bulgaria", spellings: ["bulgaria", "българия", "republic of bulgaria"] },
};

/** The label of a Place with no location at all (its Fit part is left out, not scored). */
export const NOT_STATED = "Location not stated";

const remoteWords = ["remote", "remotely", "fully remote", "work from home", "wfh", "home office", "дистанционно", "дистанционна", "от вкъщи", "remote first"];

/** Regions and countries within about ±2h of Sofia (UTC+0 to UTC+4): all of Europe. */
const europeWords = [
  "europe", "european", "eu", "eea", "emea", "cet", "cest", "eet", "eest", "gmt", "wet", "европа", "ес",
  "anywhere", "worldwide", "global", "навсякъде",
  "albania", "andorra", "austria", "belgium", "bosnia", "bulgaria", "croatia", "cyprus", "czechia", "czech republic",
  "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "iceland", "ireland", "italy", "kosovo",
  "latvia", "liechtenstein", "lithuania", "luxembourg", "malta", "moldova", "monaco", "montenegro", "netherlands",
  "north macedonia", "macedonia", "norway", "poland", "portugal", "romania", "serbia", "slovakia", "slovenia", "spain",
  "sweden", "switzerland", "turkey", "türkiye", "ukraine", "uk", "united kingdom", "great britain", "england", "scotland",
  "wales", "georgia", "armenia",
  "българия", "румъния", "гърция", "сърбия", "германия", "франция", "италия", "испания", "нидерландия", "холандия",
  "полша", "австрия", "великобритания", "ирландия", "португалия", "швейцария", "турция",
];

/** Places that rule out European time zones for a remote job. */
const outsideEuropeWords = [
  "us", "usa", "united states", "america", "americas", "north america", "latin america", "latam", "canada", "mexico",
  "brazil", "apac", "asia", "india", "japan", "singapore", "australia", "new zealand", "pst", "est", "us only",
];

const named = (name: string) => aliases[name.toLowerCase()] ?? [name];
const anyOf = (w: string[], phrases: string[]) => phrases.find((p) => hasPhrase(w, p));
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function placeOf(input: PlaceInput, settings: SearchSettings["locations"] = defaultSearchSettings.locations): Place {
  const stated = [input.location ?? "", ...(input.remote?.locations ?? [])].join(" , ");
  const w = words(stated);
  const mode = input.remote?.mode ?? "not-stated";
  const remote = mode === "remote" || anyOf(w, remoteWords) != null;
  if (w.length === 0 && !remote) return { tier: "unknown", label: NOT_STATED };

  const city = settings.cities.find((c) => anyOf(w, named(c)));
  if (city && !remote) return { tier: "first", label: mode === "hybrid" || mode === "on-site" ? `${title(city)} · ${mode}` : title(city) };
  if (city) return { tier: "first", label: `Remote · ${title(city)}` };

  if (remote) {
    const europe = anyOf(w, europeWords);
    if (europe && settings.remoteInEurope) return { tier: "first", label: "Remote · Europe" };
    if (anyOf(w, outsideEuropeWords)) return { tier: "other", label: "Remote, outside European time zones" };
    if (!europe) return { tier: "unknown", label: "Remote, region not stated" };
  }

  const country = settings.relocation.find((c) => anyOf(w, named(c)));
  if (country) return { tier: "relocation", label: `Relocation: ${title(country)}` };

  // "Bulgaria" alone may well be Sofia: unknown, not outside.
  const home = settings.cities.map((c) => countryOfCity[c.toLowerCase()]).find((c) => c && anyOf(w, c.spellings));
  if (home) return { tier: "unknown", label: `${home.name}, city not stated` };
  return { tier: "other", label: "Outside your locations" };
}

/** Whether a Source's location text is in Kris's first-priority locations (source health counts), as Kris saved them. */
export function isInYourLocations(location: string | null, settings: SearchSettings["locations"] = defaultSearchSettings.locations): boolean {
  return placeOf({ location }, settings).tier === "first";
}
