// Setup › Check drafts (hi-fi: onboarding.html, state "Check drafts"): the drafted pieces grouped by
// role, filtered (to check, flagged, confirmed, discarded), each confirmed, edited or discarded, and
// "Confirm N unflagged" per role. Pieces whose sources disagree quote each version side by side and
// wait for Kris to pick one, or to leave it to the interview; they're never confirmed in bulk.
// Everything is saved as it happens; the live count says so.
import type { DraftFilter, DraftGroup, DraftsToCheck, ProfilePiece } from "@apply-kit/core";
import { entryLabel } from "@apply-kit/core/profile";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDrafts, confirmPiece, discardPiece, fetchDrafts, resolveDispute, restorePiece, unconfirmPiece } from "../api.ts";
import { ConsolidationPanel } from "../profile/ConsolidationPanel.tsx";
import { Icon } from "../icons.tsx";
import { angleLabel, kindLabel, pieceName } from "../profile/common.tsx";
import { message, plural, stepPath, Steps, useNavLink, useSetup } from "./common.tsx";

/** Pieces shown per role before "Show the next 5 to check". */
const PAGE = 5;
/** Above this many pieces the roles after the first start collapsed. */
const LARGE = 25;

const filterLabel: Record<DraftFilter, string> = { "to-check": "To check", flagged: "Flagged", confirmed: "Confirmed", discarded: "Discarded" };
const filterCount = (d: DraftsToCheck, f: DraftFilter) =>
  f === "to-check" ? d.counts.toCheck : f === "flagged" ? d.counts.flagged : f === "confirmed" ? d.counts.confirmed : d.counts.discarded;

/** A piece confirmed while checking, kept in view under its role with Undo until the filter changes. */
interface Kept { group: DraftGroup; piece: ProfilePiece }

