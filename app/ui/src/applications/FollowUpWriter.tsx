// Writing one follow-up (hi-fi: application.html "Follow-up due" and "Follow-up · AI budget out", and
// the draft dialog in applications.html "Follow-up due · draft"): the Track assistant's draft to edit
// freely, with a help line naming where any number came from; or, with no draft (budget out, no AI, a
// draft that broke the rules), the points to cover with no model call and the reason. The text is kept
// as typed and teaches the user's voice. Copy text and Open in Mail (a mailto with recipient and
// subject; the user sends, there is no Send button); Mark sent, Snooze and "No note this time", each
// undoable by whoever opened it. Used inline on the Application page and in a dialog over Needs you.
import type { FollowUpDraft, NoDraft } from "@apply-kit/core";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { fetchFollowUp, saveFollowUpText } from "../api.ts";
import { daysWord, longDay, wordsWord } from "./words.ts";

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
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchFollowUp(id, ctrl.signal)
      .then((d) => { setDraft(d); setText(d.text); })
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
  return { draft, error, text, type, flush };
}

/** Why there's no draft, in plain words: the banner's bold line and what follows it. */
export function noDraftWords(n: NoDraft): { lead: string; rest: string } {
  if (n.reason === "budget-out") {
    return {
      lead: `No draft this time: this month's AI budget ($${n.capUsd % 1 ? n.capUsd.toFixed(2) : n.capUsd}) ran out${n.ranOutOn ? ` on ${longDay(n.ranOutOn)}` : ""}.`,
      rest: `It resets on ${longDay(n.resetsOn)}. Everything else works, and the points below make writing this one quick.`,
    };
  }
  if (n.reason === "no-ai") {
    return { lead: "No draft: AI isn't set up.", rest: "Drafts need OPENROUTER_API_KEY and AI_MONTHLY_CAP_USD in .env. The points below make writing this one quick." };
  }
  return { lead: "No draft this time.", rest: `The draft didn't follow the rules (${n.why}), so it isn't shown. The points below make writing this one quick.` };
}

/** The banner for a follow-up with no draft (the Application page shows it at the top, the dialog inside). */
export function NoDraftBanner({ noDraft }: { noDraft: NoDraft }) {
  const w = noDraftWords(noDraft);
  return (
    <div className="banner warning" role="status">
      <span className="text"><b>{w.lead}</b> {w.rest}</span>
    </div>
  );
}

export function FollowUpWriter({ id, headingId, onAct, onAnnounce, onLoaded }: {
  id: string;
  /** The heading above it (labels the group). */
  headingId?: string;
  onAct: (action: FollowUpAction, draft: FollowUpDraft) => void;
  onAnnounce: (message: string) => void;
  /** Told once it is loaded; when given, the caller shows the no-draft banner (else it is shown here). */
  onLoaded?: (draft: FollowUpDraft) => void;
}) {
  const { draft, error, text, type, flush } = useFollowUpDraft(id);
  useEffect(() => { if (draft) onLoaded?.(draft); }, [draft, onLoaded]);
  const fieldId = useId();
  const helpId = useId();
  const countId = useId();
  const outlineId = useId();

  if (error) return <p className="err" role="alert">Couldn't open this follow-up: {error}</p>;
  if (!draft) return <p className="meta" role="status">Loading the follow-up…</p>;

  const nudge = draft.followUp.kind === "nudge";
  const words = wordCount(text);
  const copy = () => {
    flush();
    navigator.clipboard.writeText(text)
      .then(() => onAnnounce(words ? `Copied ${wordsWord(words)} to the clipboard.` : "Nothing to copy yet: write your follow-up first."))
      .catch(() => onAnnounce("Couldn't copy. Select the text and copy it yourself."));
  };
  const act = (action: FollowUpAction) => { flush(); onAct(action, draft); };

  const d = draft.draft;
  const numbers = d?.numbers.map((n) => `"${n.quote}" comes from your Master profile (${n.origin})`).join(" · ");
  return (
    <div className="stack follow-up" role="group" style={{ gap: "var(--s-5)" }} aria-labelledby={headingId}>
      {draft.noDraft && !onLoaded && <NoDraftBanner noDraft={draft.noDraft} />}
      {!d && (
        <div className="stack" style={{ gap: "var(--s-2)" }}>
          <span className="mini" style={{ fontWeight: 600 }} id={outlineId}>Points to cover, from this Application</span>
          <ul className="outline" aria-labelledby={outlineId}>
            {draft.outline.map((p) => <li key={p} lang={langOf(p)}>{p}</li>)}
          </ul>
        </div>
      )}
      <div className="field">
        <label htmlFor={fieldId}>{d ? "Draft · body only, edit freely" : nudge ? "Your follow-up" : "Your note to self"}</label>
        {!d && (
          <span className="help" id={helpId}>
            {nudge ? "Kept as you type. What you write here also teaches your voice. Body only: your mail app adds the greeting and signature." : "Kept as you type. Only you see it."}
          </span>
        )}
        <textarea
          className="input" id={fieldId} value={text} onChange={(e) => type(e.target.value)} onBlur={flush}
          aria-describedby={`${d ? "" : `${helpId} `}${countId}`} lang={langOf(text) ?? (d?.language === "bg" ? "bg" : undefined)}
        />
        <span className="help" id={countId} aria-live="polite">
          {wordsWord(words)}{draft.words && !d && ` · ${draft.words.min}–${draft.words.max} works well`}
          {draft.mail && ` · to ${draft.mail.to ?? "the recruiter (add their address under Contacts)"}`}
          {numbers && ` · ${numbers}`}
          {d && " · kept as you type; edits teach your voice"}
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
          ? `apply-kit never sends mail. Copy the text or open it in Mail and send it yourself, then press "Mark sent": it logs an Event and stops this follow-up. If you BCC the job mailbox, apply-kit notices the sent copy and marks it for you.`
          : `A note for you only. "Mark done" logs it on the timeline.`}
      </p>
    </div>
  );
}

