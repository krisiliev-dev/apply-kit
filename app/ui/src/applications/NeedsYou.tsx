// Needs you (hi-fi: applications.html, state Normal, the draft dialog of "Follow-up due · draft" and
// "214 applications"): only what the user must do now, most urgent first, each with one primary
// action; things only coming up as one quiet "Coming up" line. A follow-up done today stays in its
// place with a sunken background and "Done" in its kind line (never faded). At volume, same-kind
// follow-ups are one item ("6 follow-ups due") whose drafts the dialog steps through one by one
// ("1 of 6", Next draft, focus to the new draft's heading); nothing is ever sent in bulk. Kind lines
// are sentence case in the source and set in capitals by CSS (TA-12). Thank-you notes (due within 24
// hours of an interview's start) and interviews in the next 7 days, each with its prep sheet and
// .ics, sit in the same queue (#33).
import type { FollowUpDraft, NeedsYou, NeedsYouEntry, NeedsYouGroup, OfferToAnswer, UpcomingInterview } from "@apply-kit/core";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { FollowUpWriter, type FollowUpAction } from "./FollowUpWriter.tsx";
import { interviewIcsUrl } from "../api.ts";
import { daysFrom, daysWord, dueByWords, dueWords, eventTime, followUpName, interviewWhen, sofiaClock, statusLabel, todaySofia, weekDay } from "./words.ts";

const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);
export const itemId = (followUpId: string) => `ny-${followUpId}`;

function why(e: NeedsYouEntry): string {
  const f = e.followUp;
  if (e.done) {
    if (f.doneBy === "email") return `Marked sent ${eventTime(f.doneAt!)}: apply-kit saw the copy you BCC'd to the job mailbox. Logged on its timeline.`;
    if (f.kind === "withdrawal") return `${f.state === "sent" ? "Marked sent: moved to Withdrawn" : "Kept open"} ${eventTime(f.doneAt!)}. Logged on its timeline.`;
    const how = f.state === "sent" ? (f.kind === "offer-note" ? "Marked done" : "Marked sent") : "Skipped: no note this time";
    return `${how} ${eventTime(f.doneAt!)}. Logged on its timeline.`;
  }
  const quiet = daysFrom(f.anchorOn, todaySofia());
  if (f.kind === "withdrawal") return "You accepted another offer. A short, polite note frees their time; it moves to Withdrawn only when you mark it sent. Or keep it open.";
  if (f.kind === "thank-you") {
    return `Your interview was ${f.anchorOn === todaySofia() ? "today" : weekDay(f.anchorOn)}${f.readyAt ? `, ended ${sofiaClock(f.readyAt)}` : ""}. Thank-you notes are due within 24 hours of the start. Add one thing you discussed and the points are ready.`;
  }
  if (f.kind === "check-in") return `No news in ${daysWord(quiet)} since your last interview (${weekDay(f.anchorOn)}). One polite check-in; you write it and send it from your own mail.`;
  if (f.kind === "offer-note") return `The offer came ${weekDay(f.anchorOn)}. Before you decide: the deadline, one question to answer, one action. Points to cover are ready.`;
  const since = e.application.status === "applied" ? `Applied ${daysWord(quiet)} ago (${weekDay(f.anchorOn)})` : `In Screening for ${daysWord(quiet)} (since ${weekDay(f.anchorOn)})`;
  return `${since}, no reply you've recorded. Review the draft and send it from your own mail.`;
}

const kindPlurals = {
  nudge: "follow-ups", "offer-note": "notes to self", "thank-you": "thank-you notes", "check-in": "check-ins", withdrawal: "withdrawals", decline: "replies",
} as const;
const kindPlural = (g: NeedsYouGroup) => kindPlurals[g.kind];
const writeLabel = {
  nudge: "Review draft", "offer-note": "Write note", "thank-you": "Write thank-you", "check-in": "Write check-in", withdrawal: "Review withdrawal", decline: "Review reply",
} as const;

