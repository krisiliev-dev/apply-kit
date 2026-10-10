import type {
  DiscoveryPreferences,
  DiscoveryState,
  JobPosting,
  ScoredPosting,
} from "./types";
import type { CVContent } from "@/lib/types";
import { locationMatches, normalizeLoc } from "./location";

// Lightweight scoring — lexical + freshness + user signals.
//
// Deliberately not using embeddings yet: for v1 the user might have a few
// dozen postings to rank, and TF-IDF / token-set overlap is adequate,
// deterministic, and fast. TODO: swap in `@ai-sdk`'s `embed` once the
// watchlist grows past ~200 postings per refresh.

const THREE_DAYS = 1000 * 60 * 60 * 24 * 3;
const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "be",
  "at",
  "by",
  "as",
  "or",
  "this",
  "that",
  "it",
  "we",
  "you",
  "will",
  "our",
  "your",
  "their",
  "they",
  "from",
  "into",
  "about",
  "also",
  "any",
  "have",
  "has",
  "do",
  "does",
  "can",
  "us",
  "all",
  "other",
  "new",
  "more",
  "one",
  "than",
]);

// Cybersecurity lexicon — the user's primary target domain. A hit in the title
// is strong signal; a hit only in the body is weak. Drives the cyber boost so
// security roles outrank generic SWE/CS postings (which still score on title +
// keyword overlap, just without the cyber lift).
const CYBER_TERMS = [
  "cybersecurity",
  "cyber security",
  "cyber",
  "infosec",
  "information security",
  "security engineer",
  "security analyst",
  "security operations",
  "soc analyst",
  "soc ",
  "siem",
  "penetration",
  "pentest",
  "vulnerability",
  "threat",
  "incident response",
  "forensic",
  "malware",
  "appsec",
  "devsecops",
  "ethical hack",
  "red team",
  "blue team",
  "purple team",
  "iso 27001",
  "soc 2",
  "grc",
  "ciso",
  "ids/ips",
  "firewall",
  "encryption",
  "cryptography",
  "zero trust",
  "iam",
  "identity and access",
  "compliance",
  "risk analyst",
  "security operations center",
];

/**
 * 0–1 cybersecurity relevance. Title hits dominate; body-only hits add a little.
 * Caps at 1 so a keyword-stuffed posting can't run away with the score.
 */
function cyberRelevance(p: JobPosting): number {
  const title = (p.title ?? "").toLowerCase();
  const body = (p.description ?? "").toLowerCase();
  let s = 0;
  for (const term of CYBER_TERMS) {
    if (title.includes(term)) s += 0.34;
    else if (body.includes(term)) s += 0.07;
  }
  return Math.min(1, s);
}

/**
 * Location preference tier (primary sort key on /discover). Lower = better:
 *   0..n-1  → matched preferredLocations in listed order (so Sofia, listed
 *             first, is tier 0 and surfaces above everything else)
 *   n       → remote (desired but not a specific preferred city)
 *   n+1     → passes work-auth but no location preference matched
 * With no preferences set, everything is the same neutral tier.
 */
function locationTier(
  location: string | undefined,
  preferred: string[],
): number {
  if (preferred.length === 0) return 0;
  for (let i = 0; i < preferred.length; i++) {
    if (locationMatches(location, [preferred[i]])) return i;
  }
  const n = normalizeLoc(location);
  if (/\bremote\b|\banywhere\b/.test(n)) return preferred.length;
  return preferred.length + 1;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+.#\- ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Jaccard index on token sets. Simple, no corpus stats required, and robust
 * to length imbalance (user CVs are long, postings vary wildly).
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokensFromCv(cv: CVContent): Set<string> {
  const parts: string[] = [];
  parts.push(cv.targetRole);
  if (cv.profile.title) parts.push(cv.profile.title);
  if (cv.profile.summary) parts.push(cv.profile.summary);
  for (const e of cv.experiences) {
    parts.push(e.role, e.company);
    if (e.summary) parts.push(e.summary);
    if (e.bullets) parts.push(...e.bullets);
    if (e.tags) parts.push(...e.tags);
  }
  for (const s of cv.skills ?? []) {
    parts.push(s.label, ...s.items);
  }
  return new Set(tokenize(parts.join(" ")));
}

function tokensFromPosting(p: JobPosting): Set<string> {
  const parts = [p.title, p.company, p.location ?? "", p.description ?? ""];
  return new Set(tokenize(parts.join(" ")));
}

/**
 * Cheap fuzzy match on role titles: longest shared token run normalized by
 * the smaller of the two token counts. "Senior Design Engineer" vs
 * "Design Engineer II" gets a decent score without being fooled by noise.
 */
function titleSimilarity(postingTitle: string, targets: string[]): number {
  const pt = new Set(tokenize(postingTitle));
  if (pt.size === 0) return 0;
  let best = 0;
  for (const t of targets) {
    const tt = new Set(tokenize(t));
    if (tt.size === 0) continue;
    let inter = 0;
    for (const tok of tt) if (pt.has(tok)) inter++;
    const denom = Math.min(pt.size, tt.size);
    const s = denom === 0 ? 0 : inter / denom;
    if (s > best) best = s;
  }
  return best;
}

function freshnessBoost(postedAt: number | undefined): number {
  if (!postedAt) return 0.5; // unknown → neutral
  const age = Date.now() - postedAt;
  if (age <= 0) return 1;
  if (age <= THREE_DAYS) return 1;
  if (age >= THIRTY_DAYS) return 0.1;
  // Linear decay between 3d and 30d
  const span = THIRTY_DAYS - THREE_DAYS;
  return 1 - ((age - THREE_DAYS) / span) * 0.9;
}

function parseSalaryMinUsd(s: string | undefined): number | undefined {
  if (!s) return undefined;
  // Grab the first currency-ish number (1k multipliers handled).
  const m = s.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)(?:\s?k)?/i);
  if (!m) return undefined;
  let n = Number(m[1].replace(/[.,]/g, ""));
  if (!Number.isFinite(n)) return undefined;
  if (/k/i.test(m[0])) n *= 1000;
  // Very rough: values < 1000 are probably per-hour or nonsense — skip.
  if (n < 1000) return undefined;
  return n;
}

