// Setup › Interview (hi-fi: onboarding.html, states "B · Coach interview" and "Interview · model
// timed out"): the coach checks what was imported, asks about gaps and forgotten skills, and collects
// standard answers. The scope shows as chips with progress; the transcript is a polite log; the
// pieces the coach writes appear beside it, each editable or removable, near-the-line ones with their
// own decision (never pre-selected), all confirmed in one list on Finish. Kris's answer is saved
// before it's sent, so a timeout keeps it ("not sent yet"), tries again after a wait and offers
// "Try now"; Your search needs no model. /setup/interview?angle=design is a short session about one angle.
import type { Angle, InterviewChange, InterviewItem, InterviewQuestionKind, InterviewView, ProfilePiece } from "@apply-kit/core";
import { entryLabel } from "@apply-kit/core/profile";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  answerInterview, decideInterviewPiece, dontRemember, editInterviewAnswer, fetchInterview, finishInterview, pauseInterview,
  removeInterviewItem, retryInterview, savePiece, skipQuestion, startInterview,
} from "../api.ts";
import { Icon } from "../icons.tsx";
import { angleLabel, kindLabel, pieceName } from "../profile/common.tsx";
import { message, plural, resetDay, stepPath, Steps, useNavLink, useSetup, usd } from "./common.tsx";

const POLL_MS = 1_000;
const angleNames: readonly Angle[] = ["developer", "security", "design"];

const scopeLabel: Record<InterviewQuestionKind, string> = {
  check: "Check imported", gap: "Gaps in the timeline", skill: "Forgotten skills", standard: "Standard answers",
};
const leftLabel: Record<InterviewQuestionKind, [string, string]> = {
  check: ["piece to check", "pieces to check"], gap: ["gap", "gaps"], skill: ["skill question", "skill questions"], standard: ["standard answer", "standard answers"],
};

/** The angle a session is about, from ?angle=; null for setup's interview. */
const angleFromUrl = (): Angle | null => {
  const a = new URLSearchParams(window.location.search).get("angle");
  return angleNames.includes(a as Angle) ? (a as Angle) : null;
};

