// Writing one follow-up (hi-fi: application.html "Follow-up · AI budget out", and the draft dialog in
// applications.html "Follow-up due · draft"): the points to cover, from the Application with no model
// call; a text area kept as typed; Copy text and Open in Mail (a mailto with recipient and subject; the
// user sends, there is no Send button); Mark sent, Snooze and "No note this time", each undoable by
// whoever opened it. Used inline on the Application page and in a dialog over Needs you. A thank-you
// note asks for one thing discussed first (hi-fi application.html "Thank-you due"), which the points use.
import type { FollowUpDraft } from "@apply-kit/core";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { fetchFollowUp, saveFollowUpText, saveFollowUpTopic } from "../api.ts";
import { daysWord, isMessage, wordsWord } from "./words.ts";

export type FollowUpAction = "sent" | "skip" | "snooze";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
/** Bulgarian text is marked as such, so screen readers read it in Bulgarian. */
const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);

/** Open in Mail: the user's own mail app, with the recipient and subject filled. Never sends. */
export function mailtoOf(mail: { to: string | null; subject: string }): string {
  return `mailto:${mail.to ? encodeURIComponent(mail.to).replace("%40", "@") : ""}?subject=${encodeURIComponent(mail.subject)}`;
}

/** Loads a follow-up to write; the text is kept as typed (half a second after the last key, and when leaving). */
export function useFollowUpDraft(id: string) {
  const [draft, setDraft] = useState<FollowUpDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchFollowUp(id, ctrl.signal)
      .then((d) => { setDraft(d); setText(d.followUp.text); setTopic(d.followUp.topic); })
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, [id]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const t = pending.current;
    pending.current = null;
    if (t !== null) saveFollowUpText(id, t).catch(() => {});
  }, [id]);
  useEffect(() => flush, [flush]);

  const type = (t: string) => {
    setText(t);
    pending.current = t;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 500);
  };
  /** Keeps the thank-you note's topic and takes the points built from it. */
  const keepTopic = () => {
    if (!draft || topic.trim() === draft.followUp.topic) return;
    saveFollowUpTopic(id, topic)
      .then((r) => setDraft((d) => (d ? { ...d, outline: r.outline, followUp: { ...d.followUp, topic: r.followUp.topic } } : d)))
      .catch(() => {});
  };
  return { draft, error, text, type, flush, topic, setTopic, keepTopic };
}

const fieldLabel = { nudge: "Your follow-up", "offer-note": "Your note to self", "thank-you": "Draft · body only, edit freely", "check-in": "Your check-in" } as const;

export function FollowUpWriter({ id, headingId, onAct, onAnnounce }: {
  id: string;
  /** The heading above it (labels the outline). */
  headingId?: string;
  onAct: (action: FollowUpAction, draft: FollowUpDraft) => void;
  onAnnounce: (message: string) => void;
}) {
  const { draft, error, text, type, flush, topic, setTopic, keepTopic } = useFollowUpDraft(id);
  const fieldId = useId();
  const topicId = useId();
  const helpId = useId();
  const countId = useId();
  const outlineId = useId();

  if (error) return <p className="err" role="alert">Couldn't open this follow-up: {error}</p>;
  if (!draft) return <p className="meta" role="status">Loading the follow-up…</p>;

  const kind = draft.followUp.kind;
  const nudge = isMessage(kind);
  const words = wordCount(text);
  const copy = () => {
    flush();
    navigator.clipboard.writeText(text)
      .then(() => onAnnounce(words ? `Copied ${wordsWord(words)} to the clipboard.` : "Nothing to copy yet: write your follow-up first."))
      .catch(() => onAnnounce("Couldn't copy. Select the text and copy it yourself."));
  };
  const act = (action: FollowUpAction) => { flush(); onAct(action, draft); };

  return (
    <div className="stack follow-up" role="group" style={{ gap: "var(--s-5)" }} aria-labelledby={headingId}>
      <div className="stack" style={{ gap: "var(--s-2)" }}>
        <span className="mini" style={{ fontWeight: 600 }} id={outlineId}>Points to cover, from this Application</span>
        <ul className="outline" aria-labelledby={outlineId}>
          {draft.outline.map((p) => <li key={p} lang={langOf(p)}>{p}</li>)}
        </ul>
      </div>
      {kind === "thank-you" && (
        <div className="field">
          <label htmlFor={topicId}>One thing you discussed <span className="meta">(makes the note specific)</span></label>
          <input className="input" id={topicId} value={topic} onChange={(e) => setTopic(e.target.value)} onBlur={keepTopic}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); keepTopic(); } }} lang={langOf(topic)} />
        </div>
      )}
      <div className="field">
        <label htmlFor={fieldId}>{fieldLabel[kind]}</label>
        <span className="help" id={helpId}>
          {nudge ? "Kept as you type. Body only: your mail app adds the greeting line and signature you use." : "Kept as you type. Only you see it."}
        </span>
        <textarea
          className="input" id={fieldId} value={text} onChange={(e) => type(e.target.value)} onBlur={flush}
          style={{ minHeight: "140px" }} aria-describedby={`${helpId} ${countId}`} lang={langOf(text)}
        />
        <span className="help" id={countId} aria-live="polite">
          {wordsWord(words)}{draft.words && ` · ${draft.words.min}–${draft.words.max} works well`}
          {draft.mail && ` · to ${draft.mail.to ?? "the recruiter (add their address under Contacts)"}`}
        </span>
      </div>
      <div className="draft-acts">
        <button className="btn primary" type="button" onClick={copy}>Copy text</button>
        {draft.mail && <a className="btn" href={mailtoOf(draft.mail)} onClick={flush}>Open in Mail</a>}
        <span className="grow" />
        <button className="btn" type="button" onClick={() => act("sent")}>{nudge ? "Mark sent" : "Mark done"}</button>
        <button className="btn ghost" type="button" onClick={() => act("snooze")}>Snooze {daysWord(draft.snoozeDays)}</button>
        <button className="btn ghost" type="button" onClick={() => act("skip")}>No note this time</button>
      </div>
      <p className="never">
        {nudge
          ? `apply-kit never sends mail. Copy the text or open it in Mail and send it yourself, then press "Mark sent": it logs an Event and stops this follow-up.`
          : `A note for you only. "Mark done" logs it on the timeline.`}
      </p>
    </div>
  );
}

