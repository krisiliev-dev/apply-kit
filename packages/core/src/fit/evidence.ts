// The evidence matcher: whether the master profile meets one requirement of a job, and which
// pieces are the evidence. Pure and deterministic (no model call), shared by the discovery engine
// (requirement statuses, Fit) and the preparation engine (the package's evidence map), so every
// screen tells the same story.
//
// - Years come from role dates: the roles about the same thing (their words, or their angle).
// - Languages and levels come from the pieces naming the language (Latin or Cyrillic).
// - Certificates and skills match by whole words (words.ts) in a piece's text, tags and role
//   title, with a small synonym table. Never substrings.
// - Only confirmed pieces count. A preferred item with no evidence is "not held", never a gap.
// - Location and work authorisation aren't in the profile: the dealbreakers check those.
import type { PostingFacts } from "../extraction/facts.ts";
import type { JobReading, RequirementStatus } from "../extraction/reading.ts";
import type { PieceEntry, ProfilePiece } from "../preparation/profile.ts";
import { phrasesIn, words } from "../words.ts";
import { angleKeywords, angles, type Angle } from "./angles.ts";

export type RequirementCategory = PostingFacts["requirements"][number]["category"];

export interface RequirementToMatch {
  /** Short English label, e.g. "3+ years in security operations". */
  text: string;
  kind: "required" | "preferred";
  category: RequirementCategory;
}

/** A piece used as evidence, named the way the Job page shows it. */
export interface EvidencePiece {
  id: string;
  /** "Orbital Bank, Junior Security Analyst 2023–present", or the piece's own text. */
  label: string;
}

export interface Evidence {
  status: RequirementStatus;
  /** The pieces behind a met or partly-met status; empty for a gap. */
  pieces: EvidencePiece[];
  /** What was found, in plain words, e.g. "3 years 8 months from your role dates". */
  note: string;
}

// ---------------------------------------------------------------- words, synonyms

/** Words that say nothing about what is asked: ignored. */
const stopWords = new Set([
  "a", "an", "and", "or", "the", "of", "in", "on", "with", "for", "to", "at", "as", "by", "from", "into", "within",
  "experience", "experienced", "knowledge", "skill", "strong", "good", "solid", "deep", "understanding", "familiarity",
  "familiar", "working", "hand", "practical", "proven", "ability", "able", "background", "plus", "year", "basic",
  "advanced", "expert", "expertise", "proficiency", "proficient", "using", "use", "tool", "tooling", "e", "g", "eg", "etc",
  "such", "like", "similar", "related", "relevant", "professional", "preferred", "required", "nice", "have", "must",
  "is", "are", "be", "least", "minimum", "commercial", "industry", "environment", "practice", "concept", "principle",
  "и", "или", "на", "в", "с", "за", "от", "опит", "познания", "умения", "години",
]);

/** Broad words: they can complete a match, but alone never make a requirement partly met. */
const weakWords = new Set([
  "security", "design", "development", "software", "engineering", "system", "web", "data", "operation", "management",
  "technical", "technology", "it", "network", "application", "service", "solution", "platform", "team", "support",
  "analysis", "testing", "cloud", "infrastructure", "product", "process", "tech", "computer", "science",
]);

/**
 * Phrases that mean the same thing, Latin and Cyrillic; the first one names the group. Data, not
 * logic: edit freely, keep it small and specific.
 */
const synonyms: string[][] = [
  ["development", "developer", "developing", "разработка", "разработчик", "програмиране"],
  ["security", "сигурност"],
  ["cybersecurity", "cyber security", "киберсигурност"],
  ["information security", "infosec", "информационна сигурност"],
  ["incident response", "incident handling", "реакция при инциденти"],
  ["penetration testing", "pentest", "pentesting", "pen testing", "тестове за проникване"],
  ["kubernetes", "k8s"],
  ["javascript", "js"],
  ["typescript", "ts"],
  ["postgresql", "postgres"],
  ["golang", "go"],
  ["dotnet", "net", "c#"],
  ["nodejs", "node", "node js"],
  ["react", "reactjs", "react js"],
  ["linux", "линукс"],
  ["network", "networking", "мрежи", "мрежова"],
  ["design", "дизайн"],
  ["user experience", "ux"],
  ["user interface", "ui"],
  ["soc", "security operations center", "security operations centre"],
  ["computer science", "компютърни науки", "информатика"],
];

