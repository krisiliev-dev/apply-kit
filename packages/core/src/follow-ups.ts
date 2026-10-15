// Follow-ups (GLOSSARY "After applying"): due actions on an Application that the user carries out
// themselves. This ticket's rules (spec #24, "Follow-up rules"): a nudge comes due a number of days
// after a stage began (applied, screening) with no reply, one per stage; a note to self comes due a day
// after an Offer. A Status change cancels the pending one, and undoing that change brings it back.
// The tracker owns their state; this module holds the types, the delays (settings) and the outline:
// plain points from the Application and its posting, with no model call.
import type { ProfileStory } from "./interviews.ts";

/**
 * nudge: a short follow-up email after a quiet stage. offer-note: a note to self about an offer.
 * thank-you: a note after an interview (#33), due 24 hours after its start, ready at its end.
 * check-in: a polite nudge once interviews go quiet (#33), a number of days after the last one ends.
 */

export type FollowUpKind = "nudge" | "offer-note" | "thank-you" | "check-in";

/** A follow-up as Needs you and the Application page show it. */
export interface FollowUp {
  id: string;
  applicationId: string;
  kind: FollowUpKind;
  /** The day its stage began (YYYY-MM-DD in Sofia): the date applied for a nudge after applying. */
  anchorOn: string;
  /** The day it is due: the delay after the anchor, or the day it was snoozed to. */
  dueOn: string;
  /** The day it was snoozed to, or null. */
  snoozedTo: string | null;
  /** pending until the user marks it sent (or done) or skips it. */
  state: "pending" | "sent" | "skipped";
  /** When it was marked sent or skipped, or null. */
  doneAt: string | null;
  /** Who marked it: you, or apply-kit on seeing your sent copy in the job mailbox ("email"); null while pending. */
  doneBy: "you" | "email" | null;
  /** The text as the user typed it ("" until they type). */
  text: string;
  /** For a thank-you note or a check-in: the interview it follows; null otherwise. */
  interviewId: string | null;
  /** For a thank-you note: the exact moment it is due (24 hours after the interview's start); null otherwise. */
  dueAt: string | null;
  /** For a thank-you note: when its draft is ready (the interview's end); null otherwise. */
  readyAt: string | null;
  /** For a thank-you note: one thing discussed, which makes it specific ("" until given). */
  topic: string;
}

/** The delays follow-ups come due after, in days. Settings; these are the defaults. */
export interface FollowUpSettings {
  /** A nudge, this many days after applying (or after moving to Screening) with no reply. */
  nudgeAfterDays: number;
  /** The note to self, this many days after an Offer. */
  offerNoteAfterDays: number;
  /** "Snooze" moves a follow-up this many days on from today. */
  snoozeDays: number;
  /** A check-in, this many days after the last interview ends with no news. (A thank-you's 24 hours are fixed.) */
  checkInAfterDays: number;
}

export const defaultFollowUpSettings: FollowUpSettings = { nudgeAfterDays: 7, offerNoteAfterDays: 1, snoozeDays: 3, checkInAfterDays: 7 };

const settingNames: Record<keyof FollowUpSettings, string> = {
  nudgeAfterDays: "The follow-up delay", offerNoteAfterDays: "The note-to-self delay", snoozeDays: "Snooze",
  checkInAfterDays: "The check-in delay",
};

/** Checks follow-up settings from outside (the settings form). Throws with a plain message when one is invalid. */
export function parseFollowUpSettings(input: unknown): FollowUpSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...defaultFollowUpSettings };
  for (const key of Object.keys(settingNames) as (keyof FollowUpSettings)[]) {
    const v = o[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 60) {
      throw new Error(`${settingNames[key]} must be a whole number of days from 1 to 60.`);
    }
    out[key] = v;
  }
  return out;
}

/** The day `n` days after a YYYY-MM-DD day. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD day to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** What the outline is built from: the Application, its posting and the user's own notes. */
export interface OutlineInput {
  kind: FollowUpKind;
  title: string;
  company: string;
  /** The day its stage began, in words ("Tue 6 Oct"). */
  since: string;
  stage: "applied" | "screening" | "offer";
  /** One requirement or line from the posting, when its Job was read; null otherwise. */
  postingDetail: string | null;
  /** The latest note the user wrote on the Application, or null. */
  note: string | null;
  /** For a thank-you note or a check-in: who the interview was with (may be empty), and the topic given. */
  people?: string[];
  topic?: string;
}

