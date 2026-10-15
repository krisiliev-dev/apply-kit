// Step 4 of a package, screening answers (ticket #66; hi-fi: docs/design/hifi/package.html, state
// "4 · Screening answers"): the target posting's questions in the form's order, each with its origin
// (answer bank, adapted, new draft, needs you, translated). Salary always waits for Kris, with the
// posting's range, the floor, the last answer and the rule's suggestion; paragraphs show live word
// counts against the form's limit; an adapted answer says exactly what was removed; reusable new
// answers can be saved to the answer bank, company-specific ones never. Approve waits for every
// answer that needs Kris, and pressing it moves focus to the first one (the action bar).
import type { ChangeResult, PackageView, ScreeningAnswerView, ScreeningAnswersView } from "@apply-kit/core";
import { fits, wordCount } from "@apply-kit/core/screening";
import { useId, useState } from "react";
import { redraftScreeningAnswer, saveScreeningAnswerToBank, setScreeningAnswer } from "../api.ts";
import { Icon } from "../icons.tsx";
import { langOf } from "./lang.ts";

type Props = { pkg: PackageView; onChange: (p: PackageView) => void; say: (m: string) => void };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const euros = (n: number) => `€${n.toLocaleString("en-GB")}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** The element a question's card is, for links and for Approve's focus. */
export const questionElementId = (id: string) => `q-${id}`;

export function AnswersStep({ pkg, onChange, say }: Props) {
  const answers = pkg.answers;
  const part = pkg.parts.find((p) => p.part === "answers")!;
  if (!answers) {
    return (
      <div className="panel">
        <div className="step-title">
          <h2>Screening answers</h2>
          <p className="muted">{part.state === "working" || part.state === "waiting" ? "Reading the form's questions and drafting answers…" : part.what}</p>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="panel">
        <div className="step-title"><h2>Screening answers</h2><p className="muted">{answers.summary}</p></div>
      </div>
      {answers.problem && (
        <div className="banner info" role="note"><span className="text"><b>These are the standard questions.</b> {answers.problem} Check the real form when you apply: the extension adds any other question it finds.</span></div>
      )}
      <ol className="qs">
        {answers.questions.map((q) => <Question key={`${q.id}:${q.text}:${q.origin}`} pkg={pkg} answers={answers} q={q} onChange={onChange} say={say} />)}
      </ol>
    </>
  );
}

/** One question's card: its origin, its answer in the form's own kind of field, and what to know about it. */
function Question({ pkg, q, onChange, say }: Props & { answers: ScreeningAnswersView; q: ScreeningAnswerView }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const headId = `${uid}-h`;
  const errId = `${uid}-err`;

  async function send(act: () => Promise<ChangeResult>, done: string) {
    setBusy(true);
    try {
      const r = await act();
      onChange(r.package);
      if (!r.changed) { setError(r.reason); say(r.reason); return false; }
      setError(null);
      say(done);
      return true;
    } catch (err) {
      setError(`Couldn't save: ${message(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const answer = (text: string, done = "Answer saved.") => send(() => setScreeningAnswer(pkg.id, q.id, text), done);

  const chip = q.needsYou
    ? <span className="chip ask"><Icon name="ask" />{q.label}</span>
    : q.yours && q.origin === "needs-you" ? <span className="chip met"><Icon name="met" />Answered by you</span>
    : <span className="chip neutral">{q.label}</span>;

  return (
    <li className={`q${q.needsYou ? " q-needs" : ""}`} id={questionElementId(q.id)} tabIndex={-1} aria-labelledby={headId}>
      <div className="qh"><b id={headId} lang={langOf(q.question)}>{q.question}{q.required && <span className="meta"> (required)</span>}</b>{chip}</div>
      {q.salary ? <Salary q={q} busy={busy} errId={errId} error={error} onAnswer={answer} />
        : q.type === "select" ? <Choice q={q} headId={headId} busy={busy} onAnswer={answer} />
        // A bank answer as it is: changed in the answer bank, so every form gets the same one.
        : q.origin === "bank" && !q.yours ? <p className="ans" lang={langOf(q.text)}>{q.text || <span className="meta">Left blank</span>}</p>
        : <Words q={q} lang={pkg.language} headId={headId} busy={busy} errId={errId} error={error} onAnswer={answer} />}
      {error && !q.salary && q.type === "select" && <p className="why-off" id={errId} role="alert">{error}</p>}
      <Foot pkg={pkg} q={q} busy={busy} onSend={send} />
    </li>
  );
}