/** An offer to answer: one primary action, opening the offer (accept or decline happen there). */
function OfferItem({ item }: { item: OfferToAnswer }) {
  const { application: a, email: e } = item;
  const page = `/applications/${encodeURIComponent(a.id)}`;
  const from = e
    ? `Matched from ${e.from.replace(/\s*<[^>]*>$/, "")}'s email ${eventTime(e.receivedAt)}${e.attachments.length ? `, ${e.attachments.length === 1 ? "the letter" : "its attachments"} kept` : ""}. `
    : `Offer since ${eventTime(item.since)}. `;
  return (
    <li className="needs" id={`ny-offer-${a.id}`}>
      <div className="stack" style={{ gap: "var(--s-1)" }}>
        <span className="kind">Offer{item.other ? ` · ${item.other}` : ""}</span>
        <span className="what"><a href={page} lang={langOf(a.title)}>{a.title} · {a.company}</a></span>
        <span className="why">{from}Check the details against the letter, then accept or decline when you're ready. Nothing is sent for you.</span>
      </div>
      <div className="acts"><a className="btn primary sm" href={page}>Open offer<span className="sr-only">: {a.company}</span></a></div>
    </li>
  );
}

/** An interview in the next 7 days: when, with whom, the prep sheet and the calendar file. */
function InterviewItem({ item }: { item: UpcomingInterview }) {
  const { interview: i, application: a, prep } = item;
  const page = `/applications/${encodeURIComponent(a.id)}`;
  const withWhom = i.people.length ? `With ${i.people.join(", ")}. ` : "";
  const prepWords = prep
    ? `Prep sheet ready: ${prep.questions} likely questions, ${prep.withStory} with a story${prep.questions - prep.withStory ? `, ${prep.questions - prep.withStory} to prepare` : ""}.`
    : "Prep sheet not built yet: it takes a minute, on the Application page.";
  return (
    <li className="needs" id={`ny-iv-${i.id}`}>
      <div className="stack" style={{ gap: "var(--s-1)" }}>
        <span className="kind">Interview · {interviewWhen(i)}</span>
        <span className="what"><a href={page} lang={langOf(a.title)}>{a.title} · {a.company}</a></span>
        <span className="why">{withWhom}{prepWords}</span>
      </div>
      <div className="acts">
        <a className="btn sm" href={`${page}#prep`}>Open prep sheet<span className="sr-only">: {a.company}</span></a>
        <a className="btn ghost sm" href={interviewIcsUrl(i.id)} download>Add to calendar<span className="sr-only">: {a.company} interview (.ics)</span></a>
      </div>
    </li>
  );
}
const numberWords = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "Tidewater Pay, Velta Logistics, Lumio Maps and 3 more". */
function companiesWords(companies: string[]): string {
  if (companies.length <= 3) return companies.join(", ").replace(/, ([^,]*)$/, " and $1");
  return `${companies.slice(0, 3).join(", ")} and ${companies.length - 3} more`;
}

/** One item for same-kind follow-ups at volume: review their drafts one by one, or snooze them all. */
function GroupItem({ group, entries, snoozeDays, onReview, onSnoozeAll }: {
  group: NeedsYouGroup;
  entries: NeedsYouEntry[];
  snoozeDays: number;
  onReview: (entries: NeedsYouEntry[], opener: HTMLElement) => void;
  onSnoozeAll: (entries: NeedsYouEntry[]) => void;
}) {
  const due = group.followUpIds.map((id) => entries.find((e) => e.followUp.id === id)!).filter(Boolean);
  const plural = kindPlural(group);
  const n = group.count;
  if (n === 0) {
    return (
      <li className="needs done">
        <div className="stack" style={{ gap: "var(--s-1)" }}>
          <span className="kind">{group.done} {plural} · Done</span>
          <span className="why">All {numberWords[group.done] ?? group.done} done today. Each is logged on its own timeline.</span>
        </div>
      </li>
    );
  }
  return (
    <li className="needs">
      <div className="stack" style={{ gap: "var(--s-1)" }}>
        <span className="kind">{n} {plural} {group.kind === "withdrawal" ? "to send" : "due"}{group.kind !== "withdrawal" && group.oldestDueOn && ` · oldest ${weekDay(group.oldestDueOn)}`}{group.done > 0 && ` · ${group.done} done today`}</span>
        <span className="what">{companiesWords(group.companies)}</span>
        <span className="why">
          {group.kind === "nudge" || group.kind === "withdrawal"
            ? `You review and send each one yourself; "Next draft" moves to the following one.`
            : "Points to cover are ready for each; \"Next draft\" moves to the following one."}
        </span>
      </div>
      <div className="acts">
        <button className="btn primary sm" type="button" onClick={(ev) => onReview(due, ev.currentTarget)}>
          Review {n} {n === 1 ? "draft" : "drafts"}
        </button>
        {group.kind !== "withdrawal" && (
          <button className="btn sm" type="button" onClick={() => onSnoozeAll(due)}>
            Snooze all {daysWord(snoozeDays)}<span className="sr-only">: {n} {plural}</span>
          </button>
        )}
      </div>
    </li>
  );
}

