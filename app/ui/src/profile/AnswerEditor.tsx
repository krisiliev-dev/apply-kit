// Add answer and Edit answer (hi-fi: profile.html, "Edit answer"). Labels above fields, help under
// labels, errors under fields with an error summary that links to each one. Each wording is its own
// row with its language (PA-14), so Bulgarian ones are marked lang="bg".
import type { Answer, AnswerCategory, AnswerChange, AnswerField, AnswerKind, AnswerMode, AnswerProblem, AnswerRule } from "@apply-kit/core";
import { answerKinds, answerModes, languageOf } from "@apply-kit/core/answers";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { deleteAnswer, fetchAnswer, saveAnswer } from "../api.ts";
import { changeLine, kindLabel, modeLabel, shortDate } from "./answers-common.ts";
import { message, navLink, type Go } from "./common.tsx";

interface Draft {
  question: string;
  category: AnswerCategory;
  kind: AnswerKind;
  mode: AnswerMode;
  en: string;
  bg: string;
  wordings: string[];
  ruleText: string;
  floor: string;
  salaryRule: boolean;
}

const blank: Draft = { question: "", category: "standard", kind: "text", mode: "fill", en: "", bg: "", wordings: [], ruleText: "", floor: "", salaryRule: false };

const draftOf = (a: Answer): Draft => ({
  question: a.question, category: a.category, kind: a.kind, mode: a.mode, en: a.versions.en ?? "", bg: a.versions.bg ?? "",
  wordings: a.wordings.map((w) => w.text), ruleText: a.rule?.text ?? "", floor: a.rule?.params?.floor?.toString() ?? "",
  salaryRule: a.rule?.params?.kind === "salary",
});

const modeHelp: Record<AnswerMode, string> = {
  fill: "you still see it before you press Submit",
  ask: "for answers that depend on the job, like salary; a rule can suggest a value",
  blank: "for voluntary questions; \"Prefer not to say\" only where an answer is required",
};

/** The id of the field each problem points at, so the summary's links and aria-describedby agree. */
const fieldId: Record<AnswerField, string> = {
  question: "ae-q", wordings: "ae-ph-new", en: "ae-en", bg: "ae-bg", kind: "ae-type", mode: "ae-mode", rule: "ae-floor",
};

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; answer: Answer | null; history: AnswerChange[] };

