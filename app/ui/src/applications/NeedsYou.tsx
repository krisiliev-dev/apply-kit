// Needs you (hi-fi: applications.html, state Normal, the draft dialog of "Follow-up due · draft" and
// "214 applications"): only what the user must do now, most urgent first, each with one primary
// action; things only coming up as one quiet "Coming up" line. A follow-up done today stays in its
// place with a sunken background and "Done" in its kind line (never faded). At volume, same-kind
// follow-ups are one item ("6 follow-ups due") whose drafts the dialog steps through one by one
// ("1 of 6", Next draft, focus to the new draft's heading); nothing is ever sent in bulk. Kind lines
// are sentence case in the source and set in capitals by CSS (TA-12).
import type { FollowUpDraft, NeedsYou, NeedsYouEntry, NeedsYouGroup } from "@apply-kit/core";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { FollowUpWriter, type FollowUpAction } from "./FollowUpWriter.tsx";
import { daysFrom, daysWord, dueWords, eventTime, followUpName, todaySofia, weekDay } from "./words.ts";

const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);
export const itemId = (followUpId: string) => `ny-${followUpId}`;

function why(e: NeedsYouEntry): string {
  const f = e.followUp;
  if (e.done) {
    if (f.doneBy === "email") return `Marked sent ${eventTime(f.doneAt!)}: apply-kit saw the copy you BCC'd to the job mailbox. Logged on its timeline.`;
    const how = f.state === "sent" ? (f.kind === "nudge" ? "Marked sent" : "Marked done") : "Skipped: no note this time";
    return `${how} ${eventTime(f.doneAt!)}. Logged on its timeline.`;
  }
  const quiet = daysFrom(f.anchorOn, todaySofia());
  if (f.kind === "offer-note") return `The offer came ${weekDay(f.anchorOn)}. Before you decide: the deadline, one question to answer, one action. Points to cover are ready.`;
  const since = e.application.status === "applied" ? `Applied ${daysWord(quiet)} ago (${weekDay(f.anchorOn)})` : `In Screening for ${daysWord(quiet)} (since ${weekDay(f.anchorOn)})`;
  return `${since}, no reply you've recorded. Review the draft and send it from your own mail.`;
}

const kindPlural = (g: NeedsYouGroup) => (g.kind === "nudge" ? "follow-ups" : "notes to self");
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
        <span className="kind">{n} {plural} due{group.oldestDueOn && ` · oldest ${weekDay(group.oldestDueOn)}`}{group.done > 0 && ` · ${group.done} done today`}</span>
        <span className="what">{companiesWords(group.companies)}</span>
        <span className="why">
          {group.kind === "nudge"
            ? `You review and send each one yourself; "Next draft" moves to the following one.`
            : "Points to cover are ready for each; \"Next draft\" moves to the following one."}
        </span>
      </div>
      <div className="acts">
        <button className="btn primary sm" type="button" onClick={(ev) => onReview(due, ev.currentTarget)}>
          Review {n} {n === 1 ? "draft" : "drafts"}
        </button>
        <button className="btn sm" type="button" onClick={() => onSnoozeAll(due)}>
          Snooze all {daysWord(snoozeDays)}<span className="sr-only">: {n} {plural}</span>
        </button>
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
        {needs.groups.length > 0 ? <span className="meta">Same kinds grouped</span> : needs.items.length + needs.emailsToMatch > 1 && <span className="meta">Most urgent first</span>}
      </div>
      {needs.items.length || (emails && needs.emailsToMatch) ? (
        <ul className="needs-queue">
          {emails}
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
                  <span className="kind">{e.done ? `${name} · Done` : `${name} ${dueWords(e.followUp.dueOn)}`}</span>
                  <span className="what">
                    <a href={`/applications/${encodeURIComponent(e.application.id)}`} lang={langOf(e.application.title)}>{e.application.title} · {e.application.company}</a>
                  </span>
                  <span className="why">{why(e)}</span>
                </div>
                {!e.done && (
                  <div className="acts">
                    <button className="btn primary sm" type="button" onClick={(ev) => onWrite(e, ev.currentTarget)}>
                      {e.followUp.kind === "nudge" ? "Review draft" : "Write note"}<span className="sr-only">: {e.application.company}</span>
                    </button>
                    <button className="btn sm" type="button" onClick={() => onSnooze(e)}>
                      Snooze {daysWord(needs.snoozeDays)}<span className="sr-only">: {e.application.company}</span>
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="calm">
          <h3>Nothing needs you now</h3>
          <p className="muted">Follow-ups come due here on their own, {coming.length ? "the next ones are below" : "7 days after you apply if there's no reply"}.</p>
        </div>
      )}
      {coming.length > 0 && <p className="coming"><span><b>Coming up:</b> {coming.join(" · ")}</span></p>}
    </section>
  );
}

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
            <span className="meta">{followUpName(f.kind)} · {entries.length > 1 ? `${index + 1} of ${entries.length}` : dueWords(f.dueOn)}</span>
            <h2 id={`${uid}-h`} tabIndex={-1}>{f.kind === "nudge" ? `Follow up with ${a.company}` : `Note to self · ${a.company}`}</h2>
          </div>
          <button className="btn ghost sm x" type="button" aria-label="Close" onClick={close}>✕</button>
        </div>
        <p className="muted mini">
          <span lang={langOf(a.title)}>{a.title}</span>
          {f.kind === "nudge" ? ` · ${a.status === "applied" ? "applied" : "in Screening since"} ${weekDay(f.anchorOn)} · no reply in ${daysWord(quiet)}. You send this from your own mail.` : ` · offer ${weekDay(f.anchorOn)}.`}
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
