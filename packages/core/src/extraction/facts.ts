// The facts an extractor pulls out of one Posting. This schema is the contract at the AI seam:
// the real extractor asks the model for exactly this shape (structured output), and the engine
// validates whatever comes back against it before storing anything.
//
// Rules for the shape (kept compatible with strict JSON-schema structured outputs):
// every field is required, "absent" is expressed with null, no numeric bounds in the schema
// (the engine clamps confidence to 0..1 itself).
import { z } from "zod";

/** Where a fact came from: the exact words in the posting, plus an English translation if the posting isn't English. */
export const sourceQuoteSchema = z.object({
  /** Copied verbatim from the posting text, in its original language. */
  quote: z.string(),
  /** English translation of the quote, or null when the posting is in English. */
  translation: z.string().nullable(),
});

/** 0 = a guess, 1 = stated plainly. Below the engine's threshold a fact needs Kris to confirm it. */
const confidence = z.number();
const kind = z.enum(["required", "preferred"]);

export const requirementSchema = z.object({
  /** Short English label, e.g. "3+ years in security operations", "Kubernetes security". */
  text: z.string(),
  kind,
  category: z.enum(["skill", "experience", "language", "certificate", "education", "location", "work-authorisation", "other"]),
  source: sourceQuoteSchema,
  confidence,
});

export const yearsSchema = z.object({
  /** The lowest number of years asked, e.g. 3 for "3+ years" or "3-5 years". */
  min: z.number(),
  max: z.number().nullable(),
  /** What the years are of, in English, e.g. "security operations". */
  about: z.string(),
  kind,
  source: sourceQuoteSchema,
  confidence,
});

export const languageSchema = z.object({
  /** English name of the language, e.g. "English", "Bulgarian". */
  language: z.string(),
  /** The level as asked, in English, e.g. "fluent", "professional", "C1", or null. */
  level: z.string().nullable(),
  kind,
  source: sourceQuoteSchema,
  confidence,
});

export const certificateSchema = z.object({
  name: z.string(),
  kind,
  source: sourceQuoteSchema,
  confidence,
});

export const workAuthorisationSchema = z.object({
  /** One English sentence, e.g. "Right to work in Bulgaria, no visa sponsorship". */
  summary: z.string(),
  visaSponsorship: z.enum(["offered", "not-offered", "not-stated"]),
  source: sourceQuoteSchema.nullable(),
  confidence,
});

export const remoteSchema = z.object({
  mode: z.enum(["on-site", "hybrid", "remote", "not-stated"]),
  /** One English sentence, e.g. "Hybrid: 2 days a week in the Sofia office". */
  summary: z.string(),
  /** Places the job is tied to or open to, in English, e.g. ["Sofia"], ["EU"]. */
  locations: z.array(z.string()),
  source: sourceQuoteSchema.nullable(),
  confidence,
});

export const salarySchema = z.object({
  /** False when the posting says nothing about pay; then every other field is null. */
  stated: z.boolean(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  /** ISO 4217 code (EUR, BGN, GBP, ...), or null when the posting doesn't say. */
  currency: z.string().nullable(),
  period: z.enum(["year", "month", "day", "hour"]).nullable(),
  basis: z.enum(["gross", "net", "not-stated"]),
  source: sourceQuoteSchema.nullable(),
  confidence,
});

export const postingFactsSchema = z.object({
  /** ISO 639-1 code of the posting's language, e.g. "en", "bg". */
  language: z.string().describe("ISO 639-1 code of the posting’s written language: en for English, bg for Bulgarian. Use a code, never a language name."),
  /** The job title in English when the posting isn't in English, e.g. "SOC Analyst L2"; null for English postings. */
  titleTranslation: z.string().nullable(),
  requirements: z.array(requirementSchema),
  years: z.array(yearsSchema),
  languages: z.array(languageSchema),
  certificates: z.array(certificateSchema),
  workAuthorisation: workAuthorisationSchema,
  remote: remoteSchema,
  salary: salarySchema,
});

export type SourceQuote = z.infer<typeof sourceQuoteSchema>;
export type ExtractedRequirement = z.infer<typeof requirementSchema>;
export type ExtractedYears = z.infer<typeof yearsSchema>;
export type ExtractedLanguage = z.infer<typeof languageSchema>;
export type ExtractedCertificate = z.infer<typeof certificateSchema>;
export type ExtractedWorkAuthorisation = z.infer<typeof workAuthorisationSchema>;
export type ExtractedRemote = z.infer<typeof remoteSchema>;
export type ExtractedSalary = z.infer<typeof salarySchema>;
export type PostingFacts = z.infer<typeof postingFactsSchema>;

/** What the engine hands an extractor: one Posting, already turned into plain text. */
export interface ExtractionInput {
  title: string;
  company: string;
  /** Location as the Source states it, or null. */
  location: string | null;
  /** The posting body as plain text, one line per paragraph or list item. */
  text: string;
}

export interface ExtractionResult {
  facts: PostingFacts;
  /** What this call cost in USD (as reported by the provider, else estimated from tokens). */
  costUsd: number;
  /** The model that answered, for the record. */
  model: string;
}

/** Tolerates names returned by older providers and cached readings for our two package languages. */
export function postingLanguageCode(value: string): string {
  const language = value.trim().toLowerCase();
  return language === "bulgarian" ? "bg" : language === "english" ? "en" : language;
}