export function AnswerEditor({ id, go, announce, onSaved }: {
  /** The answer to edit, or null to add one. */
  id: string | null;
  go: Go;
  announce: (msg: string) => void;
  /** After a save or delete, with what to say on the answer bank. */
  onSaved: (said: string) => void;
}) {
  const [load, setLoad] = useState<Load>(id ? { state: "loading" } : { state: "ready", answer: null, history: [] });
  const [draft, setDraft] = useState<Draft>(blank);
  const [wording, setWording] = useState("");
  const [problems, setProblems] = useState<AnswerProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [refused, setRefused] = useState(0);
  useEffect(() => { if (refused) summaryRef.current?.focus(); }, [refused]);
  const ready = load.state === "ready";
  useEffect(() => { if (ready) headingRef.current?.focus(); }, [ready]);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    fetchAnswer(id, ctrl.signal)
      .then(({ answer, history }) => { setDraft(draftOf(answer)); setLoad({ state: "ready", answer, history }); })
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setLoad({ state: "error", message: message(err) }); });
    return () => ctrl.abort();
  }, [id]);

  if (load.state === "loading") return <p className="meta" role="status">Loading the answer…</p>;
  if (load.state === "error") {
    return (
      <div className="stack">
        <div className="banner error" role="alert"><span className="text"><b>Couldn't load the answer.</b> {load.message}</span></div>
        <a className="btn" href="/profile/answers" onClick={navLink(go)}>Back to the answer bank</a>
      </div>
    );
  }

  const { answer, history } = load;
  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setError(null); };
  const problemsOf = (f: AnswerField) => problems.filter((p) => p.field === f);
  const describedBy = (f: AnswerField, ...more: string[]) => [...more, ...(problemsOf(f).length ? [`${fieldId[f]}-err`] : [])].join(" ") || undefined;
  const invalid = (f: AnswerField) => (problemsOf(f).length ? true : undefined);
  const errors = (f: AnswerField) => problemsOf(f).length > 0 && (
    <span className="err" id={`${fieldId[f]}-err`}>{problemsOf(f).map((p) => p.message).join(" ")}</span>
  );

  function addWording() {
    const w = wording.trim();
    if (w && !draft.wordings.some((x) => x.toLowerCase() === w.toLowerCase())) {
      set({ wordings: [...draft.wordings, w] });
      announce(`Wording added: ${w}.`);
    }
    setWording("");
  }
  const onWordingKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); addWording(); }
  };
  function removeWording(i: number) {
    const w = draft.wordings[i]!;
    set({ wordings: draft.wordings.filter((_, j) => j !== i) });
    announce(`Wording removed: ${w}.`);
    document.getElementById(fieldId.wordings)?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const floor = draft.floor.trim() === "" ? null : Number(draft.floor);
    const rule: AnswerRule | null = draft.mode === "ask" && draft.ruleText.trim()
      ? { text: draft.ruleText, params: draft.salaryRule || floor !== null ? { kind: "salary", take: "upper-half", floor, currency: "EUR" } : null }
      : null;
    try {
      const result = await saveAnswer({
        ...(answer && { id: answer.id }),
        question: draft.question,
        category: draft.category,
        kind: draft.kind,
        mode: draft.mode,
        versions: draft.mode === "ask" ? {} : { en: draft.en, bg: draft.bg },
        wordings: wording.trim() ? [...draft.wordings, wording.trim()] : draft.wordings,
        rule,
      });
      if (!result.saved) {
        setProblems(result.problems);
        setRefused((n) => n + 1);
        return;
      }
      onSaved(answer ? `Saved "${result.answer.question}". Future packages and fills use it; approved packages keep their answers.` : `Added "${result.answer.question}" to your answer bank.`);
    } catch (err) {
      setError(`Couldn't save: ${message(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!answer) return;
    try {
      await deleteAnswer(answer.id);
      setConfirming(false);
      onSaved(`Deleted "${answer.question}". Approved packages keep their answers.`);
    } catch (err) {
      setConfirming(false);
      setError(`Couldn't delete: ${message(err)}`);
    }
  }

  const title = answer ? answer.question : "Add answer";
  const blankMode = draft.mode === "blank";

  return (
    <section className="stack" style={{ gap: "var(--s-6)" }} aria-labelledby="ae-h">
      <nav className="crumbs" aria-label="Breadcrumb"><a href="/profile/answers" onClick={navLink(go)}>Answer bank</a> / <span aria-current="page">{title}</span></nav>
      <h1 id="ae-h" tabIndex={-1} ref={headingRef} style={{ fontSize: "var(--fs-h2)" }}>{title}</h1>
      <div className="cols">
        <form className="form panel" onSubmit={(e) => void submit(e)} noValidate>
          {problems.length > 0 && (
            <div className="banner error errsum" role="alert" tabIndex={-1} ref={summaryRef}>
              <b>{problems.length === 1 ? "1 thing" : `${problems.length} things`} to fix before saving</b>
              <ul>
                {problems.map((p, i) => (
                  <li key={i}><a href={`#${fieldId[p.field]}`} onClick={(e) => { e.preventDefault(); document.getElementById(fieldId[p.field])?.focus(); }}>{p.message}</a></li>
                ))}
              </ul>
            </div>
          )}

          <div className="field">
            <label htmlFor={fieldId.question}>Question</label>
            <span className="help" id="ae-q-help">As you'd name it, e.g. "Notice period".</span>
            <input className="input" id={fieldId.question} value={draft.question} onChange={(e) => set({ question: e.target.value })} aria-invalid={invalid("question")} aria-describedby={describedBy("question", "ae-q-help")} />
            {errors("question")}
          </div>

          <fieldset>
            <legend>Kind</legend>
            <div className="row">
              <label className="opt"><input type="radio" name="ae-cat" checked={draft.category === "standard"} onChange={() => set({ category: "standard" })} /> Standard <span className="meta">asked by most portals</span></label>
              <label className="opt"><input type="radio" name="ae-cat" checked={draft.category === "screening"} onChange={() => set({ category: "screening" })} /> Screening <span className="meta">a question some jobs ask</span></label>
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor={fieldId.kind}>Type of answer</label>
            <select className="input answer-type" id={fieldId.kind} value={draft.kind} onChange={(e) => set({ kind: e.target.value as AnswerKind })} aria-invalid={invalid("kind")} aria-describedby={describedBy("kind")}>
              {answerKinds.map((k) => <option key={k} value={k}>{kindLabel[k]}</option>)}
            </select>
            {errors("kind")}
          </div>

          <fieldset id={fieldId.mode} tabIndex={-1}>
            <legend>When a form asks it</legend>
            {answerModes.map((m) => (
              <label className="opt" key={m}>
                <input type="radio" name="ae-mode" checked={draft.mode === m} onChange={() => set({ mode: m })} />
                <span>{modeLabel[m]} <span className="meta">{modeHelp[m]}</span></span>
              </label>
            ))}
          </fieldset>

          {draft.mode === "ask" ? (
            <>
              <div className="field">
                <label htmlFor="ae-rule">Rule <span className="meta">optional</span></label>
                <span className="help" id="ae-rule-help">Suggests a value each time; you still decide. E.g. "Upper half of the posting's stated range".</span>
                <textarea className="textarea short" id="ae-rule" value={draft.ruleText} onChange={(e) => set({ ruleText: e.target.value })} aria-describedby="ae-rule-help" />
              </div>
              <div className="field">
                <label htmlFor={fieldId.rule}>Never under <span className="meta">optional · € a month, gross</span></label>
                <input className="input answer-floor" id={fieldId.rule} type="number" min={0} inputMode="numeric" value={draft.floor} onChange={(e) => set({ floor: e.target.value })} aria-invalid={invalid("rule")} aria-describedby={describedBy("rule")} />
                {errors("rule")}
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor={fieldId.en}>{blankMode ? "If a form requires an answer, in English" : "Answer in English"}</label>
                <textarea className="textarea short" id={fieldId.en} value={draft.en} onChange={(e) => set({ en: e.target.value })} aria-invalid={invalid("en")} aria-describedby={describedBy("en", "ae-en-c")} />
                {errors("en")}
                <span className="count num" id="ae-en-c">{draft.en.length} characters</span>
              </div>
              <div className="field">
                <label htmlFor={fieldId.bg}>{blankMode ? "If a form requires an answer, in Bulgarian" : "Answer in Bulgarian"} <span className="meta">used in Bulgarian packages</span></label>
                <textarea className="textarea short" id={fieldId.bg} lang="bg" value={draft.bg} onChange={(e) => set({ bg: e.target.value })} aria-invalid={invalid("bg")} aria-describedby={describedBy("bg", "ae-bg-c")} />
                {errors("bg")}
                <span className="count num" id="ae-bg-c">{draft.bg.length} characters</span>
              </div>
            </>
          )}

          <fieldset aria-describedby={describedBy("wordings", "ae-ph-help")}>
            <legend>Also matches these wordings</legend>
            <span className="help" id="ae-ph-help">How portals phrase it. The extension and packages use these to find the answer.</span>
            {draft.wordings.length > 0 && (
              <ul className="wordings">
                {draft.wordings.map((w, i) => (
                  <li key={w}>
                    <span lang={languageOf(w) === "bg" ? "bg" : undefined}>{w}</span>
                    <span className="meta">{languageOf(w).toUpperCase()}</span>
                    <button className="btn ghost sm" type="button" onClick={() => removeWording(i)}>Remove<span className="sr-only"> wording {w}</span></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="row">
              <label className="sr-only" htmlFor={fieldId.wordings}>Add a wording</label>
              <input className="input grow" id={fieldId.wordings} placeholder="Add a wording, e.g. When could you start?" value={wording} onChange={(e) => setWording(e.target.value)} onKeyDown={onWordingKey} aria-invalid={invalid("wordings")} lang={wording && languageOf(wording) === "bg" ? "bg" : undefined} autoComplete="off" />
              <button className="btn sm" type="button" onClick={addWording}>Add</button>
            </div>
            {errors("wordings")}
          </fieldset>

          {error && <p className="err" role="alert">{error}</p>}
          <div className="row">
            <button className="btn primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            <a className="btn ghost" href="/profile/answers" onClick={navLink(go)}>Cancel</a>
            <span className="grow" />
            {answer && <button className="btn ghost sm danger" type="button" onClick={() => setConfirming(true)}>Delete answer…</button>}
          </div>
        </form>

        <aside className="col">
          <div className="panel">
            <h2>History</h2>
            {history.length === 0
              ? <p className="mini muted">A new answer. Its changes will show here.</p>
              : <dl className="kv">{history.map((c, i) => <HistoryLine key={i} change={c} />)}</dl>}
          </div>
          <div className="panel">
            <h2>Used</h2>
            <p className="mini muted">
              {answer && answer.useCount > 0
                ? `${answer.useCount} ${answer.useCount === 1 ? "time" : "times"} · last on ${shortDate(answer.lastUsedAt!)}.`
                : "Not used yet."}
              {" "}Saving changes future packages and fills; approved packages keep their answers.
            </p>
          </div>
        </aside>
      </div>
      {confirming && answer && <DeleteDialog answer={answer} onDelete={() => void remove()} onCancel={() => setConfirming(false)} />}
    </section>
  );
}

function HistoryLine({ change }: { change: AnswerChange }) {
  return <><dt>{shortDate(change.at)}</dt><dd lang={change.language === "bg" ? "bg" : undefined}>{changeLine(change)}</dd></>;
}

/** "Delete answer…": says what goes and what stays; focus starts on Cancel, the safe choice. */
function DeleteDialog({ answer, onDelete, onCancel }: { answer: Answer; onDelete: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    cancelRef.current?.focus();
  }, []);
  const done = (fn: () => void) => { ref.current?.close(); fn(); };
  return (
    <dialog ref={ref} className="pass-dialog" aria-labelledby="ad-h" aria-describedby="ad-d" onCancel={(e) => { e.preventDefault(); done(onCancel); }}>
      <div className="stack" style={{ gap: "var(--s-4)" }}>
        <h2 id="ad-h">Delete "{answer.question}"?</h2>
        <p id="ad-d" className="muted mini">
          It leaves your answer bank with its history, so packages and the extension won't use it again. Approved packages keep their answers as they are.
        </p>
        <div className="row">
          <button className="btn danger" type="button" onClick={() => done(onDelete)}>Delete answer</button>
          <button className="btn ghost" type="button" ref={cancelRef} onClick={() => done(onCancel)}>Cancel</button>
        </div>
      </div>
    </dialog>
  );
}
