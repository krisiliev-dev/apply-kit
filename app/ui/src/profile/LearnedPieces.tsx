// Profile › Learned during packages (hi-fi: docs/design/hifi/profile.html, state "Learned pieces to
// confirm", ticket #64): pieces written from Kris's answers inside packages, each quoting the
// question and her original answer, used only in that package until she confirms them. Confirm,
// Edit or Discard (discarding never changes a package); a near-the-line one comes with a suggested
// honest version and is never confirmed in bulk.
import type { LearnedPiece } from "@apply-kit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmLearned, confirmPiece, discardPiece, fetchLearned, keepHonestVersion } from "../api.ts";
import { Icon } from "../icons.tsx";
import { angleLabel, kindLabel, message, navLink, pieceName, type Go } from "./common.tsx";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function LearnedPieces({ go, announce, onChanged }: { go: Go; announce: (msg: string) => void; onChanged: () => void }) {
  const [list, setList] = useState<LearnedPiece[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLearned(ctrl.signal).then((l) => { setList(l); setError(null); }).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, [version]);

  /** Something changed: read the list again, update the counts, say what happened and keep focus on the list. */
  const changed = useCallback((said: string) => {
    setVersion((v) => v + 1);
    onChanged();
    announce(said);
    window.setTimeout(() => heading.current?.focus(), 0);
  }, [onChanged, announce]);

  if (error) return <div className="banner error" role="alert"><span className="text"><b>Couldn't load the learned pieces.</b> {error}</span></div>;
  if (!list) return <p className="meta" role="status">Loading the learned pieces…</p>;

  const unflagged = list.filter((l) => !l.nearTheLine).length;
  async function confirmAll() {
    setBusy(true);
    try {
      const r = await confirmLearned();
      const refused = r.refused.length ? ` ${r.refused.length} need more first: ${r.refused.map((x) => x.message).join(" ")}` : "";
      changed(`Confirmed ${r.confirmed} ${r.confirmed === 1 ? "piece" : "pieces"}. They can now be used in every package.${refused}`);
    } catch (err) {
      announce(`Couldn't confirm: ${message(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="learned-h">
      <div className="sec-head">
        <h2 className="grow" id="learned-h" ref={heading} tabIndex={-1}>Learned during packages <span className="meta">· {list.length} waiting</span></h2>
        <a className="btn ghost sm" href="/profile" onClick={navLink(go)}>Back to all pieces</a>
      </div>
      <p className="muted mini">When a package asked you something your profile didn't have, your answer became a piece here. It was used only for that job. Confirm it to use it everywhere.</p>
      {list.length === 0 ? (
        <p className="meta">Nothing is waiting. Answers you give inside packages wait here until you confirm them.</p>
      ) : (
        <>
          <div className="pieces">
            {list.map((l) => <Learned key={l.piece.id} learned={l} go={go} changed={changed} />)}
          </div>
          {unflagged > 0 && (
            <div className="row">
              <button className="btn" type="button" disabled={busy} onClick={() => void confirmAll()}>Confirm the {unflagged} unflagged</button>
              <span className="meta">A near-the-line piece always needs its own decision.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Learned({ learned: l, go, changed }: { learned: LearnedPiece; go: Go; changed: (said: string) => void }) {
  const p = l.piece;
  const near = l.nearTheLine;
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<"honest" | "leave-out" | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalRef = useRef<HTMLDivElement>(null);
  const name = `${kindLabel[p.kind].toLowerCase()}: ${pieceName(p)}`;
  useEffect(() => { if (refusal) refusalRef.current?.focus(); }, [refusal]);

  async function act(run: () => Promise<string | null>) {
    setBusy(true);
    try {
      const said = await run();
      if (said) changed(said);
    } catch (err) {
      setRefusal(message(err));
    } finally {
      setBusy(false);
    }
  }
  const confirm = () => act(async () => {
    const r = await confirmPiece(p.id);
    if (r.saved) return `Confirmed ${name}. It can now be used in every package.`;
    setRefusal(r.problems.map((x) => x.message).join(" "));
    return null;
  });
  const discard = () => act(async () => {
    await discardPiece(p.id);
    return `Discarded ${name}. The ${l.company} package isn't changed.`;
  });
  const save = () => act(async () => {
    if (choice === "leave-out") {
      await discardPiece(p.id);
      return `Left out ${name}. The ${l.company} package isn't changed.`;
    }
    const r = await keepHonestVersion(p.id);
    if (r.saved) return `Stored as "${r.piece.text}" and confirmed.`;
    setRefusal(r.problems.map((x) => x.message).join(" "));
    return null;
  });

  const id = `learned-${p.id.replace(/[^a-z0-9-]/gi, "")}`;
  return (
    <div className={`piece ${near ? "flagged" : "unconfirmed"}`}>
      <div className="stack">
        <div className="top">
          <span className="type">{kindLabel[p.kind].toUpperCase()}{l.under ? ` · ${l.under.toUpperCase()}` : ""}</span>
          {near
            ? <span className="chip partly"><Icon name="line" />Near the line</span>
            : <span className="chip ask"><Icon name="ask" />Unconfirmed</span>}
          <span>From the {l.company} package · {day(l.learnedAt)}</span>
        </div>
        <p className="text">{p.text}</p>
        <div className="src">
          <span>Asked: <q>{l.question}</q></span>
          <span>You answered: <q>{l.answer}</q></span>
          {!near && <span className="where">Check the rewrite didn't stretch your answer.</span>}
        </div>
        {(p.tags.length > 0 || p.angles.length > 0) && (
          <div className="chips">
            {p.tags.map((t) => <span className="chip neutral" key={t}>{t}</span>)}
            {p.angles.map((a) => <span className="chip met" key={a}>{angleLabel[a]}</span>)}
          </div>
        )}
        {near && (
          <>
            <p className="mini muted">{near.why}</p>
            <fieldset className="choices" disabled={busy}>
              <legend id={`${id}-legend`}>How should it be stored?</legend>
              {near.honest && (
                <label className="opt">
                  <input type="radio" name={id} checked={choice === "honest"} onChange={() => setChoice("honest")} />
                  <span><b>"{near.honest}"</b><span className="meta">Keeps to what you said. Holds up to any question.</span></span>
                </label>
              )}
              <label className="opt">
                <input type="radio" name={id} checked={choice === "leave-out"} onChange={() => setChoice("leave-out")} />
                <span><b>Leave it out</b><span className="meta">Discarded. The {l.company} package isn't changed.</span></span>
              </label>
            </fieldset>
            <p className="meta">"{near.stronger}" isn't offered: it says more than your answer did.</p>
          </>
        )}
        {refusal && (
          <div className="banner warning" role="alert" tabIndex={-1} ref={refusalRef}>
            <span className="text"><b>Can't confirm yet.</b> {refusal} Use Edit to add it.</span>
          </div>
        )}
      </div>
      <div className="acts">
        {near ? (
          <button className="btn sm" type="button" disabled={busy || !choice} aria-describedby={choice ? undefined : `${id}-legend`} onClick={() => void save()}>
            Save choice<span className="sr-only"> for {name}</span>
          </button>
        ) : (
          <>
            <button className="btn sm" type="button" disabled={busy} onClick={() => void confirm()}>Confirm<span className="sr-only"> {name}</span></button>
            <a className="btn ghost sm" href={`/profile/pieces/${encodeURIComponent(p.id)}`} onClick={navLink(go)}>Edit<span className="sr-only"> {name}</span></a>
          </>
        )}
        <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void discard()}>Discard<span className="sr-only"> {name}</span></button>
      </div>
    </div>
  );
}
