// Setup › Check drafts (hi-fi: onboarding.html, state "Check drafts"): the drafted pieces grouped by
// role, filtered (to check, flagged, confirmed, discarded), each confirmed, edited or discarded, and
// "Confirm N unflagged" per role. Pieces whose sources disagree quote each version side by side and
// wait for Kris to pick one, or to leave it to the interview; they're never confirmed in bulk.
// Everything is saved as it happens; the live count says so.
import type { DraftFilter, DraftsToCheck } from "@apply-kit/core";
import { useCallback, useEffect, useState } from "react";
import { fetchDrafts } from "../api.ts";
import { CareerTimeline } from "../profile/CareerTimeline.tsx";
import { ConsolidationPanel } from "../profile/ConsolidationPanel.tsx";
import { DraftCard } from "../profile/DraftReviewCard.tsx";
import { message, plural, stepPath, Steps, useNavLink, useSetup } from "./common.tsx";

const filterLabel: Record<DraftFilter, string> = { "to-check": "To check", flagged: "Flagged", confirmed: "Confirmed", discarded: "Discarded" };
const filterCount = (d: DraftsToCheck, f: DraftFilter) =>
  f === "to-check" ? d.counts.toCheck : f === "flagged" ? d.counts.flagged : f === "confirmed" ? d.counts.confirmed : d.counts.discarded;

export function CheckDrafts({ imported }: { imported: number | null }) {
  const { announce, refresh, progress } = useSetup();
  const nav = useNavLink();
  const [show, setShow] = useState<DraftFilter>("to-check");
  const [drafts, setDrafts] = useState<DraftsToCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [careerVersion,setCareerVersion]=useState(0);

  const load = useCallback((filter: DraftFilter, signal?: AbortSignal) => {
    fetchDrafts(filter, signal).then((d) => { setDrafts(d); setError(null); }).catch((err: unknown) => { if (!signal?.aborted) setError(message(err)); });
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    load(show, ctrl.signal);
    return () => ctrl.abort();
  }, [show, load]);

  /** Something changed: read the list and the counts again, and say what happened once. */
  const changed = (said: string) => {
    setCareerVersion(v=>v+1);
    load(show);
    refresh();
    announce(said);
  };
  const choose = (f: DraftFilter) => {
    setShow(f);
  };

  const c = drafts?.counts;
  const groups = drafts?.groups ?? [];

  return (
    <div className="stack setup-review">
      <Steps current="review" imported={imported} />
      <div className="head">
        <h1 id="setup-h" tabIndex={-1}>Check what was drafted</h1>
        <p className="muted">Confirm what's true, edit what's close, discard what's wrong. Anything you're unsure about can wait: the coach asks about it next.</p>
      </div>
      <details className="panel"><summary>Find duplicate achievements and skills with AI</summary><ConsolidationPanel key={careerVersion} onChanged={changed} /></details>
      {error && <div className="banner error" role="alert"><span className="text"><b>Couldn't load the pieces.</b> {error}</span></div>}
      {drafts && c && (
        <>
          <div className="row">
            <div className="segmented" role="group" aria-label="Show">
              {(["to-check", "flagged", "confirmed", "discarded"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={show === f} onClick={() => choose(f)}>
                  {filterLabel[f]} <span className="num">{filterCount(drafts, f)}</span>
                </button>
              ))}
            </div>
            <span className="grow" />
            <span className="meta num">{c.confirmed} of {c.pieces} confirmed · saved automatically</span>
          </div>

          {show!=="discarded" ? <CareerTimeline version={careerVersion} show={show} onChanged={changed}/> : groups.length === 0 ? (
            <div className="empty"><h2>Nothing discarded</h2><p>Pieces you discard wait here, so you can restore one if it was true after all.</p></div>
          ) : groups.map(g=><details className="panel" key={g.id}><summary>{g.label} · {g.pieces.length} discarded</summary><div className="pieces">{g.pieces.map(p=><DraftCard key={p.id} piece={p} show="discarded" onConfirmed={()=>{}} onUndone={()=>{}} changed={changed}/>)}</div></details>)}

          <div className="row">
            <a className="btn primary" href={stepPath.interview} onClick={nav}>Continue to the interview</a>
            <span className="meta">
              {c.toCheck > 0 ? `${plural(c.toCheck, "unchecked piece goes", "unchecked pieces go")} with you; the coach covers them first.` : "Every piece is checked."}
            </span>
          </div>
          {progress && progress.counts.pieces > 0 && c.toCheck > 0 && <p className="meta">You can stop at any time: Setup opens here again, with everything you've checked.</p>}
        </>
      )}
      {!drafts && !error && <p className="meta" role="status">Loading…</p>}
    </div>
  );
}