/** Evidence of one thing is evidence of another: a Splunk piece shows SIEM work. */
const implies: Record<string, string[]> = {
  splunk: ["siem"], qradar: ["siem"], sentinel: ["siem"], arcsight: ["siem"], elastic: ["siem"],
  soc: ["security operations"],
  react: ["javascript"], typescript: ["javascript"], nodejs: ["javascript"],
};

/** A crude English plural fold, so "incidents" meets "incident". */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

const tokensOf = (text: string) => words(text).map(stem);

/** Synonym phrases as token sequences, longest first, each with the group's name. */
const synonymPhrases = synonyms
  .flatMap((group) => group.map((p) => ({ tokens: tokensOf(p), name: tokensOf(group[0]!).join(" ") })))
  .sort((a, b) => b.tokens.length - a.tokens.length);

/** The terms of a text: stemmed words, with any synonym phrase replaced by its group's name. */
function termsOf(text: string): string[] {
  const t = tokensOf(text);
  const out: string[] = [];
  outer: for (let i = 0; i < t.length;) {
    for (const s of synonymPhrases) {
      if (s.tokens.length > 0 && s.tokens.every((w, k) => t[i + k] === w)) { out.push(s.name); i += s.tokens.length; continue outer; }
    }
    out.push(t[i]!);
    i++;
  }
  return out;
}

/** The terms that matter, without stop words. */
const significant = (text: string) => termsOf(text).filter((w) => !stopWords.has(w));
/** Strong terms are specific: one of them alone is worth "partly". */
const isWeak = (term: string) => term.split(" ").every((w) => weakWords.has(w) || stopWords.has(w));

/** Every term a piece covers: its text, tags and (a role's) title, plus what they imply. */
function coverOf(texts: string[]): Set<string> {
  const terms = new Set(texts.flatMap(termsOf));
  for (const t of [...terms]) for (const i of implies[t] ?? []) for (const x of termsOf(i)) terms.add(x);
  // A multi-word group name also covers its words ("security operations" covers "security").
  for (const t of [...terms]) if (t.includes(" ")) for (const w of t.split(" ")) terms.add(w);
  return terms;
}

/** Whether a piece's cover holds a term; a multi-word term also by all its words ("response to incidents"). */
const covers = (cover: Set<string>, term: string) => cover.has(term) || (term.includes(" ") && term.split(" ").every((w) => cover.has(w)));

const pieceTexts = (p: ProfilePiece) => [p.text, ...p.tags, ...(p.entry ? [p.entry.title] : [])];

// ---------------------------------------------------------------- labels

const year = (month: string) => month.slice(0, 4);
const roleLabel = (e: PieceEntry) => `${e.organisation}, ${e.title} ${year(e.start)}${e.end && year(e.end) === year(e.start) ? "" : `–${e.end ? year(e.end) : "present"}`}`;
const labelOf = (p: ProfilePiece): EvidencePiece => ({ id: p.id, label: p.entry ? roleLabel(p.entry) : p.text });

function duration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const part = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return [y > 0 ? part(y, "year") : "", m > 0 ? part(m, "month") : ""].filter(Boolean).join(" ") || "less than a month";
}

const noEvidence = "No evidence in your master profile";
const notHeld = "Not held: left out, not claimed. Preferred items never count as gaps";

// ---------------------------------------------------------------- years

const YEARS = /(\d+(?:\.\d+)?)\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d+\s*)?\+?\s*(?:years?|yrs?)\b(.*)$/i;

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const nowMonth = (now: Date) => now.getUTCFullYear() * 12 + now.getUTCMonth();

