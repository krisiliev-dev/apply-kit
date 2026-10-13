// "Email to match" in Needs you (hi-fi: docs/design/hifi/applications.html, state Email to match): an
// email that would change something but didn't match confidently. It shows the email (with an English
// line for one in another language), why nothing changed, the likely Applications with their reasons,
// a search of all the others, "a new Application" and "not about an application". Matching and moving
// are separate buttons. With no choice made, the error is tied to the radio group and focus goes to
// its first option (TA-05). The answer is remembered for the sender.
import type { ApplicationSummary, EmailAnswer, EmailToMatch } from "@apply-kit/core";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { answerEmail, fetchApplications, undoApplicationEvent } from "../api.ts";
import type { Toaster } from "../feed/toast.tsx";
import { dayTime, emailKindPhrase, statusLabel } from "./words.ts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const addressOf = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;
/** Bulgarian text is marked as such, so screen readers read it in Bulgarian. */
const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);

export function EmailsToMatch({ emails, total, toaster, onAnswered }: {
  emails: EmailToMatch[];
  /** Every Application, for "Search all N". */
  total: number;
  toaster: Toaster;
  /** Reloads the list (and the emails) after an answer or its undo. */
  onAnswered: () => Promise<unknown>;
}) {
  if (!emails.length) return null;
  return (
    <section className="stack ny" aria-labelledby="ny-h">
      <div className="sec-head"><h2 id="ny-h">Needs you · {emails.length}</h2>{emails.length > 1 && <span className="meta">Newest first</span>}</div>
      <ul className="ny-list">
        {emails.map((e) => <li key={e.email.id}><EmailCard item={e} total={total} toaster={toaster} onAnswered={onAnswered} /></li>)}
      </ul>
    </section>
  );
}

type Choice = { kind: "application"; id: string } | { kind: "another" } | { kind: "new" } | { kind: "none" } | null;

