// Needs you (hi-fi: applications.html, state Normal, and the draft dialog of "Follow-up due · draft"):
// only what the user must do now, most urgent first, each with one primary action; things only coming
// up as one quiet "Coming up" line. A follow-up done today stays in its place with a sunken background
// and "Done" in its kind line (never faded). Kind lines are sentence case in the source and set in
// capitals by CSS (TA-12). At volume, follow-ups of one kind due together are one grouped item ("6
// follow-ups due"), still written one by one in the dialog with "Next draft" (story 58, T-08, TA-11).
import type { FollowUpDraft, NeedsYou, NeedsYouEntry } from "@apply-kit/core";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { FollowUpWriter, type FollowUpAction } from "./FollowUpWriter.tsx";
import { daysFrom, daysWord, dueWords, eventTime, followUpName, todaySofia, weekDay } from "./words.ts";

const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);
export const itemId = (followUpId: string) => `ny-${followUpId}`;

function why(e: NeedsYouEntry): string {
  const f = e.followUp;
  if (e.done) {
    const how = f.state === "sent" ? (f.kind === "nudge" ? "Marked sent" : "Marked done") : "Skipped: no note this time";
    return `${how} ${eventTime(f.doneAt!)}. Logged on its timeline.`;
  }
  const quiet = daysFrom(f.anchorOn, todaySofia());
  if (f.kind === "offer-note") return `The offer came ${weekDay(f.anchorOn)}. Before you decide: the deadline, one question to answer, one action. Points to cover are ready.`;
  const since = e.application.status === "applied" ? `Applied ${daysWord(quiet)} ago (${weekDay(f.anchorOn)})` : `In Screening for ${daysWord(quiet)} (since ${weekDay(f.anchorOn)})`;
  return `${since}, no reply you've recorded. Points to cover are ready; you write it and send it from your own mail.`;
}

/** From this many due follow-ups of one kind on, they are one grouped item. */
const groupFrom = 3;

type Item = { one: NeedsYouEntry } | { group: NeedsYouEntry[]; done: number };

/** Needs you's follow-ups, with same-kind ones grouped at volume (in place of the first of them). */
function itemsOf(entries: NeedsYouEntry[]): Item[] {
  const due = (k: string) => entries.filter((e) => !e.done && e.followUp.kind === k);
  const grouped = new Set(entries.map((e) => e.followUp.kind).filter((k) => due(k).length >= groupFrom));
  const out: Item[] = [];
  for (const e of entries) {
    if (!grouped.has(e.followUp.kind)) { out.push({ one: e }); continue; }
    if (!out.some((i) => "group" in i && i.group[0]!.followUp.kind === e.followUp.kind)) {
      out.push({ group: due(e.followUp.kind), done: entries.filter((x) => x.done && x.followUp.kind === e.followUp.kind).length });
    }
  }
  return out;
}

const plural = (n: number, kind: NeedsYouEntry["followUp"]["kind"]) => (kind === "nudge" ? (n === 1 ? "follow-up" : "follow-ups") : (n === 1 ? "note to self" : "notes to self"));

export function NeedsYouSection({ needs, onWrite, onSnooze, onSnoozeAll, emails }: {
  needs: NeedsYou;
  /** Opens the dialog on `entries[0]` (one item) or on a group, written one by one. */
  onWrite: (entries: NeedsYouEntry[], opener: HTMLElement) => void;
  onSnooze: (e: NeedsYouEntry) => void;
  onSnoozeAll: (entries: NeedsYouEntry[]) => void;
  /** Emails to match (EmailsToMatch.tsx), first in the queue: nothing changes until the user answers. */
  emails?: ReactNode;
}) {
  const coming = needs.comingUp.map((c) => `${c.company} ${followUpName(c.kind).toLowerCase()} ${weekDay(c.dueOn)}`);
  return (
    <section className="stack" style={{ gap: "var(--s-4)" }} aria-labelledby="ny-h">
      <div className="sec-head"><h2 id="ny-h" tabIndex={-1}>Needs you · {needs.count}</h2>{needs.items.length + needs.emailsToMatch > 1 && <span className="meta">Most urgent first</span>}</div>
      {needs.items.length || (emails && needs.emailsToMatch) ? (
        <ul className="needs-queue">
          {emails}
          {itemsOf(needs.items).map((item) => {
            if ("group" in item) {
              const g = item.group;
              const kind = g[0]!.followUp.kind;
              const companies = [...new Set(g.map((e) => e.application.company))];
              return (
                <li key={`group-${kind}`} id={`ny-group-${kind}`} className="needs">
                  <div className="stack" style={{ gap: "var(--s-1)" }}>
                    <span className="kind">{g.length} {plural(g.length, kind)} due · oldest {weekDay(g[0]!.followUp.dueOn)}{item.done ? ` · ${item.done} done today` : ""}</span>
                    <span className="what">{companies.length > 3 ? `${companies.slice(0, 3).join(", ")} and ${companies.length - 3} more` : companies.join(", ")}</span>
                    <span className="why">Points to cover are ready for each. You write and send each one yourself; "Next draft" moves to the following one.</span>
                  </div>
                  <div className="acts">
                    <button className="btn primary sm" type="button" onClick={(ev) => onWrite(g, ev.currentTarget)}>Write {g.length} {plural(g.length, kind)}</button>
                    <button className="btn sm" type="button" onClick={() => onSnoozeAll(g)}>Snooze all {daysWord(needs.snoozeDays)}</button>
                  </div>
                </li>
              );
            }
            const e = item.one;
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
                    <button className="btn primary sm" type="button" onClick={(ev) => onWrite([e], ev.currentTarget)}>
                      {e.followUp.kind === "nudge" ? "Write follow-up" : "Write note"}<span className="sr-only">: {e.application.company}</span>
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

/** The follow-up over the list: its outline and text, Copy text, Open in Mail, Mark sent, Snooze, skip. */
export function FollowUpDialog({ entries, index, onIndex, onAct, onClose, onAnnounce }: {
  /** One follow-up, or a group written one by one. */
  entries: NeedsYouEntry[];
  index: number;
  /** "Next draft": moves to the following one. */
  onIndex: (index: number) => void;
  onAct: (action: FollowUpAction, draft: FollowUpDraft) => void;
  onClose: () => void;
  onAnnounce: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const entry = entries[index]!;
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    document.getElementById(`${uid}-h`)?.focus();
  }, [uid, index]);
  const close = () => { ref.current?.close(); onClose(); };
  const many = entries.length > 1;
  const next = () => {
    onIndex(index + 1);
    onAnnounce(`Draft ${index + 2} of ${entries.length}.`);
  };
  const f = entry.followUp;
  const a = entry.application;
  const quiet = daysFrom(f.anchorOn, todaySofia());
  return (
    <dialog ref={ref} className="dlg" aria-labelledby={`${uid}-h`} onCancel={(e) => { e.preventDefault(); close(); }}>
      <div className="body">
        <div className="dlg-head">
          <div className="stack" style={{ gap: "var(--s-1)" }}>
            <span className="meta">{followUpName(f.kind)} · {many ? `${index + 1} of ${entries.length} · ` : ""}{dueWords(f.dueOn)}</span>
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
          {many && index < entries.length - 1 && <button className="btn ghost" type="button" onClick={next}>Next draft</button>}
          <button className="btn ghost" type="button" onClick={close}>Close</button>
        </div>
      </div>
    </dialog>
  );
}
