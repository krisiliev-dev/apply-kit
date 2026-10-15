// Interviews and the prep sheet (GLOSSARY "Interview", "Prep sheet"; spec #24 "Interviews and prep").
// The tracker owns their state; this module holds the shapes, the time-zone arithmetic (an interview
// is kept as the local time the invite gave plus its IANA time zone), the .ics export and the prep
// sheet's schema. A prep sheet's stories come only from the Master profile, by id: the tracker
// checks every id the assistant returns and shows "No story yet" for any it doesn't know.
import { z } from "zod";

export const interviewFormats = ["video", "phone", "onsite"] as const;
export type InterviewFormat = (typeof interviewFormats)[number];

/** What the user (or an invite email) gives for an interview. Times are local to `timeZone`. */
export interface InterviewInput {
  /** "YYYY-MM-DDTHH:mm" in `timeZone`, or null while no time is agreed. */
  start: string | null;
  /** "YYYY-MM-DDTHH:mm" in `timeZone`, or null (taken as an hour after the start). */
  end: string | null;
  /** IANA name, such as "Europe/Sofia". */
  timeZone: string;
  format: InterviewFormat | null;
  /** The call link, the phone number or the address, as given. */
  place: string | null;
  /** Who it is with ("Mara Ivanova, Engineering Manager"). */
  people: string[];
  /** Which round ("1 of 2: technical conversation"). */
  round: string | null;
  /** Anything else worth keeping (time-zone notes, what to bring). */
  notes: string | null;
}

/** An interview on an Application. */
export interface Interview extends InterviewInput {
  id: string;
  applicationId: string;
  /** The start and end as instants (ISO, UTC); null without a time. The end is the start + 1 h when not given. */
  startAt: string | null;
  endAt: string | null;
  /** The invite email it was read from, while you haven't edited it; null when added or edited by you. */
  readFrom: { emailId: string; subject: string; from: string; receivedAt: string } | null;
  /** When you last edited it, or null. */
  editedAt: string | null;
}

/** An interview time as an invite email states it (the Track assistant's reading). */
export const invitedInterviewSchema = z.object({
  /** "YYYY-MM-DDTHH:mm" as the email states it, in `timeZone`; null when no time is set yet. */
  start: z.string().nullable(),
  end: z.string().nullable(),
  /** IANA time zone the email's time is in ("Europe/Berlin" for CET); null when it doesn't say. */
  timeZone: z.string().nullable(),
  format: z.enum(interviewFormats).nullable(),
  place: z.string().nullable(),
  people: z.array(z.string()),
  round: z.string().nullable(),
  notes: z.string().nullable(),
});
export type InvitedInterview = z.infer<typeof invitedInterviewSchema>;

export const defaultTimeZone = "Europe/Sofia";
const localPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Whether a "YYYY-MM-DDTHH:mm" is a real local time. */
export function isLocalTime(s: string): boolean {
  const m = localPattern.exec(s);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60;
}

/** The local wall-clock parts of an instant in a time zone. */
function partsIn(instant: Date, tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  return { y: +parts.year!, mo: +parts.month!, d: +parts.day!, h: +parts.hour!, mi: +parts.minute!, s: +parts.second! };
}