/** Months covered by the roles, overlaps counted once; a current role runs to this month. */
function monthsIn(roles: ProfilePiece[], now: Date): number {
  const spans = roles
    .map((r) => [monthIndex(r.entry!.start), r.entry!.end ? monthIndex(r.entry!.end) : nowMonth(now)] as const)
    .filter(([a, b]) => b >= a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let upTo = -Infinity;
  for (const [a, b] of spans) {
    const from = Math.max(a, upTo + 1);
    if (b >= from) total += b - from + 1;
    upTo = Math.max(upTo, b);
  }
  return total;
}

function yearsEvidence(min: number, about: string, pieces: ProfilePiece[], now: Date): Omit<Evidence, "status"> & { status: "met" | "partly" | "gap" } {
  const roles = pieces.filter((p) => p.kind === "role" && p.entry);
  const terms = significant(about);
  const strong = terms.filter((t) => !isWeak(t));
  const aboutAngles = angles.filter((a) => phrasesIn(words(about), angleKeywords[a]).length > 0);
  const relevant = roles.filter((r) => {
    const cover = coverOf([...pieceTexts(r), ...pieces.filter((p) => p.belongsTo === r.id).flatMap(pieceTexts)]);
    if (terms.length === 0) return true;
    if (terms.every((t) => covers(cover, t))) return true;
    return strong.length === 0 && r.angles.some((a) => aboutAngles.includes(a as Angle));
  });
  if (relevant.length === 0) return { status: "gap", pieces: [], note: noEvidence };
  const months = monthsIn(relevant, now);
  const ordered = [...relevant].sort((a, b) => b.entry!.start.localeCompare(a.entry!.start));
  const status = months >= min * 12 ? "met" : "partly";
  const note = status === "met" ? `${duration(months)} from your role dates` : `${duration(months)} from your role dates, of the ${min} years asked`;
  return { status, pieces: ordered.map(labelOf), note };
}

// ---------------------------------------------------------------- skills, certificates, education

/** "SIEM: Splunk or Elastic" → the terms of each alternative: [siem, splunk], [siem, elastic]. */
function alternatives(text: string): string[][] {
  const colon = text.indexOf(":");
  const head = colon >= 0 ? text.slice(0, colon) : "";
  const tail = colon >= 0 ? text.slice(colon + 1) : text;
  return tail.split(/\s+or\s+|\s+или\s+|\//i)
    .map((alt) => significant(`${head} ${alt}`))
    .filter((terms) => terms.length > 0);
}

function termsEvidence(text: string, pieces: ProfilePiece[], { partial }: { partial: boolean }): Evidence {
  const alts = alternatives(text);
  if (alts.length === 0) return { status: "gap", pieces: [], note: noEvidence };
  const scored = pieces.map((p) => {
    const cover = coverOf(pieceTexts(p));
    const best = alts
      .map((terms) => ({ terms, found: terms.filter((t) => covers(cover, t)) }))
      .reduce((a, b) => (b.found.length / b.terms.length > a.found.length / a.terms.length ? b : a));
    return { piece: p, ...best, full: best.found.length === best.terms.length, strong: best.found.some((t) => !isWeak(t)) };
  });
  const full = scored.filter((s) => s.full);
  if (full.length > 0) return { status: "met", pieces: full.slice(0, 3).map((s) => labelOf(s.piece)), note: "In your master profile" };
  const some = scored.filter((s) => s.strong).sort((a, b) => b.found.length / b.terms.length - a.found.length / a.terms.length);
  if (!partial || some.length === 0) return { status: "gap", pieces: [], note: noEvidence };
  const top = some[0]!;
  const missing = top.terms.filter((t) => !top.found.includes(t));
  return { status: "partly", pieces: [labelOf(top.piece)], note: `Partly: no evidence for ${missing.join(", ")}` };
}

// ---------------------------------------------------------------- languages

/** Language names, English first, then other spellings (Bulgarian included). */
const languageNames: string[][] = [
  ["English", "английски", "англ"], ["Bulgarian", "български", "bg"], ["German", "немски", "deutsch"],
  ["French", "френски", "français"], ["Spanish", "испански", "español"], ["Russian", "руски"], ["Italian", "италиански"],
  ["Turkish", "турски"], ["Greek", "гръцки"], ["Romanian", "румънски"], ["Dutch", "нидерландски", "холандски"],
  ["Polish", "полски"], ["Portuguese", "португалски"], ["Serbian", "сръбски"], ["Macedonian", "македонски"],
];

/** Levels on one scale: CEFR A1 = 1 … C2 = 6, native = 7. */
const levelWords: [RegExp, number, string][] = [
  [/\b(native|mother tongue|bilingual)\b|роден|майчин/i, 7, "native"],
  [/\bc2\b|\bproficient\b/i, 6, "C2"],
  [/\bc1\b|\bfluent\b|\bfluency\b|\bprofessional\b|\badvanced\b|свободно|отлично/i, 5, "C1"],
  [/\bb2\b|upper[- ]intermediate|\bbusiness\b|\bgood\b|добро/i, 4, "B2"],
  [/\bb1\b|\bintermediate\b|\bworking\b|\bconversational\b|средно/i, 3, "B1"],
  [/\ba2\b|\bbasic\b|\belementary\b|основно/i, 2, "A2"],
  [/\ba1\b|\bbeginner\b|начално/i, 1, "A1"],
];

function levelOf(text: string): { rank: number; label: string } | null {
  for (const [re, rank, label] of levelWords) if (re.test(text)) return { rank, label };
  return null;
}

/** The language a requirement names, if any. */
const languageIn = (text: string) => {
  const w = words(text);
  return languageNames.find((names) => names.some((n) => w.includes(n.toLowerCase())));
};

function languageEvidence(names: string[], text: string, pieces: ProfilePiece[]): Evidence {
  const holding = pieces.filter((p) => {
    const w = new Set(pieceTexts(p).flatMap((t) => words(t)));
    return names.some((n) => w.has(n.toLowerCase()));
  });
  if (holding.length === 0) return { status: "gap", pieces: [], note: noEvidence };
  const asked = levelOf(text.replace(new RegExp(names.join("|"), "gi"), " "));
  const held = holding.map((p) => ({ p, level: levelOf(pieceTexts(p).join(" ")) })).sort((a, b) => (b.level?.rank ?? 0) - (a.level?.rank ?? 0))[0]!;
  const piece = [labelOf(held.p)];
  if (!asked || (held.level && held.level.rank >= asked.rank)) return { status: "met", pieces: piece, note: held.level ? `${names[0]} ${held.level.label}` : names[0]! };
  if (!held.level) return { status: "partly", pieces: piece, note: `Your profile doesn't say your level; ${asked.label} asked` };
  return { status: "partly", pieces: piece, note: `Your profile says ${held.level.label}; ${asked.label} asked` };
}

// ---------------------------------------------------------------- matching

/** Whether the master profile meets `requirement`, from its confirmed pieces. */
export function matchEvidence(requirement: RequirementToMatch, profile: readonly ProfilePiece[], now: Date): Evidence {
  const pieces = profile.filter((p) => p.status === "confirmed");
  const preferred = requirement.kind === "preferred";
  const { text, category } = requirement;
  if (category === "location" || category === "work-authorisation") {
    return { status: "unknown", pieces: [], note: "Checked by your dealbreakers, not your master profile" };
  }
  const years = YEARS.exec(text);
  const language = category === "language" || category === "other" ? languageIn(text) : undefined;
  const found = years ? yearsEvidence(Number(years[1]), years[2]!, pieces, now)
    : language ? languageEvidence(language, text, pieces)
    : termsEvidence(text, pieces, { partial: category !== "certificate" });
  if (found.status === "gap" && preferred) return { status: "not-held", pieces: [], note: notHeld };
  return found;
}

/**
 * A Job's reading with each requirement's status and evidence from the master profile. Without a
 * confirmed piece there is no master profile yet: the reading is returned as it is ("unknown").
 */
export function withEvidence(reading: JobReading, facts: PostingFacts, profile: readonly ProfilePiece[], now: Date): JobReading {
  if (!profile.some((p) => p.status === "confirmed")) return reading;
  return {
    ...reading,
    requirements: reading.requirements.map((r, i) => {
      const category = facts.requirements[i]?.category ?? "other";
      const { status, pieces, note } = matchEvidence({ text: r.text, kind: r.kind, category }, profile, now);
      return { ...r, status, evidence: { pieces, note } };
    }),
  };
}
