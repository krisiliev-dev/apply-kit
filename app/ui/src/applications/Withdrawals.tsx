// Closing other processes after an offer (hi-fi: application.html, states "Accepted · withdraw others"
// and the decline dialog of "Offer received"). Accepting an offer (from the Offer page or Accepted in
// any Status select) opens WithdrawDialog: every other open Application with a polite withdrawal
// draft, Copy text, Open in Mail, "Keep this one open" and "Mark sent · Withdrawn". A Status moves to
// Withdrawn only on Mark sent; unsent ones wait in Needs you as "Withdrawal to send". It is a real
// modal (TA-10): focus goes to its heading, Esc closes it and changes nothing, and focus returns to
// the Status control. DeclineDialog offers an optional gracious reply before "Mark declined".
import type { FollowUpDraft, Withdrawal, Withdrawals } from "@apply-kit/core";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { fetchDeclineDraft, fetchWithdrawals, followUpAction, undoApplicationEvent } from "../api.ts";
import { useToaster } from "../feed/toast.tsx";
import { mailtoOf, noDraftWords, useFollowUpDraft } from "./FollowUpWriter.tsx";
import { statusLabel, wordsWord } from "./words.ts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Opens a native dialog as a modal once mounted, and focuses its heading. */
function useModal(headingId: string) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    document.getElementById(headingId)?.focus();
  }, [headingId]);
  return ref;
}

/**
 * "Withdraw from your other applications?" after accepting an offer. `onChanged` refreshes the page
 * behind it; `onClose` returns focus (to the Status control that opened it).
 */