/** The offset of a time zone at an instant, in minutes east of UTC. */
export function offsetMinutes(instant: Date, tz: string): number {
  const p = partsIn(instant, tz);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a local "YYYY-MM-DDTHH:mm" in a time zone falls on. */
export function zonedToInstant(local: string, tz: string): Date {
  const [, y, mo, d, h, mi] = localPattern.exec(local)!.map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let t = asUtc - offsetMinutes(new Date(asUtc), tz) * 60_000;
  t = asUtc - offsetMinutes(new Date(t), tz) * 60_000; // settle across a DST change
  return new Date(t);
}

/** "YYYY-MM-DDTHH:mm" of an instant in a time zone. */
export function instantToLocal(instant: Date, tz: string): string {
  const p = partsIn(instant, tz);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${two(p.mo)}-${two(p.d)}T${two(p.h)}:${two(p.mi)}`;
}

const formatWords: Record<InterviewFormat, string> = { video: "Video call", phone: "Phone call", onsite: "On site" };
export const interviewFormatName = (f: InterviewFormat) => formatWords[f];

/** "Sofia time" for Europe/Sofia, "London time" for Europe/London. */
export function zoneName(tz: string): string {
  return `${(tz.split("/").at(-1) ?? tz).replace(/_/g, " ")} time`;
}

// ---------- .ics (RFC 5545) ----------

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsLocal = (local: string) => `${local.replace(/-/g, "").replace(":", "")}00`;
const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function icsOffset(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}${String(a % 60).padStart(2, "0")}`;
}
/** Folds a content line at 75 octets, as RFC 5545 asks. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; size = 0; }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/**
 * The interview as a calendar file: its time in its own time zone (with a VTIMEZONE giving the
 * offset that applies then), who it is with, the round, the place and the notes. Null without a time.
 */
export function interviewIcs(i: Interview, about: { title: string; company: string }, stamp: Date): string | null {
  if (!i.start || !i.startAt) return null;
  const startAt = new Date(i.startAt);
  const endLocal = i.end ?? instantToLocal(new Date(startAt.getTime() + 60 * 60_000), i.timeZone);
  const offset = offsetMinutes(startAt, i.timeZone);
  const zoneAbbr = new Intl.DateTimeFormat("en-GB", { timeZone: i.timeZone, timeZoneName: "short" }).formatToParts(startAt)
    .find((p) => p.type === "timeZoneName")?.value ?? i.timeZone;
  const description = [
    i.round ? `Round: ${i.round}` : null,
    i.format ? `Format: ${interviewFormatName(i.format)}` : null,
    i.people.length ? `With: ${i.people.join("; ")}` : null,
    i.notes ? `Notes: ${i.notes}` : null,
  ].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//apply-kit//Track//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", `TZID:${i.timeZone}`, "BEGIN:STANDARD", "DTSTART:19700101T000000",
    `TZOFFSETFROM:${icsOffset(offset)}`, `TZOFFSETTO:${icsOffset(offset)}`, `TZNAME:${icsText(zoneAbbr)}`, "END:STANDARD", "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${i.id}@apply-kit`,
    `DTSTAMP:${icsUtc(stamp)}`,
    `DTSTART;TZID=${i.timeZone}:${icsLocal(i.start)}`,
    `DTEND;TZID=${i.timeZone}:${icsLocal(endLocal)}`,
    `SUMMARY:${icsText(`Interview: ${about.title} at ${about.company}${i.round ? ` (${i.round})` : ""}`)}`,
    ...(i.place ? [`LOCATION:${icsText(i.place)}`] : []),
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    "END:VEVENT", "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

// ---------- prep sheet ----------

/** Where a company fact comes from: the posting, the user's notes, or neither (to check). */
export type FactTag = "posting" | "notes" | "unverified";

/** The Track assistant's prep sheet, before the tracker checks it. Story ids must be the Master profile's. */
export const prepSheetDraftSchema = z.object({
  facts: z.array(z.object({ text: z.string(), source: z.enum(["posting", "notes", "unverified"]) })),
  questions: z.array(z.object({
    /** The posting's requirement this question tests, as written there. */
    requirement: z.string(),
    question: z.string(),
    /** The id of a Master-profile story that answers it truly, or null when none does. */
    storyId: z.string().nullable(),
  })),
});
export type PrepSheetDraft = z.infer<typeof prepSheetDraftSchema>;

/** A true story from the Master profile (a confirmed profile piece). */
export interface ProfileStory {
  id: string;
  text: string;
  /** Where it comes from ("Velora · 2023"), or null. */
  where: string | null;
}

/** What the assistant is given to build a prep sheet. */
export interface PrepSheetInput {
  company: string;
  title: string;
  /** The posting as plain text (trimmed), or "" when apply-kit has none. */
  postingText: string;
  requirements: { text: string; kind: "required" | "preferred" }[];
  /** The user's notes on the Application. */
  notes: string[];
  stories: ProfileStory[];
  /** The language the sheet is written in (the posting's). */
  language: string;
}

/** One likely question on the prep sheet. */
export interface PrepQuestion {
  id: string;
  requirement: string;
  question: string;
  /** The true story from the Master profile, or null: "No story yet". */
  story: ProfileStory | null;
  /** A story you added here: it waits in your Master profile as an unconfirmed piece. */
  yourStory: { text: string; addedAt: string } | null;
  practised: boolean;
}

export interface PrepSheet {
  applicationId: string;
  facts: { text: string; tag: FactTag }[];
  questions: PrepQuestion[];
  builtAt: string;
}
