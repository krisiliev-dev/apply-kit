// Angles (hi-fi: docs/design/hifi/profile.html, state Angles): the three framings tailoring starts
// from, each with its summary line, the pieces that lead (reordered in a dialog), the pieces
// available, how many packages used it, and a thin angle's reason with an offer of the coach.
import type { Angle, AngleProblem, AngleView, ProfilePiece } from "@apply-kit/core";
import { angleRules } from "@apply-kit/core/profile";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAngles, fetchPieces, saveAngle } from "../api.ts";
import { Icon } from "../icons.tsx";
import { message, pieceName, pieceText } from "./common.tsx";

/** Where "Let the coach ask about … work" goes: the coach interview, scoped to the angle (#57). */
export const coachInterviewFor = (angle: Angle) => `/setup/interview?angle=${angle}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function AnglesPage({ announce }: { announce: (msg: string) => void }) {
  const [list, setList] = useState<AngleView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchAngles(ctrl.signal).then(setList).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, []);

  const replace = useCallback((a: AngleView) => setList((l) => l?.map((x) => (x.angle === a.angle ? a : x)) ?? null), []);

  if (error) return <div className="banner error" role="alert"><span className="text"><b>Couldn't load your angles.</b> {error}</span></div>;
  if (!list) return <p className="meta" role="status">Loading your angles…</p>;

  return (
    <>
      <p className="muted measure">
        Each angle is where tailoring starts: a summary line and the pieces that lead. A package picks the closest angle for the job, then tailors from it. Angles also decide which jobs count as yours in the Feed's Fit.
      </p>
      <div className="angles">
        {list.map((a) => <AngleCard key={a.angle} view={a} onSaved={replace} announce={announce} />)}
      </div>
    </>
  );
}

function AngleCard({ view: a, onSaved, announce }: { view: AngleView; onSaved: (a: AngleView) => void; announce: (msg: string) => void }) {
  const [summary, setSummary] = useState(a.summary);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const reorderRef = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const id = `angle-${a.angle}`;
  const changed = summary.trim() !== a.summary;

  const saveSummary = async () => {
    setSaving(true);
    try {
      const r = await saveAngle({ angle: a.angle, summary });
      if (r.saved) {
        setProblem(null);
        setSummary(r.angle.summary);
        onSaved(r.angle);
        announce(`${a.label} summary line saved.`);
      } else {
        setProblem(problemFor(r.problems, "summary"));
        summaryRef.current?.focus();
      }
    } catch (err) {
      setProblem(`Couldn't save: ${message(err)}`);
      summaryRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const closeReorder = (saved?: AngleView) => {
    setReordering(false);
    if (saved) {
      onSaved(saved);
      announce(`${a.label} leads saved. The next ${a.label.toLowerCase()} package starts from them.`);
    }
    window.setTimeout(() => reorderRef.current?.focus(), 0);
  };

  return (
    <article className={`panel angle${a.thin ? " thin" : ""}`} aria-labelledby={`${id}-h`}>
      <div className="sec-head">
        <h2 className="grow" id={`${id}-h`}>{a.label}</h2>
        {a.thin && <span className="chip partly"><Icon name="partly" />Thin</span>}
        <span className="meta">{a.packagesUsed === 0 ? "not used in a package yet" : `used in ${plural(a.packagesUsed, "package", "packages")}`}</span>
      </div>

      <div className="field">
        <label htmlFor={`${id}-s`}>Summary line</label>
        <textarea
          className="textarea" id={`${id}-s`} ref={summaryRef} value={summary} maxLength={angleRules.maxSummaryLength}
          placeholder={`One or two sentences a ${a.label.toLowerCase()} CV opens with.`}
          aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${id}-err` : undefined}
          onChange={(e) => setSummary(e.target.value)}
        />
        {problem && <p className="err" id={`${id}-err`}>{problem}</p>}
        {changed && (
          <div className="row">
            <button className="btn sm primary" type="button" disabled={saving} onClick={() => void saveSummary()}>{saving ? "Saving…" : "Save summary line"}</button>
            <button className="btn sm ghost" type="button" disabled={saving} onClick={() => { setSummary(a.summary); setProblem(null); }}>Cancel</button>
          </div>
        )}
      </div>

      <div className="stack">
        <h3>Leads with</h3>
        {a.leads.length > 0
          ? <ol>{a.leads.map((p) => <li key={p.id}>{pieceText(p)}</li>)}</ol>
          : <p className="meta">No piece leads yet. Give pieces this angle in your master profile.</p>}
      </div>
      <div className="row">
        <button className="btn sm" type="button" ref={reorderRef} disabled={a.available === 0} onClick={() => setReordering(true)}>
          Reorder…<span className="sr-only"> {a.label} leads</span>
        </button>
        <span className="meta">{plural(a.available, "piece", "pieces")} available</span>
      </div>

      {a.thin && (
        <>
          <p className="mini thin-why"><b>{a.thin.reason}</b> {a.label} packages will be thin and ask you more.</p>
          <a className="btn sm" href={coachInterviewFor(a.angle)}>Let the coach ask about {a.label.toLowerCase()} work</a>
        </>
      )}

      {reordering && <ReorderDialog view={a} onClose={closeReorder} announce={announce} />}
    </article>
  );
}

const problemFor = (problems: AngleProblem[], field: AngleProblem["field"]) =>
  problems.filter((p) => p.field === field).map((p) => p.message).join(" ") || problems[0]?.message || "Couldn't save.";

/**
 * "Reorder…": the leads as a list with Move up, Move down and Remove on each, and a piece of the angle
 * to add. Nothing is saved until Save; focus starts on the list's first control and returns to Reorder.
 */
function ReorderDialog({ view: a, onClose, announce }: { view: AngleView; onClose: (saved?: AngleView) => void; announce: (msg: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const [order, setOrder] = useState<ProfilePiece[]>(a.leads);
  const [others, setOthers] = useState<ProfilePiece[] | null>(null);
  const [adding, setAdding] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // After a move, focus stays on the same control of the moved piece.
  const focusNext = useRef<string | null>(null);
  const setFocusNext = (elementId: string | null) => { focusNext.current = elementId; };
  const id = `reorder-${a.angle}`;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    headRef.current?.focus();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchPieces({ angle: a.angle }, ctrl.signal)
      .then((l) => setOthers(l.groups.flatMap((g) => g.pieces).filter((p) => p.status === "confirmed")))
      .catch(() => setOthers([]));
    return () => ctrl.abort();
  }, [a.angle]);

  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  }, [order]);

  const move = (i: number, by: -1 | 1) => {
    const next = [...order];
    const [p] = next.splice(i, 1);
    next.splice(i + by, 0, p!);
    setOrder(next);
    const at = i + by;
    // At the top or bottom the pressed button is disabled, so focus moves to the other direction.
    const dir = (by === -1 && at === 0) || (by === 1 && at === next.length - 1) ? (by === -1 ? "down" : "up") : by === -1 ? "up" : "down";
    setFocusNext(next.length > 1 ? `${id}-${dir}-${p!.id}` : null);
    announce(`${pieceName(p!)} moved to ${at + 1} of ${next.length}.`);
  };

  const remove = (i: number) => {
    const p = order[i]!;
    const next = order.filter((_, k) => k !== i);
    setOrder(next);
    const after = next[i] ?? next[i - 1];
    setFocusNext(after ? `${id}-rm-${after.id}` : `${id}-add`);
    announce(`${pieceName(p)} no longer leads.`);
  };

  const add = () => {
    const p = others?.find((x) => x.id === adding);
    if (!p) return;
    setOrder([...order, p]);
    setAdding("");
    setFocusNext(`${id}-rm-${p.id}`);
    announce(`${pieceName(p)} added, ${order.length + 1} of ${order.length + 1}.`);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await saveAngle({ angle: a.angle, leads: order.map((p) => p.id) });
      if (r.saved) {
        ref.current?.close();
        onClose(r.angle);
        return;
      }
      setProblem(problemFor(r.problems, "leads"));
    } catch (err) {
      setProblem(`Couldn't save: ${message(err)}`);
    } finally {
      setSaving(false);
    }
    window.setTimeout(() => errRef.current?.focus(), 0);
  };

  const cancel = () => { ref.current?.close(); onClose(); };
  const addable = (others ?? []).filter((p) => !order.some((o) => o.id === p.id));

  return (
    <dialog ref={ref} className="pass-dialog reorder" aria-labelledby={`${id}-h`} aria-describedby={`${id}-d`} onCancel={(e) => { e.preventDefault(); cancel(); }}>
      <div className="stack" style={{ gap: "var(--s-5)" }}>
        <div className="stack" style={{ gap: "var(--s-2)" }}>
          <h2 id={`${id}-h`} ref={headRef} tabIndex={-1}>{a.label} leads</h2>
          <p id={`${id}-d`} className="muted mini">The first piece leads. Packages for {a.label.toLowerCase()} jobs start from this order; nothing changes until you save.</p>
        </div>
        {problem && <div className="banner error" role="alert" tabIndex={-1} ref={errRef}><span className="text">{problem}</span></div>}
        {order.length > 0 ? (
          <ol className="lead-order" aria-label={`${a.label} leads, in order`}>
            {order.map((p, i) => (
              <li key={p.id}>
                <span className="num" aria-hidden="true">{i + 1}</span>
                <span className="what">{pieceText(p)}</span>
                <span className="acts">
                  <button className="btn ghost sm" type="button" id={`${id}-up-${p.id}`} disabled={i === 0} onClick={() => move(i, -1)}>
                    Up<span className="sr-only">: {pieceName(p)}</span>
                  </button>
                  <button className="btn ghost sm" type="button" id={`${id}-down-${p.id}`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                    Down<span className="sr-only">: {pieceName(p)}</span>
                  </button>
                  <button className="btn ghost sm" type="button" id={`${id}-rm-${p.id}`} onClick={() => remove(i)}>
                    Remove<span className="sr-only">: {pieceName(p)}</span>
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : <p className="meta">No piece leads. Add one below, or save to lead with none.</p>}
        <div className="field">
          <label htmlFor={`${id}-add`}>Add a piece to the end</label>
          <div className="row">
            <select className="input grow" id={`${id}-add`} value={adding} disabled={!others || addable.length === 0} onChange={(e) => setAdding(e.target.value)}>
              <option value="">{!others ? "Loading pieces…" : addable.length === 0 ? `Every ${a.label.toLowerCase()} piece already leads` : "Choose a piece"}</option>
              {addable.map((p) => <option key={p.id} value={p.id}>{pieceName(p)}</option>)}
            </select>
            <button className="btn sm" type="button" disabled={!adding} onClick={add}>Add</button>
          </div>
        </div>
        <div className="row">
          <button className="btn primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save order"}</button>
          <button className="btn ghost" type="button" onClick={cancel}>Cancel</button>
        </div>
      </div>
    </dialog>
  );
}
