// From stored facts to what Kris sees: requirements, key facts with their source lines, the
// facts that need him, and the cautious reading used until he answers. Pure functions.
import type { ExtractedSalary, PostingFacts, SourceQuote } from "./facts.ts";
import { lineOf } from "./text.ts";

/** Whether Kris meets a requirement. "unknown" until there is a master profile to check against. */
export type RequirementStatus = "met" | "partly" | "gap" | "unknown";

export interface FeedRequirement {
  text: string;
  /** As used for screening: a low-confidence "required" counts as preferred until Kris confirms it. */
  kind: "required" | "preferred";
  status: RequirementStatus;
  needsYou: boolean;
}

/** The words a fact came from, and the line of the posting text they are on ("show where"). */
export interface FactSource extends SourceQuote {
  /** 1-based line in the Job's postingText, or null if the quote couldn't be found there. */
  line: number | null;
}

export interface JobRequirement extends FeedRequirement {
  /** Stable within one read of the posting, e.g. "requirements:2". */
  key: string;
  /** How the posting asks for it; "Unclear" while a low-confidence reading waits for Kris. */
  askedAs: "Required" | "Preferred" | "Unclear";
  confidence: number;
  source: FactSource;
}

export interface KeyFact {
  /** Stable within one read of the posting: "years:0", "languages:1", "certificates:0", "salary", "remote", "workAuthorisation". */
  key: string;
  label: string;
  /** The reading in plain English, e.g. "€2,800–3,600 gross/month", "Not stated". */
  value: string;
  confidence: number;
  needsYou: boolean;
  /** Null when the posting says nothing about it. */
  source: FactSource | null;
}

/** A low-confidence fact waiting for Kris; until he answers, the cautious reading is used. */
export interface NeedsYouItem {
  /** The key of the requirement or key fact it is about. */
  key: string;
  label: string;
  question: string;
  /** What the model read. */
  extracted: string;
  /** What screening uses until Kris answers: the reading that can't wrongly count against the job. */
  cautious: string;
  source: FactSource | null;
}

/**
 * The reading screening uses (dealbreakers, Fit): confident facts as read, low-confidence ones in
 * their cautious form (a doubtful requirement counts as preferred, a doubtful salary, remote rule
 * or visa rule as not stated).
 */
export interface Screening {
  /** The lowest confidently required number of years, or null if none is required. */
  yearsRequired: number | null;
  languagesRequired: string[];
  certificatesRequired: string[];
  /** Null when the salary isn't stated or isn't read reliably. */
  salary: ExtractedSalary | null;
  remote: { mode: "on-site" | "hybrid" | "remote" | "not-stated"; locations: string[] };
  visaSponsorship: "offered" | "not-offered" | "not-stated";
  /** True while any fact waits for Kris: anything computed from this reading is provisional. */
  provisional: boolean;
}

export interface JobReading {
  requirements: JobRequirement[];
  keyFacts: KeyFact[];
  needsYou: NeedsYouItem[];
  screening: Screening;
}

/** Below this confidence a fact needs Kris to confirm it. */
export const LOW_CONFIDENCE = 0.7;
/** Confidence given to a fact whose quote isn't in the posting: it may be invented. */
const UNFOUND_CONFIDENCE = 0.5;

type Kind = "required" | "preferred";

