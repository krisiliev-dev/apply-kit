import { useEffect, useState } from "react";
import type { ConsolidationPreview, ProfilePiece } from "@apply-kit/core";
import { analyseProfile, applyProfileConsolidation, fetchProfileConsolidation, undoProfileConsolidation } from "../api.ts";
import { entryLabel } from "@apply-kit/core/profile";

const label = (p: ProfilePiece) => p.entry ? entryLabel(p.entry) : p.text;

export function ConsolidationPanel({ onChanged }: { onChanged: (message: string) => void }) {
  const [preview, setPreview] = useState<ConsolidationPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accept = (p: ConsolidationPreview | null) => { setPreview(p); setSelected(p?.groups.filter(g => !g.blockedReason).map(g => g.id) ?? []); };
  useEffect(() => { let live = true; fetchProfileConsolidation().then(p => { if (live) accept(p); }).catch(() => {}); return () => { live = false; }; }, []);
  const analyse = async () => {
    setBusy(true); setError("");
    try { accept(await analyseProfile()); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't analyse the profile."); }
    finally { setBusy(false); }
  };
  const mutate = async (undo: boolean) => {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const p = await (undo ? undoProfileConsolidation(preview.id) : applyProfileConsolidation(preview.id, selected));
      accept(p); onChanged(undo ? "Consolidation undone. Original pieces restored." : `Consolidated ${p.before} pieces into ${p.after}. Sources preserved; nothing confirmed automatically.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update the profile."); }
    finally { setBusy(false); }
  };
  const toggle = (id: string, checked: boolean) => setSelected(old => checked ? [...old, id] : old.filter(key => key !== id && !preview?.groups.find(g => g.id === key)?.requires.includes(id)));
  const reduction = preview?.groups.filter(g => selected.includes(g.id)).reduce((n, g) => n + g.others.length, 0) ?? 0;
  const eligible = preview?.groups.filter(g => !g.blockedReason) ?? [];
  const blocked = preview?.groups.filter(g => g.blockedReason) ?? [];
  return <section className="panel stack" aria-label="Consolidate imported pieces">
    <div className="row"><div className="grow"><h2>Consolidate imported pieces</h2><p className="muted">Compare overlapping CVs, LinkedIn and GitHub imports together. Review likely duplicates before merging; every source is retained.</p></div>
      <button className="btn" type="button" disabled={busy} onClick={() => void analyse()}>{busy ? "Working…" : preview ? "Analyse again" : "Find duplicates with AI"}</button></div>
    <p className="meta">Uses your configured AI provider and monthly budget. Analysis changes no pieces. Undo is available until another analysis or a profile edit.</p>
    {busy && <p role="status">Comparing the profile. This can take a minute; your pieces remain saved.</p>}
    {error && <p className="banner error" role="alert">{error}</p>}
    {preview?.status === "preview" && <>
      <p role="status"><b>{preview.before} → {preview.before - reduction} pieces</b> with the selected matches · {reduction} fewer pieces to review · {eligible.length} merge groups</p>
      {eligible.length === 0 && <p>No high-confidence merges found. Your pieces are unchanged.</p>}
      {eligible.map(g => <div className="stack" key={g.id}>
        <label className="row"><input type="checkbox" checked={selected.includes(g.id)} disabled={busy} onChange={e => toggle(g.id, e.target.checked)} /><span><b>{label(g.keep)}</b> · {g.others.length + 1} versions</span></label>
        <p className="meta">{g.reason}{g.requires.length > 0 ? " Also select the matching role group." : ""}</p>
        <details><summary>Compare original versions and sources</summary><ul>{[g.keep, ...g.others].map((p, i) => <li key={p.id}><p><b>{i === 0 ? "Keep" : "Merge into it"}:</b> {label(p)}</p>{p.entry && p.text && <p>{p.text}</p>}<p className="meta">{p.source.from} · {p.status}{p.belongsTo ? " · role-linked" : ""}</p>{p.source.quote && <blockquote>{p.source.quote}</blockquote>}{p.alsoFrom.map((s, j) => <p className="meta" key={j}>Also: {s.from}{s.quote ? ` — ${s.quote}` : ""}</p>)}</li>)}</ul></details>
      </div>)}
      {blocked.length > 0 && <details><summary>{blocked.length} other possible matches need review and will stay separate</summary>{blocked.map(g => <div key={g.id}><p><b>{label(g.keep)}</b> — {g.blockedReason}</p><ul>{g.others.map(p => <li key={p.id}>{label(p)} · {p.source.from}</li>)}</ul></div>)}</details>}
      <div className="row"><button className="btn primary" type="button" disabled={busy || reduction === 0} onClick={() => void mutate(false)}>Merge selected · {reduction} fewer pieces</button><span className="meta">Keeps the wording shown above; no AI rewriting or automatic confirmation.</span></div>
    </>}
    {preview?.status === "applied" && <div className="row"><p className="grow" role="status"><b>{preview.before} → {preview.after} pieces.</b> Original versions and sources are retained. Review the remaining pieces below.</p><button className="btn" disabled={busy} onClick={() => void mutate(true)}>Undo consolidation</button></div>}
    {preview?.status === "undone" && <p role="status">Consolidation undone. The original pieces are back.</p>}
  </section>;
}