/** Where two wordings differ, in whole words: "about a third" against "33%". */
export function differing(a: string, b: string): [string, string] {
  const x = a.split(" ");
  const y = b.split(" ");
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let end = 0;
  while (end < x.length - start && end < y.length - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  return [x.slice(start, x.length - end).join(" ") || a, y.slice(start, y.length - end).join(" ") || b];
}

const pieceLine = (p: ProfilePiece) => (p.entry ? entryLabel(p.entry) : p.text);

export function Interview({ imported }: { imported: number | null }) {
  const { go, announce, refresh } = useSetup();
  const nav = useNavLink();
  const [angle] = useState(angleFromUrl);
  const [view, setView] = useState<InterviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refusalRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const retried = useRef<string | null>(null);

  // Opening the step starts the interview, or resumes it at the same question.
  useEffect(() => {
    startInterview(angle).then(setView).catch((err: unknown) => setError(message(err)));
  }, [angle]);

  // While the coach writes, follow it.
  const writing = view?.status === "writing";
  useEffect(() => {
    if (!writing) return;
    const t = window.setInterval(() => { fetchInterview(angle).then(setView).catch(() => {}); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [writing, angle]);

  // A failed turn is tried again at its time; the countdown isn't announced (only the start and the outcome are).
  const retryAt = view?.status === "failed" ? view.failure?.retryAt ?? null : null;
  useEffect(() => {
    if (!retryAt) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [retryAt]);
  const seconds = retryAt ? Math.max(0, Math.ceil((new Date(retryAt).getTime() - now) / 1_000)) : null;

  // Focus follows a refusal to its reason.
  useEffect(() => { if (refusal) refusalRef.current?.focus(); }, [refusal]);

  const apply = useCallback((r: InterviewChange, said: string | null) => {
    setView(r.interview);
    if (!r.changed) { setRefusal(r.reason); return false; }
    setRefusal(null);
    if (said) announce(said);
    return true;
  }, [announce]);

  const run = async (act: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await act();
    } catch (err) {
      setRefusal(message(err));
    } finally {
      setBusy(false);
    }
  };

  const tryNow = useCallback(() => {
    if (!view) return;
    void run(async () => { apply(await retryInterview(view.id), "Sending again…"); });
  }, [view, apply]);

  useEffect(() => {
    if (seconds === 0 && retryAt && retried.current !== retryAt) {
      retried.current = retryAt;
      tryNow();
    }
  }, [seconds, retryAt, tryNow]);

  if (error) return <div className="banner error" role="alert"><span className="text"><b>Couldn't open the interview.</b> {error}</span></div>;
  if (!view) return <p className="meta" role="status">Loading…</p>;

  const id = view.id;
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) { setRefusal("Type your answer first, or choose \"I don't remember\"."); return; }
    void run(async () => {
      if (apply(await answerInterview(id, text), "Sent. The coach is writing…")) setText("");
      answerRef.current?.focus();
    });
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
  };
  const notRemembered = () => run(async () => { apply(await dontRemember(id), "Noted. The coach moves on."); });
  const skip = () => run(async () => { apply(await skipQuestion(id), "Skipped. It comes back during packages, only if a job needs it."); });
  const back = angle ? "/profile/angles" : "/setup";
  const pause = () => run(async () => {
    await pauseInterview(id);
    announce("Paused. The interview opens at this question next time.");
    if (angle) window.location.assign(back);
    else go(back);
  });

  const pieces = view.items.filter((i) => i.type === "piece");
  const answers = view.items.filter((i) => i.type === "answer");
  const undecided = pieces.filter((i) => i.nearTheLine && !i.decision);
  const finish = () => run(async () => {
    const r = await finishInterview(id);
    setView(r.interview);
    if (!r.finished) { setRefusal(r.reason); return; }
    const said = [
      r.confirmed > 0 ? `${plural(r.confirmed, "piece", "pieces")} confirmed.` : "",
      r.answers > 0 ? `${plural(r.answers, "answer", "answers")} added to the answer bank.` : "",
    ].filter(Boolean).join(" ") || "Interview finished.";
    if (r.refused.length > 0) {
      setRefusal(`${said} ${r.refused.length === 1 ? "One piece needs more before it can be confirmed" : `${r.refused.length} pieces need more before they can be confirmed`}: ${r.refused.flatMap((x) => x.problems.map((p) => p.message)).join(" ")} It waits in Profile, unconfirmed.`);
      return;
    }
    announce(said);
    refresh();
    if (angle) window.location.assign(back);
    else go(stepPath.search);
  });

  const left = (Object.keys(view.left) as InterviewQuestionKind[]).filter((k) => view.left[k] > 0).map((k) => plural(view.left[k], ...leftLabel[k]));
  const asking = view.status === "asking" || view.status === "paused";
  const finishLabel = pieces.length > 0 ? `Finish and confirm ${plural(pieces.length, "piece", "pieces")}` : answers.length > 0 ? `Finish and save ${plural(answers.length, "answer", "answers")}` : "Finish the interview";

  return (
    <div className="stack">
      {angle ? <p className="meta"><a href="/profile/angles">Angles</a> › {angleLabel[angle]}</p> : <Steps current="interview" imported={imported} />}
      <div className="head">
        <h1 id="setup-h" tabIndex={-1}>{angle ? `Interview about your ${angleLabel[angle].toLowerCase()} work` : "Interview with the coach"}</h1>
        <p className="muted">The coach only writes down what you tell it. Short answers are fine, and "I don't remember" is a fine answer too.</p>
      </div>

      {view.status === "failed" && view.failure && (
        <div className="banner error" role="alert">
          <span className="text">
            <b>The coach didn't answer.</b> {view.failure.message} Your answer is saved below and nothing was lost.
            {seconds !== null && seconds > 0 && <> Trying again in <span className="num">{seconds}</span> s.</>}
          </span>
          <button className="btn sm" type="button" onClick={tryNow} disabled={busy}>Try now</button>
        </div>
      )}
      {view.status === "budget" && (
        <div className="banner warning" role="status">
          <span className="text">
            <b>This month's AI budget is used up: {usd(view.budget.spentUsd)} of {usd(view.budget.capUsd)}.</b>{" "}
            Your answer is saved below and nothing was lost. The coach goes on once the budget resets on {resetDay(view.budget.month)}, or once you raise the cap. The app never raises it by itself.
          </span>
          <a className="btn sm" href="/settings">Raise the cap in Settings</a>
          <button className="btn sm" type="button" onClick={tryNow} disabled={busy}>Try now</button>
        </div>
      )}

      {view.scope.length > 0 && (
        <ul className="scope" aria-label="Interview scope">
          {view.scope.map((s) => (
            <li key={s.kind} className={`chip ${s.state === "done" ? "met" : s.state === "current" ? "ask" : "neutral"}`}>
              {s.state === "done" && <Icon name="met" />}
              {s.state === "current" && <Icon name="ask" />}
              {scopeLabel[s.kind]} · {s.state === "next" && s.done === 0 ? plural(s.total, "question", "questions") : `${s.done} of ${s.total}`}
              <span className="sr-only">{s.state === "current" ? ", asking now" : s.state === "done" ? ", done" : ""}</span>
            </li>
          ))}
        </ul>
      )}

      {refusal && <div className="banner warning" role="alert" tabIndex={-1} ref={refusalRef}><span className="text">{refusal}</span></div>}

      <div className="cols">
        <div className="col">
          <div className="panel">
            <ol className="chat" role="log" aria-live="polite" aria-label="Conversation with the coach">
              {view.turns.map((t) => (
                <li key={t.id} className={`msg ${t.who}${t.sent ? "" : " unsent"}`}>
                  <span className="who">{t.who === "coach" ? "Coach" : t.sent ? "You" : "You · not sent yet"}</span>
                  {t.text}
                </li>
              ))}
            </ol>
            {view.status === "writing" && <p className="meta" aria-hidden="true">The coach is writing…</p>}
            {view.status === "complete" && <p className="meta">That's everything the coach wanted to ask. Finish to confirm what it wrote.</p>}
            {asking && view.question && (
              <form className="composer" onSubmit={send}>
                <label htmlFor="interview-answer">Your answer</label>
                <textarea className="textarea" id="interview-answer" ref={answerRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} aria-describedby="interview-answer-help" />
                <span className="help meta" id="interview-answer-help">Enter adds a line; send with the button or Ctrl+Enter.</span>
                <div className="row">
                  <button className="btn primary" type="submit" disabled={busy}>Send</button>
                  <button className="btn" type="button" onClick={notRemembered} disabled={busy}>I don't remember</button>
                  <button className="btn ghost" type="button" onClick={skip} disabled={busy}>Skip this question</button>
                  <span className="grow" />
                  <button className="btn ghost" type="button" onClick={pause} disabled={busy}>Pause, finish later</button>
                </div>
              </form>
            )}
            {(view.status === "failed" || view.status === "budget" || view.status === "writing") && (
              <div className="row">
                <button className="btn ghost" type="button" onClick={pause} disabled={busy}>Pause, finish later</button>
                {!angle && <><a className="btn" href={stepPath.search} onClick={nav}>Go on to Your search</a><span className="meta">That step doesn't need the coach.</span></>}
              </div>
            )}
          </div>
        </div>

        <aside className="col side" aria-label="From this interview">
          <div className="panel">
            <div className="sec-head"><h2 className="grow">From this interview</h2><span className="meta">{plural(view.items.length, "item", "items")}</span></div>
            <p className="meta">Written from your answers. Edit or remove any now; when you finish, you confirm them in one list. A near-the-line one always needs its own OK.</p>
            {view.items.length === 0
              ? <p className="meta">Nothing written yet.</p>
              : <div className="pieces">{view.items.map((i) => <Item key={i.id} item={i} onChange={apply} busy={busy} run={run} reload={() => fetchInterview(angle)} />)}</div>}
          </div>
          <div className="panel stack">
            <button className="btn primary" type="button" onClick={finish} disabled={busy}>{finishLabel}</button>
            {undecided.length > 0 && <p className="meta">{undecided.length === 1 ? "One piece needs your OK first." : `${undecided.length} pieces need your OK first.`}</p>}
            <p className="meta">{left.length > 0 ? `Left: ${left.join(", ")}. ` : ""}Skipped ones come back during packages, only if a job needs them.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Item({ item: i, onChange, busy, run, reload }: {
  item: InterviewItem;
  reload: () => Promise<InterviewView>;
  onChange: (r: InterviewChange, said: string | null) => boolean;
  busy: boolean;
  run: (act: () => Promise<unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const near = i.nearTheLine;
  const p = i.piece;
  const name = p ? `${kindLabel[p.kind].toLowerCase()}: ${pieceName(p)}` : `answer: ${i.answer?.question ?? ""}`;
  const fieldId = `edit-${i.id}`;

  const remove = () => run(async () => {
    onChange(await removeInterviewItem(i.id), i.change === "updated" ? `Removed. The ${name} is back to what it said.` : `Removed the ${name}.`);
  });
  const decide = (choice: "honest" | "stronger") => run(async () => {
    onChange(await decideInterviewPiece(i.id, choice), choice === "honest" ? "Kept your wording." : "Using the stronger wording.");
  });
  const startEdit = () => { setDraft(p ? p.text : i.answer?.text ?? ""); setProblem(null); setEditing(true); };
  const save = () => run(async () => {
    if (p) {
      const r = await savePiece({ id: p.id, kind: p.kind, text: draft, entry: p.entry, belongsTo: p.belongsTo, tags: p.tags, angles: p.angles, numberSource: p.numberSource });
      if (!r.saved) { setProblem(r.problems.map((x) => x.message).join(" ")); return; }
      // Read the interview again so the panel shows the saved text.
      const fresh = await reload().catch(() => null);
      if (fresh) onChange({ changed: true, interview: fresh }, "Saved.");
    } else {
      if (!onChange(await editInterviewAnswer(i.id, draft), "Saved.")) return;
    }
    setEditing(false);
  });

  const [honestPart, strongerPart] = near ? differing(near.honest ?? "", near.stronger) : ["", ""];
  return (
    <div className={`piece${near && !i.decision ? " flagged" : ""}`}>
      <div className="stack">
        <div className="top">
          <span className="type">{p ? kindLabel[p.kind].toUpperCase() : "STANDARD ANSWER"}</span>
          {near && !i.decision
            ? <span className="chip partly"><Icon name="line" />Needs your OK</span>
            : <span className="chip neutral">{i.type === "answer" ? "Answer bank" : i.change === "updated" ? "Updated" : "New"}</span>}
        </div>
        {editing ? (
          <div className="stack">
            <label htmlFor={fieldId} className="sr-only">Edit the {name}</label>
            <textarea className="textarea short" id={fieldId} value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${fieldId}-err` : undefined} />
            {problem && <p className="err-line" id={`${fieldId}-err`} role="alert">{problem}</p>}
            <div className="row">
              <button className="btn sm primary" type="button" onClick={save} disabled={busy}>Save</button>
              <button className="btn ghost sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <p className="text mini">
            {p ? pieceLine(p) : <><b>{i.answer?.question}</b>: {i.answer?.text}</>}
            {i.before && p && <span className="meta"> (was {i.before.entry ? entryLabel(i.before.entry) : i.before.text})</span>}
          </p>
        )}
        {near && (
          <>
            <p className="meta">{near.why}</p>
            <fieldset>
              <legend className="sr-only">Which wording do you keep for the {name}?</legend>
              <div className="row">
                {near.honest && (
                  <button className="btn sm" type="button" aria-pressed={i.decision === "honest"} onClick={() => decide("honest")} disabled={busy}>
                    Keep "{honestPart}"
                  </button>
                )}
                <button className="btn ghost sm" type="button" aria-pressed={i.decision === "stronger"} onClick={() => decide("stronger")} disabled={busy}>
                  Use {near.honest ? strongerPart : "it as written"}
                </button>
              </div>
            </fieldset>
          </>
        )}
      </div>
      <div className="acts">
        {!editing && (p && p.entry
          ? <a className="btn ghost sm" href={`/profile/pieces/${encodeURIComponent(p.id)}`}>Edit<span className="sr-only"> {name}</span></a>
          : <button className="btn ghost sm" type="button" onClick={startEdit}>Edit<span className="sr-only"> {name}</span></button>)}
        <button className="btn ghost sm" type="button" onClick={remove} disabled={busy}>Remove<span className="sr-only"> {name}</span></button>
      </div>
    </div>
  );
}