export function jobReading(facts: PostingFacts, text: string): JobReading {
  const needsYou: NeedsYouItem[] = [];
  const src = (s: SourceQuote): FactSource => ({ quote: s.quote, translation: s.translation, line: lineOf(text, s.quote) });
  /** Confidence clamped to 0..1, and capped when the quoted words aren't in the posting. */
  const trust = (c: number, source: FactSource | null) => {
    const v = Math.min(1, Math.max(0, Number.isFinite(c) ? c : 0));
    return source && source.line == null ? Math.min(v, UNFOUND_CONFIDENCE) : v;
  };
  const ask = (item: NeedsYouItem) => { needsYou.push(item); return true; };

  /** A fact asked as required or preferred: when doubtful, it counts as preferred. */
  const kinded = (key: string, label: string, question: string, base: string, kind: Kind, confidence: number, quote: SourceQuote) => {
    const source = src(quote);
    const c = trust(confidence, source);
    const low = c < LOW_CONFIDENCE;
    const cap = (k: Kind) => (k === "required" ? "Required" : "Preferred");
    const needs = low && ask({ key, label, question, extracted: `${cap(kind)}: ${base}`, cautious: `Preferred: ${base}`, source });
    return { key, source, confidence: c, needsYou: needs, kind: (low ? "preferred" : kind) as Kind, low };
  };

  const requirements: JobRequirement[] = facts.requirements.map((r, i) => {
    const k = kinded(`requirements:${i}`, "Requirement", `Is "${r.text}" required?`, r.text, r.kind, r.confidence, r.source);
    return {
      key: k.key, text: r.text, askedAs: k.low ? "Unclear" : r.kind === "required" ? "Required" : "Preferred",
      kind: k.kind, status: "unknown", needsYou: k.needsYou, confidence: k.confidence, source: k.source,
    };
  });

  const keyFacts: KeyFact[] = [];
  const pref = (kind: Kind) => (kind === "preferred" ? " (preferred)" : "");
  const kindedFact = (label: string, k: ReturnType<typeof kinded>, base: string) =>
    keyFacts.push({ key: k.key, label, value: `${base}${pref(k.kind)}`, confidence: k.confidence, needsYou: k.needsYou, source: k.source });

  const years = facts.years.map((y, i) => {
    const base = `${y.max != null && y.max !== y.min ? `${y.min}–${y.max}` : `${y.min}+`} years in ${y.about}`;
    const k = kinded(`years:${i}`, "Experience", "Years of experience: is this one required?", base, y.kind, y.confidence, y.source);
    kindedFact("Experience", k, base);
    return { min: y.min, kind: k.kind };
  });
  const languages = facts.languages.map((l, i) => {
    const base = `${l.language}${l.level ? `, ${l.level}` : ""}`;
    const k = kinded(`languages:${i}`, "Language", `Is ${l.language} required?`, base, l.kind, l.confidence, l.source);
    kindedFact("Language", k, base);
    return { language: l.language, kind: k.kind };
  });
  const certificates = facts.certificates.map((c, i) => {
    const k = kinded(`certificates:${i}`, "Certificate", `Is ${c.name} required?`, c.name, c.kind, c.confidence, c.source);
    kindedFact("Certificate", k, c.name);
    return { name: c.name, kind: k.kind };
  });

  /** A single fact (remote, visa, salary): when doubtful, it counts as not stated. */
  const single = (key: string, label: string, question: string, read: string, confidence: number, quote: SourceQuote | null) => {
    const source = quote ? src(quote) : null;
    const c = trust(confidence, source);
    const low = c < LOW_CONFIDENCE && read !== "Not stated";
    if (low) ask({ key, label, question, extracted: read, cautious: "Not stated", source });
    keyFacts.push({ key, label, value: low ? "Not stated" : read, confidence: c, needsYou: low, source });
    return !low;
  };

  const remoteRead = facts.remote.mode === "not-stated" ? "Not stated" : facts.remote.summary;
  const remoteOk = single("remote", "Remote rules", "Remote rules: couldn't read them reliably", remoteRead, facts.remote.confidence, facts.remote.source);
  const wa = facts.workAuthorisation;
  const waRead = wa.visaSponsorship === "not-stated" && !wa.source ? "Not stated" : wa.summary;
  const waOk = single("workAuthorisation", "Work authorisation", "Work authorisation: couldn't read it reliably", waRead, wa.confidence, wa.source);
  const salaryRead = formatSalary(facts.salary);
  const salaryOk = single("salary", "Salary", "Salary: couldn't read it reliably", salaryRead, facts.salary.confidence, facts.salary.source);

  const requiredYears = years.filter((y) => y.kind === "required").map((y) => y.min);
  const screening: Screening = {
    yearsRequired: requiredYears.length ? Math.min(...requiredYears) : null,
    languagesRequired: languages.filter((l) => l.kind === "required").map((l) => l.language),
    certificatesRequired: certificates.filter((c) => c.kind === "required").map((c) => c.name),
    salary: salaryOk && salaryRead !== "Not stated" ? facts.salary : null,
    remote: remoteOk ? { mode: facts.remote.mode, locations: facts.remote.locations } : { mode: "not-stated", locations: [] },
    visaSponsorship: waOk ? wa.visaSponsorship : "not-stated",
    provisional: needsYou.length > 0,
  };

  // Requirements first, then key facts, in the order they are shown.
  const order = [...requirements.map((r) => r.key), ...keyFacts.map((f) => f.key)];
  needsYou.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return { requirements, keyFacts, needsYou, screening };
}

const symbols: Record<string, string> = { EUR: "€", GBP: "£", USD: "$" };
const periods: Record<string, string> = { year: "year", month: "month", day: "day", hour: "hour" };

/** "€2,800–3,600 gross/month", "5,500–7,000 BGN/month", "Not stated". */
export function formatSalary(s: ExtractedSalary): string {
  if (!s.stated || (s.min == null && s.max == null)) return "Not stated";
  const n = (v: number) => v.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  const amount = s.min != null && s.max != null && s.max !== s.min ? `${n(s.min)}–${n(s.max)}` : n((s.min ?? s.max)!);
  const code = s.currency?.toUpperCase() ?? null;
  const money = code && symbols[code] ? `${symbols[code]}${amount}` : code ? `${amount} ${code}` : `${amount} (currency not stated)`;
  const basis = s.basis === "not-stated" ? "" : ` ${s.basis}`;
  const per = s.period ? `/${periods[s.period]}` : "";
  return `${money}${basis}${per}`;
}
