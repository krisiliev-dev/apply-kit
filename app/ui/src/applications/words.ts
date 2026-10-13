// Words and dates shared by the Applications screens (the service owns the rules; these only say them).
import type { FollowUpKind, NextUp, Status } from "@apply-kit/core";

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

/** "Wed 14 Oct" for a YYYY-MM-DD day. */
export function weekDay(day: string): string {
  return sep(asDate(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })).replace(",", "");
}

/** Whole days from one YYYY-MM-DD day to another. */
export function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
export const daysWord = (n: number) => plural(n, "day");
export const wordsWord = (n: number) => plural(n, "word");

/** "Follow-up" or "Note to self". */
export const followUpName = (kind: FollowUpKind) => (kind === "nudge" ? "Follow-up" : "Note to self");

/** When a follow-up is due, in words: "due today", "due since Fri 9 Oct", or "Wed 14 Oct". */
export function dueWords(dueOn: string): string {
  const today = todaySofia();
  if (dueOn === today) return "due today";
  if (dueOn < today) return `due since ${weekDay(dueOn)}`;
  return weekDay(dueOn);
}

/** The list's Next column: the follow-up and when, or how long it has been quiet; null when nothing comes next. */
export function nextWords(next: NextUp): { text: string; due: boolean } | null {
  if (!next) return null;
  if (next.kind === "no-reply") return { text: `No reply for ${daysWord(next.days)}`, due: false };
  return { text: `${followUpName(next.followUpKind)} ${dueWords(next.dueOn)}`, due: next.due };
}