export function NeedsYouSection({ needs, onWrite, onSnooze, onReview, onSnoozeAll, emails }: {
  needs: NeedsYou;
  onWrite: (e: NeedsYouEntry, opener: HTMLElement) => void;
  onSnooze: (e: NeedsYouEntry) => void;
  /** Steps through a group's drafts one by one, from the first. */
  onReview: (entries: NeedsYouEntry[], opener: HTMLElement) => void;
  onSnoozeAll: (entries: NeedsYouEntry[]) => void;
  /** Emails to match (EmailsToMatch.tsx), first in the queue: nothing changes until the user answers. */
  emails?: ReactNode;
}) {
  const coming = needs.comingUp.map((c) => `${c.company} ${followUpName(c.kind).toLowerCase()} ${weekDay(c.dueOn)}`);
  return (
    <section className="stack" style={{ gap: "var(--s-4)" }} aria-labelledby="ny-h">
      <div className="sec-head">
        <h2 id="ny-h" tabIndex={-1}>Needs you · {needs.count}</h2>
        {needs.groups.length > 0 ? <span className="meta">Same kinds grouped</span> : needs.items.length + needs.emailsToMatch + needs.interviews.length + needs.offers.length > 1 && <span className="meta">Most urgent first</span>}
      </div>
      {needs.items.length || needs.interviews.length || needs.offers.length || (emails && needs.emailsToMatch) ? (
        <ul className="needs-queue">
          {emails}
          {needs.offers.map((o) => <OfferItem key={o.application.id} item={o} />)}
          {needs.items.map((e, i) => {
            const group = needs.groups.find((g) => g.kind === e.followUp.kind);
            if (group) {
              // The group stands where its first item would.
              return needs.items.findIndex((x) => x.followUp.kind === group.kind) === i
                ? <GroupItem key={`group-${group.kind}`} group={group} entries={needs.items} snoozeDays={needs.snoozeDays} onReview={onReview} onSnoozeAll={onSnoozeAll} />
                : null;
            }
            const name = followUpName(e.followUp.kind);
            return (
              <li key={e.followUp.id} id={itemId(e.followUp.id)} className={`needs${e.done ? " done" : ""}`}>
                <div className="stack" style={{ gap: "var(--s-1)" }}>
                  <span className="kind">
                    {e.done ? `${name} · Done` : e.followUp.kind === "withdrawal" ? name : `${name} ${e.followUp.dueAt ? dueByWords(e.followUp.dueAt) : dueWords(e.followUp.dueOn)}`}
                  </span>
                  <span className="what">
                    <a href={`/applications/${encodeURIComponent(e.application.id)}`} lang={langOf(e.application.title)}>{e.application.title} · {e.application.company}</a>
                  </span>
                  <span className="why">{why(e)}</span>
                </div>
                {!e.done && (
                  <div className="acts">
                    <button className="btn primary sm" type="button" onClick={(ev) => onWrite(e, ev.currentTarget)}>
                      {writeLabel[e.followUp.kind]}<span className="sr-only">: {e.application.company}</span>
                    </button>
                    {e.followUp.kind !== "withdrawal" && (
                      <button className="btn sm" type="button" onClick={() => onSnooze(e)}>
                        Snooze {daysWord(needs.snoozeDays)}<span className="sr-only">: {e.application.company}</span>
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {needs.interviews.map((iv) => <InterviewItem key={iv.interview.id} item={iv} />)}
        </ul>
      ) : (
        <div className="calm">
          <h3>Nothing needs you now</h3>
          <p className="muted">Follow-ups and thank-you notes come due here on their own, {coming.length ? "the next ones are below" : "7 days after you apply if there's no reply"}.</p>
        </div>
      )}
      {coming.length > 0 && <p className="coming"><span><b>Coming up:</b> {coming.join(" · ")}</span></p>}
    </section>
  );
}

const dialogTitle: Record<NeedsYouEntry["followUp"]["kind"], (company: string) => string> = {
  nudge: (c) => `Follow up with ${c}`, "offer-note": (c) => `Note to self · ${c}`,
  "thank-you": (c) => `Thank ${c} for the interview`, "check-in": (c) => `Check in with ${c}`,
  withdrawal: (c) => `Withdraw from ${c}`, decline: (c) => `Decline ${c}'s offer`,
};

/**
 * The follow-up over the list: its draft (or outline), Copy text, Open in Mail, Mark sent, Snooze,
 * skip. Given several, it steps through them one by one ("1 of 6"): "Next draft" (or acting on one)
 * moves to the following draft and focus goes to its heading; nothing is sent in bulk.
 */
export function FollowUpDialog({ entries, index, onAct, onNext, onClose, onAnnounce }: {
  entries: NeedsYouEntry[];
  /** Which of them is open. */
  index: number;
  onAct: (action: FollowUpAction, draft: FollowUpDraft) => void;
  onNext: () => void;
  onClose: () => void;
  onAnnounce: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const entry = entries[index]!;
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  // Focus the heading of each draft as it opens (the first, and each "Next draft").
  useEffect(() => { document.getElementById(`${uid}-h`)?.focus(); }, [uid, index]);
  const close = () => { ref.current?.close(); onClose(); };
  const f = entry.followUp;
  const a = entry.application;
  const quiet = daysFrom(f.anchorOn, todaySofia());
  const more = index < entries.length - 1;
  return (
    <dialog ref={ref} className="dlg" aria-labelledby={`${uid}-h`} onCancel={(e) => { e.preventDefault(); close(); }}>
      <div className="body">
        <div className="dlg-head">
          <div className="stack" style={{ gap: "var(--s-1)" }}>
            <span className="meta">{followUpName(f.kind)}{entries.length > 1 ? ` · ${index + 1} of ${entries.length}` : f.kind === "withdrawal" ? "" : ` · ${dueWords(f.dueOn)}`}</span>
            <h2 id={`${uid}-h`} tabIndex={-1}>{dialogTitle[f.kind](a.company)}</h2>
          </div>
          <button className="btn ghost sm x" type="button" aria-label="Close" onClick={close}>✕</button>
        </div>
        <p className="muted mini">
          <span lang={langOf(a.title)}>{a.title}</span>
          {f.kind === "nudge" ? ` · ${a.status === "applied" ? "applied" : "in Screening since"} ${weekDay(f.anchorOn)} · no reply in ${daysWord(quiet)}. You send this from your own mail.`
            : f.kind === "thank-you" ? ` · interview ${weekDay(f.anchorOn)}${f.dueAt ? ` · ${dueByWords(f.dueAt)}` : ""}. You send this from your own mail.`
            : f.kind === "check-in" ? ` · last interview ${weekDay(f.anchorOn)} · no news in ${daysWord(quiet)}. You send this from your own mail.`
            : f.kind === "withdrawal" ? ` · ${statusLabel[a.status]}. You accepted another offer; you send this from your own mail.`
            : ` · offer ${weekDay(f.anchorOn)}.`}
        </p>
        <FollowUpWriter key={f.id} id={f.id} headingId={`${uid}-h`} onAct={onAct} onAnnounce={onAnnounce} />
        <div className="dlg-foot">
          <span className="grow" />
          {more && <button className="btn ghost" type="button" onClick={onNext}>Next draft<span className="sr-only">: {index + 2} of {entries.length}</span></button>}
          <button className="btn ghost" type="button" onClick={close}>Close</button>
        </div>
      </div>
    </dialog>
  );
}