export function WithdrawDialog({ accepted, onChanged, onClose }: {
  accepted: { title: string; company: string };
  onChanged: () => Promise<unknown>;
  onClose: () => void;
}) {
  const uid = useId();
  const ref = useModal(`${uid}-h`);
  // Toasts live inside the modal, so their Undo can be reached while it is open.
  const toaster = useToaster();
  const [list, setList] = useState<Withdrawals | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await fetchWithdrawals());
    } catch (err) {
      setError(message(err));
    }
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchWithdrawals(ctrl.signal).then(setList).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, []);

  const close = () => { ref.current?.close(); onClose(); };
  const items = list?.items ?? [];
  const open = items.filter((w) => w.followUp.state === "pending").length;

  async function act(w: Withdrawal, action: "sent" | "skip") {
    const a = w.application;
    const focusHeading = () => requestAnimationFrame(() => document.getElementById(`${uid}-h`)?.focus());
    try {
      const { event } = await followUpAction(w.followUp.id, action);
      await load();
      await onChanged();
      if (action === "skip") focusHeading();
      else requestAnimationFrame(() => document.getElementById(`${uid}-${w.followUp.id}`)?.focus());
      toaster.show({
        message: action === "sent" ? `${a.company}: ${statusLabel[a.status]} → Withdrawn. Logged by you.` : `Kept open · no withdrawal for ${a.company}.`,
        returnFocus: focusHeading,
        undo: () => {
          undoApplicationEvent(event.id).then(load).then(onChanged)
            .then(() => toaster.announce(action === "sent" ? `Undone. ${a.company} is ${statusLabel[a.status]} again.` : `Undone. ${a.company} is back in the list.`))
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
      });
    } catch (err) {
      toaster.show({ message: `Couldn't do that: ${message(err)}` });
    }
  }

  return (
    <dialog ref={ref} className="dlg wide" aria-labelledby={`${uid}-h`} onCancel={(e) => { e.preventDefault(); close(); }}>
      <div className="body">
        <div className="dlg-head">
          <div className="stack" style={{ gap: "var(--s-1)" }}>
            <span className="meta">Accepted · <span lang={langOf(accepted.title)}>{accepted.title}</span> at {accepted.company}</span>
            <h2 id={`${uid}-h`} tabIndex={-1}>Withdraw from your other applications?</h2>
          </div>
          <button className="btn ghost sm x" type="button" aria-label="Close" onClick={close}>✕</button>
        </div>
        {error && <p className="err" role="alert">Couldn't load them: {error}</p>}
        {!list && !error && <p className="meta" role="status">Loading your open applications…</p>}
        {list && (items.length ? (
          <>
            <p className="muted mini">
              You have {open === 1 ? "1 open Application" : `${open} open Applications`} to close. A short, polite note to each frees their time and keeps
              the door open. Keep any open you like, send each note from your own mail, and press "Mark sent"; only then does it move to Withdrawn.
            </p>
            <ul className="wd">
              {items.map((w) => <WithdrawalItem key={w.followUp.id} w={w} itemId={`${uid}-${w.followUp.id}`} onAct={(a) => { act(w, a).catch(() => {}); }} onAnnounce={toaster.announce} />)}
            </ul>
          </>
        ) : (
          <p className="muted mini">No other open Applications, so there's nothing to withdraw.</p>
        ))}
        <div className="dlg-foot">
          <button className="btn primary" type="button" onClick={close}>Done for now</button>
          <span className="grow" />
          {open > 0 && <span className="meta">Unsent ones wait in Needs you as "Withdrawal to send"</span>}
        </div>
      </div>
      {toaster.element}
    </dialog>
  );
}

function WithdrawalItem({ w, itemId, onAct, onAnnounce }: {
  w: Withdrawal;
  itemId: string;
  onAct: (action: "sent" | "skip") => void;
  onAnnounce: (message: string) => void;
}) {
  const { draft, error, text, type, flush } = useFollowUpDraft(w.followUp.id);
  const fieldId = useId();
  const helpId = useId();
  const a = w.application;
  const sent = w.followUp.state === "sent";
  const copy = () => {
    flush();
    navigator.clipboard.writeText(text)
      .then(() => onAnnounce(wordCount(text) ? `Copied ${wordsWord(wordCount(text))} to the clipboard.` : "Nothing to copy yet: write the note first."))
      .catch(() => onAnnounce("Couldn't copy. Select the text and copy it yourself."));
  };
  const lang = langOf(text) ?? (draft?.draft?.language === "bg" ? "bg" : undefined);
  return (
    <li className={sent ? "is-sent" : undefined}>
      <div className="top">
        <span><b lang={langOf(a.title)}>{a.title}</b> · {a.company}</span>
        <span className={`status ${sent ? "withdrawn" : a.status}`}><i />{sent ? "Withdrawn" : statusLabel[a.status]}</span>
        <span className="grow" />
        {draft?.mail?.to && <span className="meta">to {draft.mail.to}</span>}
      </div>
      {error && <p className="err" role="alert">Couldn't open its draft: {error}</p>}
      {!draft && !error && <p className="meta" role="status">Loading the draft…</p>}
      {draft && (
        <>
          <label className="sr-only" htmlFor={fieldId}>Withdrawal note to {a.company}</label>
          <textarea
            className="input" id={fieldId} value={text} onChange={(e) => type(e.target.value)} onBlur={flush} lang={lang} readOnly={sent}
            aria-describedby={draft.draft ? undefined : helpId}
            placeholder={draft.draft ? undefined : draft.outline.join(" ")}
          />
          {!draft.draft && draft.noDraft && (
            <span className="help" id={helpId}>{noDraftWords(draft.noDraft).lead} Write a few lines: thank them, say you've accepted another offer, keep the door open.</span>
          )}
          <div className="draft-acts">
            {sent ? (
              <span className="meta" id={itemId} tabIndex={-1}>Marked sent · moved to Withdrawn. Undo it from the toast or its timeline.</span>
            ) : (
              <>
                <button className="btn sm" type="button" onClick={copy}>Copy text<span className="sr-only">: {a.company}</span></button>
                {draft.mail && <a className="btn ghost sm" href={mailtoOf(draft.mail)} onClick={flush}>Open in Mail<span className="sr-only">: {a.company}</span></a>}
                <span className="grow" />
                <button className="btn ghost sm" type="button" onClick={() => { flush(); onAct("skip"); }}>Keep this one open<span className="sr-only">: {a.company}</span></button>
                <button className="btn sm" type="button" onClick={() => { flush(); onAct("sent"); }}>Mark sent · Withdrawn<span className="sr-only">: {a.company}</span></button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/** "Declined the … offer?": an optional gracious reply to send yourself, then Mark declined. */
export function DeclineDialog({ application, onDecline, onClose, onAnnounce }: {
  application: { id: string; title: string; company: string };
  onDecline: () => void;
  onClose: () => void;
  onAnnounce: (message: string) => void;
}) {
  const uid = useId();
  const ref = useModal(`${uid}-h`);
  const [draft, setDraft] = useState<FollowUpDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchDeclineDraft(application.id, ctrl.signal).then(setDraft).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, [application.id]);
  const close = () => { ref.current?.close(); onClose(); };
  return (
    <dialog ref={ref} className="dlg" aria-labelledby={`${uid}-h`} onCancel={(e) => { e.preventDefault(); close(); }}>
      <div className="body">
        <div className="dlg-head">
          <h2 id={`${uid}-h`} tabIndex={-1}>Declined the {application.company} offer?</h2>
          <button className="btn ghost sm x" type="button" aria-label="Close" onClick={close}>✕</button>
        </div>
        <p className="muted mini">
          The Application moves to Withdrawn with the reason "declined offer". A short, gracious reply is below if you haven't written one; send it from your own mail.
        </p>
        {error && <p className="err" role="alert">Couldn't draft a reply: {error}. You can still mark it declined.</p>}
        {!draft && !error && <p className="meta" role="status">Drafting a reply…</p>}
        {draft && <DeclineText key={draft.followUp.id} id={draft.followUp.id} onAnnounce={onAnnounce} />}
        <div className="dlg-foot">
          <button className="btn primary" type="button" onClick={() => { ref.current?.close(); onDecline(); }}>Mark declined</button>
          <span className="grow" />
          <button className="btn ghost" type="button" onClick={close}>Cancel</button>
        </div>
      </div>
    </dialog>
  );
}

function DeclineText({ id, onAnnounce }: { id: string; onAnnounce: (message: string) => void }) {
  const { draft, text, type, flush } = useFollowUpDraft(id);
  const fieldId = useId();
  const helpId = useId();
  if (!draft) return <p className="meta" role="status">Drafting a reply…</p>;
  const copy = () => {
    flush();
    navigator.clipboard.writeText(text)
      .then(() => onAnnounce(text.trim() ? "Copied. Paste it into your mail." : "Nothing to copy yet."))
      .catch(() => onAnnounce("Couldn't copy. Select the text and copy it yourself."));
  };
  return (
    <div className="stack decline-text" style={{ gap: "var(--s-3)" }}>
      <div className="field">
        <label htmlFor={fieldId}>Draft · optional</label>
        <textarea
          className="input" id={fieldId} value={text} onChange={(e) => type(e.target.value)} onBlur={flush}
          lang={langOf(text) ?? (draft.draft?.language === "bg" ? "bg" : undefined)} aria-describedby={helpId}
          placeholder={draft.draft ? undefined : draft.outline.join(" ")}
        />
        <span className="help" id={helpId}>
          {draft.draft ? "Kept as you type; edits teach your voice." : draft.noDraft ? noDraftWords(draft.noDraft).lead : "Kept as you type."}
          {draft.mail?.to && ` · to ${draft.mail.to}`}
        </span>
      </div>
      <div className="draft-acts">
        <button className="btn sm" type="button" onClick={copy}>Copy text</button>
        {draft.mail && <a className="btn ghost sm" href={mailtoOf(draft.mail)} onClick={flush}>Open in Mail</a>}
      </div>
    </div>
  );
}

