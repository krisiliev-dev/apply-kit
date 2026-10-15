// Track's email vocabulary and matching signals (spec #24 "Matching rules", ADR 0004). The tracker
// runs the flow (tracker.ts: processMail); this module holds what it decides with: the Track
// assistant port and its classification shape, the rule-based fallback for known job-system
// confirmations, and the deterministic signals that tie an email to an Application.
import { z } from "zod";
import { htmlToText } from "./extraction/text.ts";
import { normaliseCompany, normaliseTitle } from "./matching.ts";
import type { DraftInput, DraftOutput } from "./follow-ups.ts";
import type { MailMessage } from "./ports.ts";
import { jobCards } from "./sources/email/cards.ts";
import { readEmailHtml } from "./sources/email/html.ts";
import { parseFrom, senders } from "./sources/email/senders.ts";

/** What an email is, as the glossary names it ("Matched email"). */
export const emailKinds = ["confirmation", "rejection", "interview-invitation", "offer", "info-request", "other"] as const;
export type EmailKind = (typeof emailKinds)[number];

/** The Track assistant's reading of one email. Validated before it is used. */
export const emailClassificationSchema = z.object({
  kind: z.enum(emailKinds),
  /** 0 to 1: how sure the reading is. Only a high one may change a Status on its own. */
  confidence: z.number().min(0).max(1),
  /** The company and job title the email mentions, as written, or null. */
  company: z.string().nullable(),
  jobTitle: z.string().nullable(),
  /** For an invitation: a first call (with a recruiter or HR) is screening; anything later is an interview. */
  stage: z.enum(["screening", "interview"]).nullable(),
  /** ISO 639-1, such as "en" or "bg". */
  language: z.string(),
  /** A one-line English summary for an email not in English; null for English mail. */
  summary: z.string().nullable(),
});
export type EmailClassification = z.infer<typeof emailClassificationSchema>;

/** A drafted message as the assistant returns it: the body only. Validated before it is used. */
export const draftOutputSchema = z.object({ body: z.string() });

/** The minimum of an email the assistant is shown: who sent it, the subject and the text (trimmed). */
export interface ClassifyInput {
  /** The Message-ID. Never sent to the model; it lets fakes answer per email. */
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  text: string;
}

/**
 * Track's AI seam (spec #24 "AI seam"): classifying an email and drafting a message; prep sheets join
 * it with their ticket. Each task's estimate is checked against the shared monthly cap before calling. The service passes the OpenRouter implementation; tests pass a fake
 * answering with recorded outputs.
 */
export interface TrackAssistant {
  /** A cautious (high) estimate of the cost in USD, checked against the monthly cap before calling. No I/O. */
  estimateClassifyUsd(input: ClassifyInput): number;
  /** Throws on any failure; the email is then matched on rules alone. */
  classify(input: ClassifyInput): Promise<{ classification: EmailClassification; costUsd: number; model: string }>;
  /** A cautious (high) estimate of drafting this message, in USD. No I/O. */
  estimateDraftUsd(input: DraftInput): number;
  /** Drafts the body of one message. Throws on any failure (the user gets the outline). May carry `costUsd` if billed. */
  draft(input: DraftInput): Promise<{ draft: DraftOutput; costUsd: number; model: string }>;
}

/** How confident the assistant must be for an email to change a Status on its own. */
export const highConfidence = 0.8;

/** Kinds that are a human reply (GLOSSARY "Reply"): a confirmation isn't one. */
export const replyKinds: readonly EmailKind[] = ["rejection", "interview-invitation", "offer", "info-request"];

/** In plain words, for the timeline and Needs you. */
export const emailKindName: Record<EmailKind, string> = {
  confirmation: "Confirmation", rejection: "Rejection", "interview-invitation": "Interview invitation", offer: "Offer",
  "info-request": "Request for information", other: "Email",
};

/** At most this much of an email's text goes to the assistant. */
const maxClassifyChars = 4_000;

export function textOf(m: Pick<MailMessage, "text" | "html">): string {
  return (m.text.trim() || htmlToText(m.html)).trim();
}

export function classifyInput(m: MailMessage): ClassifyInput {
  return { messageId: m.id, from: m.from, subject: m.subject, receivedAt: m.receivedAt.toISOString(), text: textOf(m).slice(0, maxClassifyChars) };
}

