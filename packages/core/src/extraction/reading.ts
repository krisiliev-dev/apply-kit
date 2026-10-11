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

export interface JobReading {
  requirements: JobRequirement[];
  keyFacts: KeyFact[];
}

export function feedRequirements(facts: PostingFacts, text: string): FeedRequirement[] {
  return jobReading(facts, text).requirements.map(({ text: t, kind, status, needsYou }) => ({ text: t, kind, status, needsYou }));
}

export function jobReading(facts: PostingFacts, text: string): JobReading {
  const src = (s: SourceQuote): FactSource => ({ quote: s.quote, translation: s.translation, line: lineOf(text, s.quote) });
  const optSrc = (s: SourceQuote | null) => (s ? src(s) : null);
  const conf = (c: number) => Math.min(1, Math.max(0, c));
  const pref = (kind: string) => (kind === "preferred" ? " (preferred)" : "");

  const requirements: JobRequirement[] = facts.requirements.map((r, i) => ({
    key: `requirements:${i}`,
    text: r.text,
    askedAs: r.kind === "required" ? "Required" : "Preferred",
    kind: r.kind,
    status: "unknown",
    needsYou: false,
    confidence: conf(r.confidence),
    source: src(r.source),
  }));

  const keyFacts: KeyFact[] = [
    ...facts.years.map((y, i) => ({
      key: `years:${i}`, label: "Experience",
      value: `${y.max != null && y.max !== y.min ? `${y.min}–${y.max}` : `${y.min}+`} years in ${y.about}${pref(y.kind)}`,
      confidence: conf(y.confidence), needsYou: false, source: src(y.source),
    })),
    ...facts.languages.map((l, i) => ({
      key: `languages:${i}`, label: "Language", value: `${l.language}${l.level ? `, ${l.level}` : ""}${pref(l.kind)}`,
      confidence: conf(l.confidence), needsYou: false, source: src(l.source),
    })),
    ...facts.certificates.map((c, i) => ({
      key: `certificates:${i}`, label: "Certificate", value: `${c.name}${pref(c.kind)}`,
      confidence: conf(c.confidence), needsYou: false, source: src(c.source),
    })),
    {
      key: "remote", label: "Remote rules", value: facts.remote.mode === "not-stated" ? "Not stated" : facts.remote.summary,
      confidence: conf(facts.remote.confidence), needsYou: false, source: optSrc(facts.remote.source),
    },
    {
      key: "workAuthorisation", label: "Work authorisation",
      value: facts.workAuthorisation.visaSponsorship === "not-stated" && !facts.workAuthorisation.source ? "Not stated" : facts.workAuthorisation.summary,
      confidence: conf(facts.workAuthorisation.confidence), needsYou: false, source: optSrc(facts.workAuthorisation.source),
    },
    {
      key: "salary", label: "Salary", value: formatSalary(facts.salary),
      confidence: conf(facts.salary.confidence), needsYou: false, source: optSrc(facts.salary.source),
    },
  ];

  return { requirements, keyFacts };
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