/**
 * The points to cover, deterministic and with no model call. Numbers and stories come only from the
 * user (their Master profile), so the outline names where to take them from and never invents one.
 */
export function outlineOf(i: OutlineInput): string[] {
  const whom = i.people?.length ? i.people.join(" and ") : null;
  if (i.kind === "thank-you") {
    return [
      `Thank ${whom ?? "them"} for the interview for ${i.title} on ${i.since}.`,
      i.topic?.trim()
        ? `The thing you discussed: "${i.topic.trim()}". Say in a sentence why it interested you.`
        : "One thing you discussed (add it above: it makes the note specific).",
      "Still interested; happy to go deeper on anything you touched on.",
      "Keep it short: no new claims, numbers only from your Master profile.",
    ];
  }
  if (i.kind === "check-in") {
    return [
      `Your last interview for ${i.title} at ${i.company}${whom ? ` (with ${whom})` : ""} was ${i.since}; no news since.`,
      "Ask politely where the process stands and when they expect to decide.",
      ...(i.note ? [`From your notes: "${i.note}".`] : []),
      "Still interested; no pressure.",
    ];
  }
  if (i.kind === "offer-note") {
    return [
      `The offer from ${i.company} for ${i.title} came ${i.since}. When do they need your answer?`,
      "One question to answer before deciding (salary against your minimum, start date, work pattern, contract).",
      "One action to take today: ask for anything missing in writing, or set a time to decide.",
    ];
  }
  const points = [
    i.stage === "applied"
      ? `Applied for ${i.title} on ${i.since}; still interested.`
      : `In screening for ${i.title} since ${i.since}; still interested and ready for the next step.`,
  ];
  if (i.postingDetail) points.push(`One detail from the posting: "${i.postingDetail}".`);
  if (i.note) points.push(`From your notes: "${i.note}".`);
  if (!i.postingDetail && !i.note) points.push("One concrete detail about the role or the company that drew you to it.");
  points.push("One true example of your own that fits it; numbers only from your Master profile.");
  points.push("Offer a call; no pressure.");
  return points;
}

// ---------- Drafts (Track #32; spec #24 "Draft rules") ----------

/**
 * The messages the Track assistant drafts. Only the nudge so far: thank-you notes, check-ins,
 * withdrawals and declines join with their tickets. A note to self is never drafted (its outline is it).
 */
export type DraftKind = "nudge";

/** The length that works well, in words, per kind (spec "Draft rules"). */
export const draftWords: Record<DraftKind, { min: number; max: number }> = { nudge: { min: 70, max: 110 } };

/**
 * Phrases a draft must never use (docs/knowledge/application-tactics.md: the follow-up draft rules
 * and the shared banned-phrase list). Matched case-insensitively, as whole words.
 */
export const bannedPhrases: readonly string[] = [
  "I wanted to reach out to express my deep interest", "as per my previous email", "I'm thrilled", "I am thrilled",
  "I'm excited to apply", "excited to apply", "I have always been passionate about", "passionate", "results-driven",
  "dynamic", "synergy", "I believe", "I think", "I feel", "thanks for considering", "thank you for considering",
  "looking forward to", "you've got this",
];

/** One piece of the user's Master profile a draft may draw on, and where it comes from. */
export interface ProfileEvidence {
  /** The piece in the user's own words, numbers as they confirmed them. */
  text: string;
  /** Where it is in the Master profile, in plain words ("Velora · Security Engineer (2022–2024)"). */
  origin: string;
}

/**
 * The Master profile as Track needs it (an assumed contract with Prepare, spec #51; its master profile
 * isn't built yet): the pieces that bear on a posting's requirements (without them, drafts carry no
 * numbers), its true stories for the prep sheet, and adding an unconfirmed profile piece from another
 * feature (an interview story), with its source.
 */
export interface MasterProfile {
  evidence(input: { requirements: string[]; language: string }): Promise<ProfileEvidence[]>;
  /** Confirmed stories only. */
  stories(): Promise<ProfileStory[]>;
  addUnconfirmedPiece(piece: { text: string; source: string }): Promise<{ id: string }>;
}

