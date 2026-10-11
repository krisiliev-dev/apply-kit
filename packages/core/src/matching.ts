// When two Postings describe the same Job. Deliberately conservative and deterministic: the same
// company (legal suffixes ignored), the same title once normalised (case, accents, punctuation,
// gender markers like "(f/m/d)" and "@ Team" suffixes ignored; seniority and specialisms kept),
// and locations that don't contradict each other. Two Postings with the same link are always the
// same Job. Anything less certain stays apart: a wrong split costs a glance, a wrong merge hides a job.

/** Company names adapters use when the Source doesn't state one: never evidence of anything. */
const unknownCompanies = new Set(["", "company not stated", "dev bg"]);

const legalSuffixes = new Set([
  "ltd", "limited", "llc", "inc", "incorporated", "corp", "corporation", "co", "plc", "gmbh", "ag", "sa", "sas",
  "srl", "bv", "nv", "oy", "ab", "as", "spa", "ead", "eood", "ood", "ad", "еоод", "оод", "ад", "еад",
]);

/** Lower case, accents removed (Cyrillic kept), "&" read as "and", punctuation as spaces. */
function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean);
}

/** "Payhawk EOOD" and "payhawk" → "payhawk"; null for a company the Source didn't state. */
export function normaliseCompany(company: string): string | null {
  const w = words(company);
  while (w.length > 1 && legalSuffixes.has(w.at(-1)!)) w.pop();
  const name = w.join(" ");
  return unknownCompanies.has(name) ? null : name;
}

const abbreviations: Record<string, string> = { sr: "senior", jr: "junior" };

/** "Information Security Expert (f/m/d) @ A1 CDC" → "information security expert". */
export function normaliseTitle(title: string): string {
  const stripped = title
    .replace(/\s@\s.*$/, "")
    .replace(/\(\s*(?:all genders|[mfwdhx](?:\s*[/|,]\s*[mfwdhx])+)\s*\)/gi, " ")
    .replace(/(?:^|\s)[mfwd](?:\/[mfwdx]){1,3}(?=\s|$)/gi, " ");
  return words(stripped).map((w) => abbreviations[w] ?? w).join(" ");
}

/**
 * The key two Postings must share to be the same role: normalised company and title. Null when
 * the company isn't stated, so such Postings only ever merge by link.
 */
export function matchKey(p: { company: string; title: string }): string | null {
  const company = normaliseCompany(p.company);
  const title = normaliseTitle(p.title);
  return company && title ? `${company}|${title}` : null;
}

// Location compatibility. Places are compared as cities, falling back to countries only when one
// side names just a country ("Bulgaria" fits "Sofia", but "Sofia" never fits "Plovdiv").

const aliases: Record<string, string> = {
  "софия": "sofia", sofiya: "sofia", "пловдив": "plovdiv", "варна": "varna", "бургас": "burgas", "русе": "ruse",
  "българия": "bulgaria", "лондон": "london", england: "uk", britain: "uk", gb: "uk", "deutschland": "germany",
  "münchen": "munich", munchen: "munich", "wien": "vienna",
};

const cityCountry: Record<string, string> = {
  sofia: "bulgaria", plovdiv: "bulgaria", varna: "bulgaria", burgas: "bulgaria", ruse: "bulgaria",
  london: "uk", manchester: "uk", edinburgh: "uk", dublin: "ireland", berlin: "germany", munich: "germany",
  amsterdam: "netherlands", vienna: "austria", paris: "france", madrid: "spain", barcelona: "spain",
  lisbon: "portugal", warsaw: "poland", krakow: "poland", prague: "czechia", bucharest: "romania", athens: "greece",
};

const countries = new Set([...Object.values(cityCountry), "uk", "ireland", "usa", "us"]);

/** How the job is worked, regions and filler: they say nothing about which office it is. */
const noise = new Set([
  "remote", "hybrid", "onsite", "on", "site", "office", "fully", "full", "partially", "partly", "home", "from", "work",
  "working", "in", "or", "and", "the", "of", "within", "based", "europe", "european", "eu", "emea", "eea", "cet", "eet",
  "anywhere", "worldwide", "global", "дистанционно", "хибридно", "дистанционна", "работа", "от", "вкъщи", "days", "day",
  "united", "kingdom", "city", "area", "region",
]);

interface Places { cities: Set<string>; countries: Set<string> }

function places(location: string | null): Places {
  const out: Places = { cities: new Set(), countries: new Set() };
  if (!location) return out;
  const text = location.toLowerCase().replace(/united kingdom/g, "uk").replace(/\bon-site\b/g, "onsite");
  for (const raw of words(text)) {
    const w = aliases[raw] ?? raw;
    if (noise.has(w) || /^\d+$/.test(w)) continue;
    if (countries.has(w)) out.countries.add(w);
    else {
      out.cities.add(w);
      const country = cityCountry[w];
      if (country) out.countries.add(country);
    }
  }
  return out;
}

const shares = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

/** True unless the two locations clearly name different places. A missing location fits anything. */
export function locationsCompatible(a: string | null, b: string | null): boolean {
  const pa = places(a);
  const pb = places(b);
  const emptyA = pa.cities.size === 0 && pa.countries.size === 0;
  const emptyB = pb.cities.size === 0 && pb.countries.size === 0;
  if (emptyA || emptyB) return true;
  if (pa.cities.size > 0 && pb.cities.size > 0) return shares(pa.cities, pb.cities);
  return shares(pa.countries, pb.countries);
}

/** Why a Posting joined its Job, kept so the Job page can say so. */
export type MergeReason =
  | { rule: "same-link"; url: string }
  | { rule: "same-role"; company: string; title: string };

export function describeMergeReason(r: MergeReason): string {
  return r.rule === "same-link"
    ? "Merged because it links to the same posting"
    : "Merged because the company and title match and the locations agree";
}