function regionMatches(
  location: string | undefined,
  workAuth: string[],
  remoteOnly: boolean | undefined,
): { pass: boolean; reason?: string } {
  const loc = normalizeLoc(location);
  const isRemote = /\bremote\b|\banywhere\b/.test(loc);
  if (remoteOnly && !isRemote) {
    return { pass: false, reason: "remote-only filter (location not remote)" };
  }
  if (workAuth.length === 0) return { pass: true };
  // Regions are short codes — we also accept human names like "united states".
  const authPatterns: Array<{ code: string; tokens: string[] }> = workAuth.map(
    (code) => ({
      code,
      tokens: regionAliases(code.toUpperCase()),
    }),
  );
  // "Remote" with no other hint passes any authorization — treat as global.
  if (isRemote && !/[a-z]{2,}/.test(loc.replace(/remote|anywhere/g, "")))
    return { pass: true };
  for (const a of authPatterns) {
    if (a.tokens.some((t) => loc.includes(t))) return { pass: true };
  }
  return {
    pass: false,
    reason: `location "${location}" outside work auth [${workAuth.join(", ")}]`,
  };
}

function regionAliases(code: string): string[] {
  const map: Record<string, string[]> = {
    US: [
      "united states",
      "usa",
      "u.s.",
      " us ",
      "(us)",
      ",us",
      "remote us",
      "new york",
      "san francisco",
      "california",
      "texas",
      "washington",
      "boston",
      "seattle",
    ],
    CA: ["canada", "toronto", "vancouver", "montreal"],
    UK: ["united kingdom", "uk", "london", "manchester", "edinburgh"],
    EU: [
      "europe",
      "eu",
      "emea",
      "berlin",
      "paris",
      "amsterdam",
      "lisbon",
      "madrid",
      "barcelona",
      "dublin",
      "copenhagen",
      "stockholm",
      "munich",
      "zurich",
      // Bulgaria is an EU member — include it (Latin; Cyrillic is normalized
      // to Latin before matching).
      "bulgaria",
      "sofia",
      "plovdiv",
      "varna",
      "burgas",
      "ruse",
    ],
    BG: ["bulgaria", "sofia", "plovdiv", "varna", "burgas", "ruse"],
    DE: ["germany", "berlin", "munich", "hamburg"],
    PT: ["portugal", "lisbon", "porto"],
    ES: ["spain", "madrid", "barcelona"],
    FR: ["france", "paris", "lyon"],
    NL: ["netherlands", "amsterdam", "rotterdam"],
  };
  return map[code] ?? [code.toLowerCase()];
}

function titleDenylistHit(
  title: string,
  denylist: string[],
): string | undefined {
  const lower = title.toLowerCase();
  for (const d of denylist) {
    const w = d.trim().toLowerCase();
    if (w.length > 0 && lower.includes(w)) return d;
  }
  return undefined;
}

export type ScoreInputs = {
  posting: JobPosting;
  prefs: DiscoveryPreferences;
  cvs: CVContent[];
  state?: DiscoveryState;
};