/**
 * The user's past writing kept on the laptop (Prepare's voice samples: past cover letters). An
 * assumed contract with Prepare; Track adds the user's own follow-up edits to what it gets here.
 * Only short excerpts are ever sent with a draft (PRODUCT.md "Voice").
 */
export interface VoiceSamples {
  excerpts(input: { language: string; limit: number }): Promise<string[]>;
}

/** What the Track assistant is given to draft one message. */
export interface DraftInput {
  /** The follow-up's id. Never sent to the model; it lets fakes answer per follow-up. */
  followUpId: string;
  kind: DraftKind;
  company: string;
  title: string;
  /** The day the stage began, in words ("Mon 5 Oct"), and the stage. */
  since: string;
  stage: "applied" | "screening";
  /** Whole days with no reply. */
  daysQuiet: number;
  /** The posting's requirements as read (English labels), most important first; empty when it wasn't read. */
  requirements: string[];
  /** The user's notes on the Application, oldest first. */
  notes: string[];
  /** Master profile pieces the draft may draw on; the only source of numbers about the user. */
  evidence: ProfileEvidence[];
  /** Short excerpts of the user's own writing, to sound like them. */
  voice: string[];
  /** ISO 639-1: the posting's language ("bg" for a Bulgarian posting). */
  language: string;
  words: { min: number; max: number };
  banned: readonly string[];
}

/** The draft as the assistant returns it: the body only (no greeting, sign-off or subject). */
export interface DraftOutput {
  body: string;
}

/** A draft as the user sees it, with where any number in it came from. */
export interface FollowUpDraftText {
  text: string;
  language: string;
  /** Each number about the user in the draft, quoted with the words after it, and its Master profile origin. */
  numbers: { quote: string; origin: string }[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const numberRe = /\d+(?:[.,]\d+)*%?/g;

/**
 * Checks a draft against the rules that can be checked without a model: not empty, no banned phrase,
 * and every number either from the Master profile evidence (its origin returned) or from the
 * Application and posting themselves (the date applied, a requirement, a note). Returns why not, or the draft.
 */
export function checkDraft(
  body: string,
  input: Pick<DraftInput, "evidence" | "banned" | "language" | "since" | "requirements" | "notes" | "title" | "company">,
): { ok: true; draft: FollowUpDraftText } | { ok: false; why: string } {
  const text = body.trim();
  if (!text) return { ok: false, why: "it was empty" };
  const plain = text.replace(/[’‘]/g, "'");
  const banned = input.banned.find((p) => new RegExp(`(^|[^\\p{L}])${escapeRe(p)}($|[^\\p{L}])`, "iu").test(plain));
  if (banned) return { ok: false, why: `it used "${banned}"` };
  const context = [input.since, input.title, input.company, ...input.requirements, ...input.notes].join("\n");
  const numbers: { quote: string; origin: string }[] = [];
  for (const m of text.matchAll(numberRe)) {
    const n = m[0];
    const has = (s: string) => new RegExp(`(^|[^\\d])${escapeRe(n)}($|[^\\d])`).test(s);
    const piece = input.evidence.find((e) => has(e.text));
    if (piece) {
      const after = text.slice(m.index + n.length).match(/^(?:\s+[\p{L}-]+){0,2}/u)?.[0] ?? "";
      const quote = `${n}${after}`.trim();
      if (!numbers.some((x) => x.quote === quote)) numbers.push({ quote, origin: piece.origin });
    } else if (!has(context) && !isDateNumber(n, text, m.index)) {
      return { ok: false, why: `it used a number (${n}) that isn't in your Master profile` };
    }
  }
  return { ok: true, draft: { text, language: input.language, numbers } };
}

const months = /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември)/i;
/** A day of the month written next to a month name ("on 5 October", "October 5"): a date, not a claim. */
function isDateNumber(n: string, text: string, at: number): boolean {
  if (!/^\d{1,2}$/.test(n)) return false;
  return months.test(text.slice(at + n.length)) || /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*$/i.test(text.slice(Math.max(0, at - 12), at));
}