/** A short quote of the email, as Needs you and the Application page show it. */
export function quoteOf(m: Pick<MailMessage, "text" | "html">, max = 320): string {
  const t = textOf(m).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const senderOf = (m: Pick<MailMessage, "from">) => parseFrom(m.from);
export const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/** "mail.varnatrust.bg" → "varnatrust.bg"; keeps three labels for "co.uk"-style suffixes. */
export function baseDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const second = labels.at(-2)!;
  const keep = labels.at(-1)!.length === 2 && ["co", "com", "org", "net", "ac", "gov", "edu"].includes(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export function hostOf(url: string): string | null {
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

/** Mail providers many people share: a domain rule there would catch strangers, so rules use the address. */
const sharedProviders = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com", "me.com",
  "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "yandex.com", "abv.bg", "mail.bg", "dir.bg",
]);
export const isSharedProvider = (domain: string) => sharedProviders.has(baseDomain(domain));

/** Job systems that send mail for many employers: their domain says nothing about which. */
const atsDomains = [
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "myworkday.com", "myworkdayjobs.com", "workday.com", "recruitee.com",
  "smartrecruiters.com", "smartrecruiters-mail.com", "teamtailor.com", "teamtailor-mail.com", "personio.de", "personio.com",
  "ashbyhq.com", "workable.com", "workablemail.com", "bamboohr.com", "jobvite.com", "icims.com",
];
export const isAtsDomain = (domain: string) => atsDomains.includes(baseDomain(domain));

/** Boards and aggregators: a posting there doesn't make its domain the employer's. */
const boardDomains = new Set([
  "linkedin.com", "jobs.bg", "dev.bg", "indeed.com", "glassdoor.com", "jooble.org", "reed.co.uk", "europa.eu", "google.com",
  "amazon.jobs", "careers.microsoft.com", "microsoft.com",
]);
export const isBoardDomain = (domain: string) => boardDomains.has(baseDomain(domain)) || isAtsDomain(domain);

const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Whether a mail domain looks like the company's own ("northwind-labs.example" for "Northwind Labs"). */
export function companyDomainMatches(company: string, domain: string): boolean {
  const name = normaliseCompany(company);
  if (!name) return false;
  const label = compact(baseDomain(domain).split(".")[0] ?? "");
  const co = compact(name);
  if (label.length < 4 || co.length < 4) return false;
  return label === co || co.startsWith(label) || label.startsWith(co);
}

const phrase = (s: string) => ` ${normaliseTitle(s)} `;

/** Whether the text names this job title (case, punctuation and gender markers ignored). */
export function namesTitle(title: string, text: string): boolean {
  const t = normaliseTitle(title);
  return t.length > 0 && phrase(text).includes(` ${t} `);
}

/** Whether the text names this company (legal suffixes ignored). */
export function namesCompany(company: string, text: string): boolean {
  const c = normaliseCompany(company);
  return !!c && phrase(text).includes(` ${normaliseTitle(c)} `);
}

/** A job alert Discover reads: a known alert sender's email listing jobs it recognises. Track leaves these alone. */
export function isJobAlert(m: MailMessage): boolean {
  const from = parseFrom(m.from);
  return Object.values(senders).some((s) => s.isFrom(from, m.subject) && jobCards(readEmailHtml(m.html), s.jobLink).length > 0);
}

const confirmationSubject = new RegExp(
  [
    "thank(?:s| you) for (?:applying|your application|your interest)", "application (?:received|confirmation)",
    "we(?:'ve| have) received your application", "your application (?:to|for|has been received)",
    "благодарим (?:ви|Ви)? ?за (?:кандидатурата|интереса|проявения интерес)", "получихме (?:вашата|Вашата) кандидатура",
  ].join("|"),
  "i",
);

/**
 * The rule-based reading used when the AI budget is out (spec "Budget out"): only a known job
 * system's application-received template is recognised, as a confirmation. Anything else is unread.
 */
export function ruleClassify(m: MailMessage): EmailClassification | null {
  if (!isAtsDomain(domainOf(senderOf(m).address)) || !confirmationSubject.test(m.subject)) return null;
  return { kind: "confirmation", confidence: 0.9, company: null, jobTitle: null, stage: null, language: "en", summary: null };
}