function Salary({ q, busy, errId, error, onAnswer }: { q: ScreeningAnswerView; busy: boolean; errId: string; error: string | null; onAnswer: (t: string, done?: string) => Promise<boolean> }) {
  const s = q.salary!;
  const [value, setValue] = useState(q.text ? Number(q.text).toLocaleString("en-GB") : "");
  const inputId = useId();
  const helpId = `${inputId}-help`;
  return (
    <>
      <p className="mini muted">{s.text} The form takes one number, not a range.</p>
      <div className="field">
        <label htmlFor={inputId}>Your number</label>
        <div className="money">
          <span aria-hidden="true">€</span>
          <input
            className="input num" id={inputId} inputMode="numeric" value={value} placeholder={s.suggested ? `e.g. ${s.suggested.toLocaleString("en-GB")}` : undefined}
            aria-describedby={[helpId, error ? errId : ""].filter(Boolean).join(" ")} aria-invalid={error ? "true" : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
          <span className="meta">gross / month</span>
        </div>
        <span className="help" id={helpId}>
          The number itself is never saved: salary depends on the job.
        </span>
        {error && <span className="why-off" id={errId} role="alert">{error}</span>}
      </div>
      <div className="row">
        {s.suggested !== null && <button className="btn sm" type="button" onClick={() => setValue(s.suggested!.toLocaleString("en-GB"))}>Use {euros(s.suggested)}</button>}
        <button className="btn sm" type="button" disabled={busy} onClick={() => void onAnswer(value, "Salary confirmed.")}>Confirm</button>
      </div>
    </>
  );
}

/** A select question: radio buttons for a short list (Yes / No), else a dropdown. Saved as soon as one is chosen. */
function Choice({ q, headId, busy, onAnswer }: { q: ScreeningAnswerView; headId: string; busy: boolean; onAnswer: (t: string, done?: string) => Promise<boolean> }) {
  const name = useId();
  if (q.options.length <= 3) {
    return (
      <fieldset disabled={busy}>
        <legend className="sr-only">{q.question}</legend>
        <div className="row">
          {q.options.map((o) => (
            <label key={o} className="opt"><input type="radio" name={name} checked={q.text === o} onChange={() => void onAnswer(o, `Answered ${o}.`)} /> {o}</label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <select className="input" aria-labelledby={headId} value={q.text} disabled={busy} onChange={(e) => void onAnswer(e.target.value, `Answered ${e.target.value || "nothing"}.`)}>
      {!q.text && <option value="">Choose…</option>}
      {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** A text or paragraph question, saved when focus leaves it; a paragraph counts its words live against the form's limit. */
function Words({ q, lang, headId, busy, errId, error, onAnswer }: { q: ScreeningAnswerView; lang: string; headId: string; busy: boolean; errId: string; error: string | null; onAnswer: (t: string, done?: string) => Promise<boolean> }) {
  const [text, setText] = useState(q.text);
  const countId = useId();
  const words = wordCount(text);
  const over = !fits(text, q.limit);
  const limit = q.limit.words !== null ? `${words} of ${q.limit.words} words (form limit)`
    : q.limit.chars !== null ? `${text.trim().length} of ${q.limit.chars} characters (form limit)`
    : `${words} ${words === 1 ? "word" : "words"}`;
  const described = [q.type === "long-text" ? countId : "", error ? errId : ""].filter(Boolean).join(" ") || undefined;
  const save = () => { if (text.trim() !== q.text && !over) void onAnswer(text); };
  const field = q.type === "long-text"
    ? <textarea className="textarea" lang={lang} rows={Math.max(3, Math.ceil(text.length / 70))} aria-labelledby={headId} aria-describedby={described} aria-invalid={over || error ? "true" : undefined} value={text} readOnly={busy} onChange={(e) => setText(e.target.value)} onBlur={save} />
    : <input className="input" lang={lang} aria-labelledby={headId} aria-describedby={described} aria-invalid={over || error ? "true" : undefined} value={text} readOnly={busy} onChange={(e) => setText(e.target.value)} onBlur={save} />;
  return (
    <>
      {field}
      {q.type === "long-text" && <span className={`count num${over ? " over" : ""}`} id={countId}>{limit}{over ? ": shorten it to save" : ""}</span>}
      {error && <span className="why-off" id={errId} role="alert">{error}</span>}
      {q.origin === "translated" && q.needsYou && <div className="row"><button className="btn sm" type="button" disabled={busy || over} onClick={() => void onAnswer(text, "Translation confirmed.")}>Confirm the translation</button></div>}
    </>
  );
}

/** Where the answer came from and what Kris can do with it. */
function Foot({ pkg, q, busy, onSend }: { pkg: PackageView; q: ScreeningAnswerView; busy: boolean; onSend: (act: () => Promise<ChangeResult>, done: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const diffId = useId();
  const used = q.bank && q.bank.useCount > 0 ? `Used in ${q.bank.useCount} ${q.bank.useCount === 1 ? "application" : "applications"}${q.bank.lastUsedAt ? ` · last ${shortDate(q.bank.lastUsedAt)}` : ""}` : null;
  return (
    <>
      <div className="foot">
        <span>{q.salary ? null : q.note}{used && ` ${used}.`}</span>
        {q.pieces.length > 0 && <span>Rests on: {q.pieces.map((p) => p.label).join("; ")}</span>}
        {q.changed && (
          <button className="btn ghost sm" type="button" aria-expanded={open} aria-controls={diffId} onClick={() => setOpen(!open)}>What changed</button>
        )}
        {q.bank && <a className="btn ghost sm" href={`/profile/answers/${encodeURIComponent(q.bank.answerId)}`}>Edit in the answer bank</a>}
        {q.redraft && (
          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void onSend(() => redraftScreeningAnswer(pkg.id, q.id), "New draft written.")}>Write another draft</button>
        )}
        {q.save.offered && (
          <button className="btn ghost sm" type="button" disabled={busy || !q.text} onClick={() => void onSend(() => saveScreeningAnswerToBank(pkg.id, q.id), "Saved to your answer bank.")}>Save to answer bank</button>
        )}
        {q.save.savedTo && <span className="chip met"><Icon name="met" />In your answer bank</span>}
      </div>
      {q.changed && (
        <div id={diffId} className="src" hidden={!open}>
          {q.changed.removed.map((r) => <span key={r}>Removed: "{r}"</span>)}
          <span className="where">{q.changed.note}</span>
        </div>
      )}
    </>
  );
}