export function CheckDrafts({ imported }: { imported: number | null }) {
  const { announce, refresh, progress } = useSetup();
  const nav = useNavLink();
  const [show, setShow] = useState<DraftFilter>("to-check");
  const [drafts, setDrafts] = useState<DraftsToCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<Kept[]>([]);

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
    load(show);
    refresh();
    announce(said);
  };
  const choose = (f: DraftFilter) => {
    setKept([]);
    setShow(f);
  };

  const c = drafts?.counts;
  // In "To check", pieces confirmed just now stay under their role with Undo.
  const groups = drafts ? withKept(drafts.groups, show === "to-check" ? kept : []) : [];
  const large = (c?.pieces ?? 0) > LARGE;

  return (
    <div className="stack setup-review">
      <Steps current="review" imported={imported} />
      <div className="head">
        <h1 id="setup-h" tabIndex={-1}>Check what was drafted</h1>
        <p className="muted">Confirm what's true, edit what's close, discard what's wrong. Anything you're unsure about can wait: the coach asks about it next.</p>
      </div>
      <ConsolidationPanel onChanged={said => { setKept([]); changed(said); }} />
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

          {groups.length === 0 ? (
            <div className="empty">
              <h2>{show === "to-check" ? "Nothing left to check" : show === "flagged" ? "No flagged pieces" : show === "confirmed" ? "Nothing confirmed yet" : "Nothing discarded"}</h2>
              <p>{show === "to-check" ? (c.pieces === 0 ? "Import old CVs or your LinkedIn export first, or add pieces in Profile." : "Every drafted piece is confirmed or discarded.") : show === "discarded" ? "Pieces you discard wait here, so you can restore one if it was true after all." : "They show here as you check pieces."}</p>
              {c.pieces === 0 && <a className="btn" href={stepPath.import} onClick={nav}>Import files</a>}
            </div>
          ) : (
            groups.map((g, i) => (
              <Group key={`${show}:${g.id}`} group={g} show={show} collapsed={large && i > 0}
                onConfirmed={(piece) => setKept((k) => [...k.filter((x) => x.piece.id !== piece.id), { group: g, piece }])}
                onUndone={(id) => setKept((k) => k.filter((x) => x.piece.id !== id))}
                changed={changed} />
            ))
          )}

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

/** Adds the pieces confirmed just now back under their roles (a role whose pieces are all confirmed keeps its panel). */
function withKept(groups: DraftGroup[], kept: Kept[]): DraftGroup[] {
  const out = groups.map((g) => ({ ...g, pieces: [...g.pieces] }));
  for (const k of kept) {
    let g = out.find((x) => x.id === k.group.id);
    if (!g) {
      g = { ...k.group, pieces: [], toCheck: 0, unflagged: 0 };
      const at = out.findIndex((x) => x.id === "none");
      out.splice(at < 0 ? out.length : at, 0, g);
    }
    if (!g.pieces.some((p) => p.id === k.piece.id)) g.pieces.push(k.piece);
  }
  return out;
}

function Group({ group: g, show, collapsed, onConfirmed, onUndone, changed }: {
  group: DraftGroup;
  show: DraftFilter;
  collapsed: boolean;
  onConfirmed: (p: ProfilePiece) => void;
  onUndone: (id: string) => void;
  changed: (said: string) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const nextRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const shown = g.pieces.slice(0, limit);
  const more = Math.min(PAGE, g.pieces.length - shown.length);
  const flagged = g.toCheck - g.unflagged;
  const where = g.id === "none" ? "not tied to a role" : `from ${g.pieces.find((p) => p.id === g.id)?.entry?.organisation ?? g.label.split(" · ")[1] ?? g.label}`;
  const headingId = `grp-${g.id}`;

  const confirmAll = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const r = await confirmDrafts(g.id);
      const parts = [`${plural(r.confirmed, "piece", "pieces")} ${where} confirmed.`];
      if (r.flagged > 0) parts.push(`The ${plural(r.flagged, "flagged one still waits", "flagged ones still wait")}.`);
      if (r.refused.length > 0) parts.push(r.refused.length === 1 ? "1 piece needs more before it can be confirmed: use Edit." : `${r.refused.length} pieces need more before they can be confirmed: use Edit.`);
      changed(parts.join(" "));
    } catch (err) {
      setFailure(message(err));
      window.setTimeout(() => failureRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };
  const showMore = () => {
    setLimit(limit + PAGE);
    // Focus lands on the first piece that was hidden, so the keyboard path continues where it was.
    window.setTimeout(() => nextRef.current?.focus(), 0);
  };

  const body = (
    <>
      {show === "to-check" && flagged > 0 && <p className="meta">Flagged pieces are never confirmed in bulk.</p>}
      {failure && <div className="banner error" role="alert" tabIndex={-1} ref={failureRef}><span className="text"><b>That didn't work.</b> {failure}</span></div>}
      <div className="pieces">
        {shown.map((p, i) => (
          <DraftCard key={p.id} piece={p} show={show} focusRef={i === limit - PAGE && limit > PAGE ? nextRef : undefined}
            onConfirmed={onConfirmed} onUndone={onUndone} changed={changed} />
        ))}
      </div>
      {more > 0 && (
        <button className="btn ghost sm show-more" type="button" onClick={showMore}>
          Show the next {more}{show === "to-check" ? " to check" : ""}<span className="sr-only"> {where}</span>
        </button>
      )}
    </>
  );
  const bulk = show === "to-check" && g.unflagged > 0 && (
    <button className="btn sm" type="button" disabled={busy} onClick={confirmAll}>
      {flagged > 0 ? `Confirm ${g.unflagged} unflagged` : `Confirm ${g.unflagged}`}<span className="sr-only"> {where}</span>
    </button>
  );
  const count = show === "to-check" ? `· ${g.toCheck} to check` : `· ${plural(g.pieces.length, "piece", "pieces")}`;

  if (collapsed) {
    return (
      <details className="panel group draft-group">
        <summary>
          <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <h2>{g.label} <span className="meta">{count}</span></h2>
        </summary>
        {bulk && <div className="row">{bulk}</div>}
        {body}
      </details>
    );
  }
  return (
    <section className="panel draft-group" aria-labelledby={headingId}>
      <div className="sec-head">
        <h2 className="grow" id={headingId}>{g.label} <span className="meta">{count}</span></h2>
        {bulk}
      </div>
      {body}
    </section>
  );
}

const versionText = (v: { text: string; entry: ProfilePiece["entry"] }) => (v.entry ? entryLabel(v.entry) : v.text);

function DraftCard({ piece: p, show, focusRef, onConfirmed, onUndone, changed }: {
  piece: ProfilePiece;
  show: DraftFilter;
  focusRef?: React.Ref<HTMLDivElement>;
  onConfirmed: (p: ProfilePiece) => void;
  onUndone: (id: string) => void;
  changed: (said: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const refusalRef = useRef<HTMLDivElement>(null);
  const name = `${kindLabel[p.kind].toLowerCase()}: ${pieceName(p).replace(/\.$/, "")}`;
  const dispute = p.dispute;
  const confirmed = p.status === "confirmed";
  // Focus follows a refusal to its reason.
  useEffect(() => { if (refusal) refusalRef.current?.focus(); }, [refusal]);

  const run = async (act: () => Promise<string | null>) => {
    setBusy(true);
    setRefusal(null);
    try {
      const said = await act();
      if (said) changed(said);
    } catch (err) {
      setRefusal([message(err)]);
    } finally {
      setBusy(false);
    }
  };
  const confirm = () => run(async () => {
    const r = await confirmPiece(p.id);
    if (!r.saved) { setRefusal(r.problems.map((x) => x.message)); return null; }
    onConfirmed(r.piece);
    return `Confirmed ${name}.`;
  });
  const undo = () => run(async () => { await unconfirmPiece(p.id); onUndone(p.id); return `${name} waits to be checked again.`; });
  const discard = () => run(async () => { await discardPiece(p.id); return `Discarded ${name}. Restore it from Discarded if it was true.`; });
  const restore = () => run(async () => { await restorePiece(p.id); return `Restored ${name}.`; });
  const decide = () => {
    if (pick === null) return setMissing(true);
    setMissing(false);
    void run(async () => {
      const r = await resolveDispute(p.id, pick === "coach" ? { askCoach: true } : { version: Number(pick) });
      if (!r.saved) { setRefusal(r.problems.map((x) => x.message)); return null; }
      return pick === "coach" ? `The coach will ask about ${name}.` : `Kept "${versionText(dispute!.versions[Number(pick)]!).replace(/\.$/, "")}". Confirm it when you're ready.`;
    });
  };

  const status = confirmed ? "confirmed" : p.status === "flagged" ? "flagged" : show === "discarded" ? "" : "unconfirmed";
  const sources = dispute ? dispute.versions.map((v) => v.from).join(" · ") : [p.source.from, ...new Set(p.alsoFrom.map((s) => s.from))].join(" and ") + (p.alsoFrom.length > 0 ? " agree" : "");

  return (
    <div className={`piece ${status}`} ref={focusRef} tabIndex={focusRef ? -1 : undefined}>
      <div className="stack">
        <div className="top">
          <span className="type">{kindLabel[p.kind].toUpperCase()}</span>
          {dispute && <span className="chip partly"><Icon name="line" />Sources disagree</span>}
          {confirmed && show === "to-check" && <span className="chip met"><Icon name="met" />Confirmed</span>}
          {show === "discarded" && <span className="chip neutral">Discarded</span>}
          {p.checkThis && <span className="chip partly"><Icon name="partly" />Check this: read from a scan</span>}
          <span>{sources}</span>
        </div>
        <p className="text">{p.entry ? entryLabel(p.entry) : p.text}</p>
        {!dispute && !confirmed && !p.entry && p.source.quote && p.source.quote !== p.text && <p className="mini muted">From the source: <q>{p.source.quote}</q></p>}
        {(p.tags.length > 0 || p.angles.length > 0) && (
          <div className="chips">
            {p.tags.map((t) => <span className="chip neutral" key={t}>{t}</span>)}
            {p.angles.map((a) => <span className="chip met" key={a}>{angleLabel[a]}</span>)}
          </div>
        )}
        {dispute && show !== "discarded" && (
          <>
            <div className="src">
              {dispute.versions.map((v, i) => <span key={i}>{v.from}: <q>{v.quote ?? versionText(v)}</q></span>)}
              <span className="where">{dispute.askCoach ? "The coach will ask which is true. You can still pick now." : "The coach will ask which is true, unless you pick now."}</span>
            </div>
            <fieldset className="dispute">
              <legend>Which is true?<span className="sr-only"> {name}</span></legend>
              <div className="row">
                {/* Never pre-selected: Kris decides. */}
                {dispute.versions.map((v, i) => (
                  <label className="opt" key={i}>
                    <input type="radio" name={`dis-${p.id}`} value={String(i)} checked={pick === String(i)} onChange={() => { setPick(String(i)); setMissing(false); }} />
                    <span>{versionText(v)}<span className="meta">{v.from}</span></span>
                  </label>
                ))}
                {!dispute.askCoach && (
                  <label className="opt">
                    <input type="radio" name={`dis-${p.id}`} value="coach" checked={pick === "coach"} onChange={() => { setPick("coach"); setMissing(false); }} />
                    <span>Ask me in the interview</span>
                  </label>
                )}
              </div>
            </fieldset>
            {missing && <p className="err-line" role="alert">Pick which is true first, or leave it to the interview.</p>}
          </>
        )}
        {refusal && (
          <div className="banner warning" role="alert" tabIndex={-1} ref={refusalRef}>
            <span className="text"><b>Can't do that yet.</b> {refusal.join(" ")} Use Edit to add it.</span>
          </div>
        )}
      </div>
      <div className="acts">
        {show === "discarded" ? (
          <button className="btn sm" type="button" disabled={busy} onClick={restore}>Restore<span className="sr-only"> {name}</span></button>
        ) : confirmed ? (
          <button className="btn ghost sm" type="button" disabled={busy} onClick={undo}>Undo<span className="sr-only"> confirming {name}</span></button>
        ) : (
          <>
            {dispute
              ? <button className="btn sm" type="button" disabled={busy} onClick={decide}>Save choice<span className="sr-only"> for {name}</span></button>
              : <button className="btn sm" type="button" disabled={busy} onClick={confirm}>Confirm<span className="sr-only"> {name}</span></button>}
            {!dispute && <a className="btn ghost sm" href={`/profile/pieces/${encodeURIComponent(p.id)}`}>Edit<span className="sr-only"> {name}</span></a>}
            <button className="btn ghost sm" type="button" disabled={busy} onClick={discard}>Discard<span className="sr-only"> {name}</span></button>
          </>
        )}
      </div>
    </div>
  );
}