export function scorePosting(inputs: ScoreInputs): ScoredPosting {
  const { posting, prefs, cvs, state } = inputs;
  const why: string[] = [];

  // ---- Hard filters ----------------------------------------------------
  const deny = titleDenylistHit(posting.title, prefs.titleDenylist);
  if (deny) {
    return {
      ...posting,
      score: 0,
      why: [`Title contains denylisted term "${deny}"`],
      hardReject: true,
    };
  }
  const region = regionMatches(posting.location, prefs.workAuth, prefs.remoteOnly);
  if (!region.pass) {
    return {
      ...posting,
      score: 0,
      why: [region.reason ?? "location mismatch"],
      hardReject: true,
    };
  }
  const minSalary = parseSalaryMinUsd(posting.salary);
  if (prefs.salaryFloor != null && minSalary != null && minSalary < prefs.salaryFloor) {
    return {
      ...posting,
      score: 0,
      why: [`Salary ~${minSalary} below floor ${prefs.salaryFloor}`],
      hardReject: true,
    };
  }

  // ---- Soft score -----------------------------------------------------
  const postTokens = tokensFromPosting(posting);
  let bestOverlap = 0;
  let bestTitleSim = 0;
  for (const cv of cvs) {
    const cvTokens = tokensFromCv(cv);
    const overlap = jaccard(cvTokens, postTokens);
    if (overlap > bestOverlap) bestOverlap = overlap;
    const titleSim = titleSimilarity(posting.title, [cv.targetRole, cv.profile.title]);
    if (titleSim > bestTitleSim) bestTitleSim = titleSim;
  }

  // Dismissal penalty: if user has dismissed postings at this company or with
  // very similar titles, dampen the score.
  let dismissPenalty = 0;
  if (state) {
    const dismissedCount = Object.keys(state.dismissed ?? {}).length;
    if (dismissedCount > 0) {
      const dismissedPostings = Object.keys(state.dismissed ?? {})
        .map((id) => state.postings[id])
        .filter((p): p is ScoredPosting => Boolean(p));
      for (const d of dismissedPostings) {
        if (d.company.toLowerCase() === posting.company.toLowerCase()) {
          dismissPenalty = Math.max(dismissPenalty, 0.15);
        } else if (titleSimilarity(posting.title, [d.title]) > 0.7) {
          dismissPenalty = Math.max(dismissPenalty, 0.1);
        }
      }
    }
  }

  const fresh = freshnessBoost(posting.postedAt);
  const cyber = cyberRelevance(posting);
  const tier = locationTier(posting.location, prefs.preferredLocations);
  // Soft boost when the posting is in one of the user's preferred locations
  // (Cyrillic-aware — "София" matches "Sofia"). The primary ordering is the
  // location tier (see scoreMany sort); this just nudges within a tier.
  const locBoost =
    prefs.preferredLocations.length > 0 &&
    locationMatches(posting.location, prefs.preferredLocations)
      ? 0.05
      : 0;
  // Composite, cyber-weighted: title 0.30 + keyword overlap 0.25 + cyber 0.30 +
  // freshness 0.10, plus a small preferred-location nudge. Cyber is heavy so
  // security roles float above generic SWE; non-cyber CS roles still score on
  // title + overlap (the user is open to them, just not first). Overlap is
  // typically small (0.0–0.15) so we stretch it. Title sim already spans 0–1.
  const overlapStretched = Math.min(1, bestOverlap * 4);
  const raw =
    0.3 * bestTitleSim +
    0.25 * overlapStretched +
    0.3 * cyber +
    0.1 * fresh +
    locBoost -
    dismissPenalty;
  const score = Math.max(0, Math.min(1, raw));

  // Location leads — it's the primary ordering signal (Sofia-first), so it
  // should also be the first thing shown and survive the why.slice below.
  if (tier === 0 && prefs.preferredLocations.length > 0) {
    why.push(`Top location: ${prefs.preferredLocations[0]}`);
  } else if (locBoost > 0) {
    why.push("In a location you prefer");
  }
  if (cyber >= 0.34) why.push(`Cybersecurity match (${pct(cyber)})`);
  if (bestTitleSim >= 0.5) {
    why.push(`Title aligns with your target roles (${pct(bestTitleSim)})`);
  } else if (bestTitleSim > 0) {
    why.push(`Title partially matches your target roles (${pct(bestTitleSim)})`);
  }
  if (overlapStretched >= 0.3) {
    why.push(`Strong keyword overlap with your CVs (${pct(overlapStretched)})`);
  } else if (overlapStretched > 0) {
    why.push(`Some keyword overlap with your CVs (${pct(overlapStretched)})`);
  }
  if (fresh >= 0.9) why.push("Posted in the last 3 days");
  else if (fresh <= 0.3) why.push("Posting is over a month old");
  if (dismissPenalty > 0) {
    why.push("Similar roles or companies previously dismissed");
  }
  if (why.length === 0) why.push("No strong signal either way");

  return {
    ...posting,
    score,
    locationRank: tier,
    why: why.slice(0, 3),
  };
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function scoreMany(
  postings: JobPosting[],
  prefs: DiscoveryPreferences,
  cvs: CVContent[],
  state?: DiscoveryState,
): ScoredPosting[] {
  return postings.map((p) => scorePosting({ posting: p, prefs, cvs, state }));
}
