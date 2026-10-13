// Words and dates shared by the Applications screens (the service owns the rules; these only say them).
import type { Status } from "@apply-kit/core";

export const statusOrder: Status[] = ["applied", "screening", "interviewing", "offer", "accepted", "rejected", "withdrawn"];

export const statusLabel: Record<Status, string> = {
  applied: "Applied", screening: "Screening", interviewing: "Interviewing", offer: "Offer",
  accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn",
};

/** Today in Sofia, YYYY-MM-DD (the day dates applied are counted in). */
export function todaySofia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const asDate = (day: string) => new Date(`${day}T12:00:00Z`);
/** Newer ICU writes September "Sept" in en-GB; the app writes "Sep" like every other month. */
const sep = (s: string) => s.replace("Sept", "Sep");

/** "9 Oct", or "today". */
export function shortDay(day: string): string {
  if (day === todaySofia()) return "today";
  return sep(asDate(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }));
}

/** "Fri 9 Oct 2026": the app's own date format, shown beside native date inputs. */
export function longDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return sep(asDate(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }));
}

/** "9 Oct" for an ISO time, or "today 08:40". */
export function eventTime(iso: string): string {
  const d = new Date(iso);
  if (todaySofia(d) === todaySofia()) return `today ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Sofia" })}`;
  return sep(d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Sofia" }));
}

export const angleLabel = { developer: "Developer", security: "Security", design: "Design" } as const;

const clockTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Sofia" });

/** "today 09:14", or "Sat 10 Oct, 21:00", in Sofia time. */
export function dayTime(iso: string): string {
  const d = new Date(iso);
  if (todaySofia(d) === todaySofia()) return `today ${clockTime(d)}`;
  return `${sep(d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Sofia" })).replace(",", "")}, ${clockTime(d)}`;
}

/** "Sat 21:00" (the short form for a page-head line), or "today 21:00". */
export function weekdayTime(iso: string): string {
  const d = new Date(iso);
  if (todaySofia(d) === todaySofia()) return `today ${clockTime(d)}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/Sofia" })} ${clockTime(d)}`;
}

/** What an email is, in plain words (the service's kinds). */
export const emailKindLabel = {
  confirmation: "Confirmation", rejection: "Rejection", "interview-invitation": "Interview invitation", offer: "Offer",
  "info-request": "Request for information", other: "Email",
} as const;

/** "an interview invitation", "a rejection", for sentences. */
export const emailKindPhrase = {
  confirmation: "a confirmation", rejection: "a rejection", "interview-invitation": "an interview invitation", offer: "an offer",
  "info-request": "a request for information", other: "an email",
} as const;
