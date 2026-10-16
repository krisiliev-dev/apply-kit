import type { DraftFilter, ProfilePiece } from "@apply-kit/core";
import { entryLabel } from "@apply-kit/core/profile";
import { useEffect, useRef, useState } from "react";
import { confirmPiece, discardPiece, resolveDispute, restorePiece, unconfirmPiece } from "../api.ts";
import { Icon } from "../icons.tsx";
import { angleLabel, kindLabel, pieceName, message } from "./common.tsx";

const versionText = (v: { text: string; entry: ProfilePiece["entry"] }) => (v.entry ? entryLabel(v.entry) : v.text);

export function DraftCard({ piece: p, show, focusRef, onConfirmed, onUndone, changed }: {
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