function EmailCard({ item, total, toaster, onAnswered }: { item: EmailToMatch; total: number; toaster: Toaster; onAnswered: () => Promise<unknown> }) {
  const { email, moveTo } = item;
  const [choice, setChoice] = useState<Choice>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  const name = useId();
  const errId = useId();
  const address = addressOf(email.from);

  const focusFirst = () => fieldsetRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const move = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-move") === "true";
    let answer: EmailAnswer | null = null;
    if (choice?.kind === "application") answer = { choice: "application", applicationId: choice.id, move };
    else if (choice?.kind === "another" && picked) answer = { choice: "application", applicationId: picked, move };
    else if (choice?.kind === "new") answer = { choice: "new", move };
    else if (choice?.kind === "none") answer = { choice: "none" };
    if (!answer) {
      setError(choice?.kind === "another" ? "Search for the application and choose it first." : "Choose where this email belongs first.");
      if (choice?.kind === "another") fieldsetRef.current?.querySelector<HTMLInputElement>("input[type=search]")?.focus();
      else focusFirst();
      return;
    }
    setBusy(true);
    try {
      const { application, event } = await answerEmail(email.id, answer);
      await onAnswered();
      const moved = event?.to ? ` · ${statusLabel[event.from!]} → ${statusLabel[event.to]}` : "";
      toaster.show({
        message: application
          ? `Matched to ${application.title} at ${application.company}${moved}. Logged by you.`
          : "Kept as not about an application. Later mail from this sender is left alone.",
        returnFocus: () => document.getElementById("ny-h")?.focus(),
        undo: event?.to
          ? () => {
              undoApplicationEvent(event.id).then(onAnswered)
                .then(() => toaster.announce(`Undone. Back to ${statusLabel[event.from!]}; the email stays on its timeline.`))
                .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
            }
          : undefined,
      });
    } catch (err) {
      setError(message(err));
      focusFirst();
    } finally {
      setBusy(false);
    }
  }

  const pick = (c: Choice) => { setChoice(c); setError(null); };
  const isChosen = (c: NonNullable<Choice>) => choice?.kind === c.kind && (c.kind !== "application" || (choice as { id: string }).id === c.id);
  const lang = email.language && email.language !== "en" ? email.language : langOf(`${email.subject} ${email.quote}`);

  return (
    <div className="needs wide">
      <form className="stack match-form" onSubmit={submit} noValidate>
        <div className="stack tight">
          <span className="kind">Email to match · {dayTime(email.receivedAt)}</span>
          <span className="what">"<span lang={langOf(email.subject)}>{email.subject}</span>" from {address}</span>
        </div>
        <div className="quote">
          <span className="where">{email.from} · to the job mailbox{email.attachments.length ? ` · ${email.attachments.length === 1 ? "1 attachment" : `${email.attachments.length} attachments`}` : ""}</span>
          <span lang={lang}>"{email.quote}"</span>
          {email.summary && <span className="tr">In English: {email.summary}</span>}
        </div>
        <p className="why">{item.why}</p>
        <fieldset ref={fieldsetRef} aria-describedby={error ? errId : undefined} aria-invalid={error ? true : undefined}>
          <legend>Which application is it about?</legend>
          {item.candidates.map((c) => (
            <Option key={c.application.id} name={name} checked={isChosen({ kind: "application", id: c.application.id })} onChange={() => pick({ kind: "application", id: c.application.id })}>
              <span lang={langOf(c.application.title)}>{c.application.title}</span> · {c.application.company} <span className="meta">{c.reasons.join(" ")}</span>
            </Option>
          ))}
          <Option name={name} checked={isChosen({ kind: "another" })} onChange={() => pick({ kind: "another" })}>
            {item.candidates.length ? "Another application…" : "One of your applications…"} <span className="meta">Search all {total}</span>
          </Option>
          {choice?.kind === "another" && <Search name={`${name}-pick`} picked={picked} onPick={(id) => { setPicked(id); setError(null); }} />}
          <Option name={name} checked={isChosen({ kind: "new" })} onChange={() => pick({ kind: "new" })}>
            A new Application: <span lang={langOf(item.newApplication.title)}>{item.newApplication.title}</span> · {item.newApplication.company}
            <span className="meta">Applied outside apply-kit or through a recruiter</span>
          </Option>
          <Option name={name} checked={isChosen({ kind: "none" })} onChange={() => pick({ kind: "none" })}>
            Not about an application <span className="meta">Keep the email, change nothing</span>
          </Option>
        </fieldset>
        {error && <p className="err" id={errId} role="alert">{error}</p>}
        <div className="row">
          {moveTo && choice?.kind !== "none" ? (
            <>
              <button className="btn primary" type="submit" data-move="true" disabled={busy}>Match and move to {statusLabel[moveTo]}</button>
              <button className="btn" type="submit" data-move="false" disabled={busy}>Match, keep the Status</button>
            </>
          ) : (
            <button className="btn primary" type="submit" data-move="false" disabled={busy}>{choice?.kind === "none" ? "Keep it unmatched" : "Match"}</button>
          )}
        </div>
        <p className="meta">
          {item.remembers
            ? `Your choice is remembered: later mail from ${item.remembers} goes to the same place without asking. `
            : "It comes from a job system many companies use, so your choice is kept for this email only. "}
          {moveTo ? `It reads like ${email.kind ? emailKindPhrase[email.kind] : "a reply"}; a Status it moves can be undone from the Application's timeline.` : ""}
        </p>
      </form>
    </div>
  );
}

function Option({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="opt">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

/** "Another application…": search every Application by job or company and pick one. */
function Search({ name, picked, onPick }: { name: string; picked: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState<ApplicationSummary[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    inputRef.current?.focus();
    const ctrl = new AbortController();
    fetchApplications(["applied", "closed"], ctrl.signal)
      .then((list) => setAll(list.groups.flatMap((g) => g.applications)))
      .catch(() => setAll([]));
    return () => ctrl.abort();
  }, []);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = (all ?? []).filter((a) => words.every((w) => `${a.title} ${a.company}`.toLowerCase().includes(w))).slice(0, 8);

  return (
    <div className="stack match-search">
      <label className="sr-only" htmlFor={id}>Search applications by job or company</label>
      <input className="input" id={id} ref={inputRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job or company" autoComplete="off" />
      {all === null ? <p className="meta" role="status">Loading applications…</p>
        : found.length === 0 ? <p className="meta" role="status">No application matches "{q}".</p>
        : (
          <div className="stack tight" role="group" aria-label="Applications found">
            {found.map((a) => (
              <label key={a.id} className="opt">
                <input type="radio" name={name} checked={picked === a.id} onChange={() => onPick(a.id)} />
                <span><span lang={langOf(a.title)}>{a.title}</span> · {a.company} <span className="meta">{statusLabel[a.status]}</span></span>
              </label>
            ))}
          </div>
        )}
    </div>
  );
}
