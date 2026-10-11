// EURES, the EU public employment portal (unofficial: the portal's own search backend; no auth).
// POST https://europa.eu/eures/api/jv-searchengine/public/jv-search/search. Postings are written
// in local languages, so free-text search is noisy: cyber searches use ESCO occupation URIs
// (a language-independent taxonomy) instead. Many postings have no English translation.
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { field, keyPart, readJson, searchCap, splitShorthand } from "./shared.ts";

export interface EuresConfig {
  /** Free-text keywords; empty when searching by occupation. */
  keywords: string;
  /** A named ESCO occupation group ("cyber"), or null for a free-text search. */
  occupations: keyof typeof occupationGroups | null;
  /** ISO 3166 alpha-2 country, lower case ("bg"), or "" for all of EURES. */
  country: string;
}

/** ESCO occupation URIs by group (esco.ec.europa.eu). */
export const occupationGroups = {
  cyber: {
    label: "cyber roles",
    uris: [
      "http://data.europa.eu/esco/occupation/a44a1dc5-be08-4840-8bd5-770c4ac1ca6d", // ICT security technician
      "http://data.europa.eu/esco/occupation/0ce5a9f4-e00a-4bbe-b255-3c63407167a4", // ICT security consultant
      "http://data.europa.eu/esco/occupation/7754d570-9519-48c2-b1c9-8e165f8bca0f", // ICT security manager
      "http://data.europa.eu/esco/occupation/276ba420-ef09-4a0e-b215-2c2e2f80ad28", // chief ICT security officer
      "http://data.europa.eu/esco/occupation/0c448a27-10ec-43ba-b880-d9938bade424", // digital forensics expert
      "http://data.europa.eu/esco/occupation/76ef0a87-6afe-4560-b5d0-9a086abe45c5", // ethical hacker
    ],
  },
} as const;

/** Keywords that mean "cyber roles": searched by occupation rather than as text. */
const cyberAliases = new Set(["cyber", "cybersecurity", "cyber security", "ict security", "information security", "infosec", "it security"]);

/** NUTS regions worth naming: Sofia city and Sofia province. */
const nutsPlaces: Record<string, string> = { BG411: "Sofia", BG412: "Sofia" };

interface EuresJv {
  id?: string;
  title?: string;
  description?: string;
  creationDate?: number;
  locationMap?: Record<string, string[]>;
  employer?: { name?: string | null } | null;
  translations?: Record<string, { title?: string; description?: string }>;
}

const pageSize = 50;
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export const eures: SourceAdapter<EuresConfig> = {
  kind: "eures",
  category: "api",
  label: "EURES",

  parseConfig(raw) {
    const [text, countryText] = typeof raw === "string" ? splitShorthand(raw, 2) : [field(raw, "keywords") ?? "", field(raw, "country") ?? ""];
    const explicit = field(raw, "occupations");
    const country = countryText!.toLowerCase();
    if (country && !/^[a-z]{2}$/.test(country)) throw new Error(`A EURES source's country is a 2-letter code like "bg", got ${JSON.stringify(countryText)}`);
    if (explicit !== undefined && !(explicit in occupationGroups)) {
      throw new Error(`EURES knows these occupation groups: ${Object.keys(occupationGroups).join(", ")}; got ${JSON.stringify(explicit)}`);
    }
    const occupations = (explicit as EuresConfig["occupations"] | undefined) ?? (cyberAliases.has(keyPart(text!)) ? "cyber" : null);
    if (!occupations && !text) throw new Error(`A EURES source needs a search like "cyber|bg" or "software developer|bg", got ${JSON.stringify(raw)}`);
    return { keywords: occupations ? "" : text!, occupations, country };
  },

  key: (c) => [c.occupations ?? keyPart(c.keywords), c.country].filter(Boolean).join("|"),
  defaultName: (c) => ["EURES", c.occupations ? occupationGroups[c.occupations].label : c.keywords, c.country.toUpperCase()].filter(Boolean).join(" · "),

  async fetchPostings(config, { fetch }) {
    const out = new Map<string, FoundPosting>();
    for (let page = 1; out.size < searchCap; page++) {
      const res = await fetch("https://europa.eu/eures/api/jv-searchengine/public/jv-search/search", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(searchBody(config, page)),
      });
      const body = await readJson<{ numberRecords?: number; jvs?: EuresJv[] }>(res, "EURES");
      if (!Array.isArray(body.jvs)) throw new Error("EURES returned no job list");
      for (const jv of body.jvs) {
        const p = toPosting(jv);
        if (p && out.size < searchCap) out.set(p.externalId, p);
      }
      if (body.jvs.length < pageSize || page * pageSize >= Number(body.numberRecords ?? 0)) break;
    }
    return [...out.values()];
  },
};

function searchBody(c: EuresConfig, page: number) {
  return {
    resultsPerPage: pageSize,
    page,
    sortSearch: "MOST_RECENT",
    keywords: c.keywords ? [{ keyword: c.keywords, specificSearchCode: "EVERYWHERE" }] : [],
    publicationPeriod: null,
    occupationUris: c.occupations ? [...occupationGroups[c.occupations].uris] : [],
    skillUris: [],
    requiredExperienceCodes: [],
    positionScheduleCodes: [],
    sectorCodes: [],
    educationAndQualificationLevelCodes: [],
    positionOfferingCodes: [],
    locationCodes: c.country ? [c.country] : [],
    euresFlagCodes: [],
    otherBenefitsCodes: [],
    requiredLanguages: [],
    minNumberPost: null,
    sessionId: "apply-kit",
    requestLanguage: "en",
  };
}

function toPosting(jv: EuresJv): FoundPosting | null {
  if (!jv.id) return null;
  const translated = jv.translations?.en;
  const title = (translated?.title || jv.title || "").trim();
  if (!title) return null;
  return {
    externalId: jv.id,
    url: `https://europa.eu/eures/portal/jv-se/jv-details/${encodeURIComponent(jv.id)}?lang=en`,
    title,
    company: jv.employer?.name?.trim() || "Employer not stated",
    location: placeText(jv.locationMap),
    salary: null,
    postedAt: typeof jv.creationDate === "number" ? new Date(jv.creationDate).toISOString() : null,
    // Often only in the local language; extraction reads any EU language.
    descriptionHtml: translated?.description || jv.description || null,
  };
}

/** {"BG": ["BG411"]} → "Sofia, Bulgaria"; {"BE": ["BE213"]} → "Belgium". */
function placeText(map: Record<string, string[]> | undefined): string | null {
  if (!map) return null;
  const places = Object.entries(map).map(([iso2, nuts]) => {
    const country = countryNames.of(iso2.toUpperCase()) ?? iso2;
    const city = [...new Set((nuts ?? []).map((n) => nutsPlaces[n.toUpperCase()]).filter(Boolean))];
    return city.length ? `${city.join(", ")}, ${country}` : country;
  });
  return places.length ? places.join("; ") : null;
}
