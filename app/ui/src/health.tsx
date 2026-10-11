// Shared source-health wording and pieces: the top-bar pill, the failed-source banner, status chips
// and the polite "Try now" announcement. Wording follows the Feed and Sources hi-fi screens.
import type { CheckFailure, FailingSource, HealthSummary, MailboxHealth, MailboxProblem, SourceCategory, SourceCheck } from "@apply-kit/core";
import { useState, type ReactNode } from "react";
import { checkSource } from "./api.ts";

/** "07:30" today, "11 Oct, 07:30" on another day. */
export function clockTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Class and text for the top-bar health pill. */
export function healthPill(h: HealthSummary): [cls: string, text: string] {
  if (h.state === "no-sources") return ["warn", "No sources yet"];
  const when = h.lastCheckAt ? ` · ${clockTime(h.lastCheckAt)}` : "";
  if (h.state === "failing") {
    const parts = [
      ...(h.failing.length > 0 ? [`${plural(h.failing.length, "source")} failing`] : []),
      ...(h.mailbox?.state === "error" ? ["job mailbox not read"] : []),
    ];
    const text = parts.join(", ");
    return ["bad", `${text[0]!.toUpperCase()}${text.slice(1)}${when}`];
  }
  if (!h.lastCheckAt) return ["", "Not checked yet"];
  if (h.quiet.length > 0) return ["warn", `${plural(h.quiet.length, "alert")} quiet longer than usual${when}`];
  return ["", `All sources working${when}`];
}

/** "8 days", "20 hours": a span of hours as people say it. */
export function spanText(hours: number): string {
  if (hours < 36) return plural(Math.max(1, Math.round(hours)), "hour");
  return plural(Math.round(hours / 24), "day");
}

/** "No email for 8 days; usually one every 2 days." */
export function quietText(silentHours: number, usualGapHours: number): string {
  return `No email for ${spanText(silentHours)}; usually one every ${spanText(usualGapHours).replace(/^1 /, "")}.`;
}

const mailboxHead: Record<MailboxProblem, string> = {
  "not-configured": "The job mailbox isn't set up yet.",
  auth: "Gmail refused the job mailbox's app password.",
  "mailbox-missing": "The job mailbox folder wasn't found.",
  unreachable: "Couldn't reach Gmail to read the job mailbox.",
  error: "Couldn't read the job mailbox.",
};

/** The job mailbox can't be read: what happened, what it means, how to fix it (Feed and Sources). */
export function MailboxBanner({ mailbox, showHealthLink }: { mailbox: MailboxHealth; showHealthLink?: boolean }) {
  const problem = mailbox.problem ?? "error";
  return (
    <div className="banner error" role="alert">
      <span className="text">
        <b>{mailboxHead[problem]}</b>
        {mailbox.since && ` Since ${clockTime(mailbox.since)}.`} Email alerts can't bring new jobs until it's fixed; jobs they already found stay as they were.
        {" "}<span>{mailbox.fix}</span>
        {mailbox.error && <span className="sr-only"> Details: {mailbox.error}</span>}
      </span>
      {showHealthLink && <a className="btn sm" href="/settings/sources">Source health</a>}
    </div>
  );
}

/** "didn't respond", "asked us to slow down", "couldn't be read" */
const failedVerb: Record<CheckFailure, string> = {
  timeout: "didn't respond",
  "rate-limited": "asked us to slow down (rate limit)",
  error: "couldn't be checked",
};

export const failureShort: Record<CheckFailure, string> = {
  timeout: "no answer",
  "rate-limited": "rate limited",
  error: "error",
};

function keptSentence(jobsKept: number): string {
  return jobsKept === 0
    ? "None of your open jobs came from it, so nothing is lost."
    : `Its ${plural(jobsKept, "job")} ${jobsKept === 1 ? "is" : "are"} kept as ${jobsKept === 1 ? "it was" : "they were"}, not closed.`;
}

export const categoryLabel: Record<SourceCategory, string> = {
  ats: "ATS feed",
  api: "Public API",
  aggregator: "Aggregator",
  email: "Email alert",
  capture: "Manual capture",
};

const icons = {
  ok: <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  bad: <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  none: <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  warn: <><path d="M6 2.2v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="6" cy="9.6" r="1.1" fill="currentColor" /></>,
};
const chipClass = { ok: "met", bad: "gap", none: "neutral", warn: "partly" };

/** Status chip: icon plus text, never colour alone. */
export function Chip({ tone, children }: { tone: keyof typeof icons; children: ReactNode }) {
  return (
    <span className={`chip ${chipClass[tone]}`}>
      <svg viewBox="0 0 12 12" aria-hidden="true">{icons[tone]}</svg>
      {children}
    </span>
  );
}

/** What a Try now result means, in the hi-fi's words. */
export function tryResultText(r: SourceCheck, jobsKept: number): string {
  if (r.ok) return `${r.name} answered: ${plural(r.found, "job")} listed, ${r.newPostings} new.`;
  const still = r.outcome === "timeout" ? "still didn't respond" : r.outcome === "rate-limited" ? "is still rate limiting us" : "still couldn't be checked";
  return `${r.name} ${still}. ${jobsKept === 0 ? "Nothing is lost." : `Its ${plural(jobsKept, "job")} stay${jobsKept === 1 ? "s" : ""} open.`}`;
}

/** Runs Try now for one Source, saying what is happening and what the result means through `say`. */
export function useTryNow(onDone: () => void, say: (message: string) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const tryNow = (sourceId: string, name: string, jobsKept: number) => {
    setBusy(sourceId);
    say(`Trying ${name} now…`);
    checkSource(sourceId)
      .then((r) => { say(tryResultText(r, jobsKept)); onDone(); })
      .catch((err: unknown) => say(`Couldn't try ${name}: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setBusy(null));
  };
  return { busy, tryNow };
}

/** A polite status line: visible while it has something to say, always mounted so it's announced. */
export function StatusLine({ message }: { message: string }) {
  return <p className={message ? "meta" : "sr-only"} role="status" aria-live="polite">{message}</p>;
}

/** Failed-source banner (Feed and Sources): what happened, what it means, what to do. */
export function FailedSourceBanner({ failure, busy, onTry, showHealthLink }: {
  failure: FailingSource;
  busy: boolean;
  onTry: () => void;
  showHealthLink?: boolean;
}) {
  const { name, outcome, at, since, jobsKept, error } = failure;
  const head = `${name} ${failedVerb[outcome]} at ${clockTime(at)}.`;
  const sinceText = clockTime(since) !== clockTime(at) ? ` Failing since ${clockTime(since)}.` : "";
  return (
    <div className="banner error">
      <span className="text">
        <b>{head}</b>{sinceText} {keptSentence(jobsKept)}
        {outcome === "error" && error && <span className="sr-only"> Details: {error}</span>}
      </span>
      <button className="btn sm" type="button" onClick={onTry} disabled={busy}>
        {busy ? "Trying…" : "Try now"}<span className="sr-only">: {name}</span>
      </button>
      {showHealthLink && <a className="btn sm" href="/settings/sources">Source health</a>}
    </div>
  );
}
