// Add piece and Edit piece (hi-fi: profile.html, "Edit piece · honesty check"). Labels above fields,
// help under labels, errors under fields with an error summary that links to each one. A number beyond
// its source is refused with one-click honest fixes; a piece with a number says where it comes from.
import type { Angle, NumberSource, PieceField, PieceGroup, PieceKind, PieceProblem, ProfilePiece } from "@apply-kit/core";
import { angles, maxAchievementLength, numberSources, pieceKinds } from "@apply-kit/core";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { deletePiece, fetchPiece, fetchPieces, savePiece } from "../api.ts";
import { angleLabel, kindLabel, message, navLink, pieceName, type Go } from "./common.tsx";

interface Draft {
  kind: PieceKind;
  text: string;
  title: string;
  organisation: string;
  city: string;
  start: string;
  end: string;
  belongsTo: string;
  tags: string[];
  angles: Angle[];
  numberSource: NumberSource | null;
}

const blank = (kind: PieceKind): Draft => ({
  kind, text: "", title: "", organisation: "", city: "", start: "", end: "", belongsTo: "", tags: [], angles: [], numberSource: null,
});

const draftOf = (p: ProfilePiece): Draft => ({
  kind: p.kind, text: p.text, title: p.entry?.title ?? "", organisation: p.entry?.organisation ?? "", city: p.entry?.city ?? "",
  start: p.entry?.start ?? "", end: p.entry?.end ?? "", belongsTo: p.belongsTo ?? "", tags: p.tags, angles: p.angles, numberSource: p.numberSource,
});

const numberChoices: Record<NumberSource, string> = {
  measured: "Measured (dashboard, report)",
  estimate: "An estimate I'd defend",
  told: "Someone told me (lead, review)",
};

/** The id of the field each problem points at, so the summary's links and aria-describedby agree. */
const fieldId: Record<PieceField, string> = {
  kind: "pe-kind", text: "pe-text", title: "pe-title", organisation: "pe-org", start: "pe-start", end: "pe-end",
  belongsTo: "pe-belongs", numberSource: "pe-number",
};

/** The summary names the problem in a few words; the full sentence sits under the field. */
const summaryLine = (p: PieceProblem) =>
  p.fixes.length > 0 ? "The number goes beyond your source" : p.field === "numberSource" ? "Say where the number comes from" : p.message;

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; piece: ProfilePiece | null; heads: PieceGroup[] };

export function PieceEditor({ id, go, announce, onSaved }: {
  /** The piece to edit, or null to add one. */
  id: string | null;
  go: Go;
  announce: (msg: string) => void;
  /** After a save or delete, with what to say on the master profile. */
  onSaved: (said: string) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [draft, setDraft] = useState<Draft>(() => blank(kindFromUrl()));
  const [problems, setProblems] = useState<PieceProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagText, setTagText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([id ? fetchPiece(id, ctrl.signal) : Promise.resolve(null), fetchPieces({}, ctrl.signal)])
      .then(([piece, list]) => {
        const heads = list.groups.filter((g) => g.id !== "none");
        // A new piece starts under the most recent role.
        setDraft((d) => (piece ? draftOf(piece) : { ...d, belongsTo: heads[0]?.id ?? "" }));
        setLoad({ state: "ready", piece, heads });
        window.setTimeout(() => headingRef.current?.focus(), 0);
      })
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setLoad({ state: "error", message: message(err) }); });
    return () => ctrl.abort();
  }, [id]);

  if (load.state === "loading") return <p className="meta" role="status">Loading the piece…</p>;
  if (load.state === "error") {
    return (
      <div className="stack">
        <div className="banner error" role="alert"><span className="text"><b>Couldn't load the piece.</b> {load.message}</span></div>
        <a className="btn" href="/profile" onClick={navLink(go)}>Back to Profile</a>
      </div>
    );
  }

  const { piece } = load;
  const heads = load.heads.filter((g) => g.id !== piece?.id);
  const hasEntry = draft.kind === "role" || draft.kind === "education";
  const role = draft.kind === "role";
  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setError(null); };
  const problemsOf = (f: PieceField) => problems.filter((p) => p.field === f);
  const describedBy = (f: PieceField, ...more: string[]) => [...more, ...(problemsOf(f).length ? [`${fieldId[f]}-err`] : [])].join(" ") || undefined;
  const invalid = (f: PieceField) => (problemsOf(f).length ? true : undefined);
  const errors = (f: PieceField) => problemsOf(f).length > 0 && (
    <span className="err" id={`${fieldId[f]}-err`}>{problemsOf(f).map((p) => p.message).join(" ")}</span>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await savePiece({
        ...(piece && { id: piece.id }),
        kind: draft.kind,
        text: draft.text,
        entry: hasEntry ? { title: draft.title, organisation: draft.organisation, city: draft.city || null, start: draft.start, end: draft.end || null } : null,
        belongsTo: hasEntry ? null : draft.belongsTo || null,
        tags: tagText.trim() ? [...draft.tags, tagText.trim()] : draft.tags,
        angles: draft.angles,
        numberSource: draft.numberSource,
      });
      if (!result.saved) {
        setProblems(result.problems);
        window.setTimeout(() => summaryRef.current?.focus(), 0);
        return;
      }
      onSaved(piece ? `Saved. Future packages use the new wording; approved and submitted ones keep their files.` : `Added to your master profile.`);
    } catch (err) {
      setError(`Couldn't save: ${message(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function applyFix(text: string, label: string) {
    set({ text });
    setProblems(problems.filter((p) => p.fixes.length === 0));
    document.getElementById("pe-text")?.focus();
    announce(`${label}: done. Save when you're ready.`);
  }

  function addTag(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const t = tagText.trim().replace(/,$/, "");
      if (t && !draft.tags.some((x) => x.toLowerCase() === t.toLowerCase())) set({ tags: [...draft.tags, t] });
      setTagText("");
    } else if (e.key === "Backspace" && !tagText && draft.tags.length) {
      set({ tags: draft.tags.slice(0, -1) });
    }
  }

  function removeTag(t: string) {
    set({ tags: draft.tags.filter((x) => x !== t) });
    announce(`Tag ${t} removed.`);
    document.getElementById("pe-tags")?.focus();
  }

  async function remove() {
    if (!piece) return;
    try {
      const { untied } = await deletePiece(piece.id);
      setConfirming(false);
      onSaved(`Deleted.${untied ? ` ${untied === 1 ? "1 piece" : `${untied} pieces`} under it now belong to no role.` : ""} Approved and submitted packages keep their files.`);
    } catch (err) {
      setConfirming(false);
      setError(`Couldn't delete: ${message(err)}`);
    }
  }

  const title = piece ? "Edit piece" : "Add piece";
  const textLabel = draft.kind === "achievement" ? "What you did" : draft.kind === "skill" ? "Skill" : "Description";
  const textHelp = draft.kind === "achievement" ? "Start with a verb and say what changed because of you. One sentence."
    : draft.kind === "skill" ? "A skill you could talk about for 5 minutes, or a language with its level."
    : "Optional. What the role or course was about, in a sentence or two.";
  const under = piece ? heads.find((g) => g.id === piece.id) : undefined;

  return (
    <section className="stack" style={{ gap: "var(--s-6)" }} aria-labelledby="pe-h">
      <nav className="crumbs" aria-label="Breadcrumb"><a href="/profile" onClick={navLink(go)}>Profile</a> / <span aria-current="page">{title}</span></nav>
      <h1 id="pe-h" tabIndex={-1} ref={headingRef} style={{ fontSize: "var(--fs-h2)" }}>{title}</h1>
      <div className="cols">
        <form className="form panel" onSubmit={(e) => void submit(e)} noValidate>
          {problems.length > 0 && (
            <div className="banner error errsum" role="alert" tabIndex={-1} ref={summaryRef}>
              <b>{problems.length === 1 ? "1 thing" : `${problems.length} things`} to fix before saving</b>
              <ul>
                {problems.map((p, i) => (
                  <li key={i}><a href={`#${fieldId[p.field]}`} onClick={(e) => { e.preventDefault(); document.getElementById(fieldId[p.field])?.focus(); }}>{summaryLine(p)}</a></li>
                ))}
              </ul>
            </div>
          )}

          <fieldset id={fieldId.kind} tabIndex={-1}>
            <legend>Type</legend>
            <div className="row">
              {(["achievement", "skill", "role", "education"] as const).filter((k) => pieceKinds.includes(k)).map((k) => (
                <label className="opt" key={k}>
                  <input type="radio" name="pe-kind" checked={draft.kind === k} onChange={() => set({ kind: k })} /> {kindLabel[k]}
                </label>
              ))}
            </div>
          </fieldset>

          {hasEntry ? (
            <>
              <div className="field">
                <label htmlFor={fieldId.title}>{role ? "Job title" : "Degree or course"}</label>
                <input className="input" id={fieldId.title} value={draft.title} onChange={(e) => set({ title: e.target.value })} aria-invalid={invalid("title")} aria-describedby={describedBy("title")} />
                {errors("title")}
              </div>
              <div className="pair">
                <div className="field">
                  <label htmlFor={fieldId.organisation}>{role ? "Employer" : "School"}</label>
                  <input className="input" id={fieldId.organisation} value={draft.organisation} onChange={(e) => set({ organisation: e.target.value })} aria-invalid={invalid("organisation")} aria-describedby={describedBy("organisation")} />
                  {errors("organisation")}
                </div>
                <div className="field">
                  <label htmlFor="pe-city">City <span className="meta">optional</span></label>
                  <input className="input" id="pe-city" value={draft.city} onChange={(e) => set({ city: e.target.value })} />
                </div>
              </div>
              <div className="pair">
                <div className="field">
                  <label htmlFor={fieldId.start}>Started</label>
                  <span className="help" id="pe-start-help">Month and year. CVs show them exactly as here.</span>
                  <input className="input" id={fieldId.start} type="month" value={draft.start} onChange={(e) => set({ start: e.target.value })} aria-invalid={invalid("start")} aria-describedby={describedBy("start", "pe-start-help")} />
                  {errors("start")}
                </div>
                <div className="field">
                  <label htmlFor={fieldId.end}>Ended</label>
                  <span className="help" id="pe-end-help">Leave it empty while it's current.</span>
                  <input className="input" id={fieldId.end} type="month" value={draft.end} onChange={(e) => set({ end: e.target.value })} aria-invalid={invalid("end")} aria-describedby={describedBy("end", "pe-end-help")} />
                  {errors("end")}
                </div>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor={fieldId.belongsTo}>Belongs to</label>
              <select className="input" id={fieldId.belongsTo} value={draft.belongsTo} onChange={(e) => set({ belongsTo: e.target.value })} aria-invalid={invalid("belongsTo")} aria-describedby={describedBy("belongsTo")}>
                {heads.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                <option value="">No role (general skill)</option>
              </select>
              {errors("belongsTo")}
            </div>
          )}

          <div className="field">
            <label htmlFor={fieldId.text}>{textLabel}{hasEntry && <span className="meta"> optional</span>}</label>
            <span className="help" id="pe-text-help">{textHelp}</span>
            <textarea
              className="textarea" id={fieldId.text} value={draft.text} onChange={(e) => set({ text: e.target.value })}
              aria-invalid={invalid("text")} aria-describedby={describedBy("text", "pe-text-help", ...(draft.kind === "achievement" ? ["pe-text-count"] : []))}
              style={draft.kind === "skill" ? { minHeight: "var(--s-10)" } : undefined}
            />
            {errors("text")}
            {(problemsOf("text").some((p) => p.fixes.length) || draft.kind === "achievement") && (
              <div className="row">
                {problemsOf("text").flatMap((p) => p.fixes).map((f) => (
                  <button key={f.label} className="btn sm" type="button" onClick={() => applyFix(f.text, f.label)}>{f.label}</button>
                ))}
                {draft.kind === "achievement" && (
                  <span className={`count num${draft.text.length > maxAchievementLength ? " over" : ""}`} id="pe-text-count">
                    {draft.text.length} of {maxAchievementLength} characters
                  </span>
                )}
              </div>
            )}
          </div>

          <fieldset id={fieldId.numberSource} tabIndex={-1} aria-describedby={describedBy("numberSource", "pe-number-help")}>
            <legend>Where does the number come from?</legend>
            <span className="help" id="pe-number-help">Only when the piece has a number. Tailoring states measured numbers plainly and estimates with "about".</span>
            {numberSources.map((s) => (
              <label className="opt" key={s}>
                <input type="radio" name="pe-number" checked={draft.numberSource === s} onChange={() => set({ numberSource: s })} aria-invalid={invalid("numberSource")} /> {numberChoices[s]}
              </label>
            ))}
            {errors("numberSource")}
          </fieldset>

          <div className="field">
            <label htmlFor="pe-tags">Tags</label>
            <span className="help" id="pe-tags-help">Used to match job requirements. Press Enter to add.</span>
            <div className="chips-edit">
              {draft.tags.map((t) => (
                <span className="chip neutral" key={t}>{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => removeTag(t)}>✕</button></span>
              ))}
              <input id="pe-tags" value={tagText} onChange={(e) => setTagText(e.target.value)} onKeyDown={addTag} aria-describedby="pe-tags-help" autoComplete="off" />
            </div>
          </div>

          <fieldset>
            <legend>Angles it belongs to</legend>
            <div className="row">
              {angles.map((a) => (
                <label className="check" key={a}>
                  <input type="checkbox" checked={draft.angles.includes(a)} onChange={(e) => set({ angles: e.target.checked ? [...draft.angles, a] : draft.angles.filter((x) => x !== a) })} /> {angleLabel[a]}
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="err" role="alert">{error}</p>}
          <div className="row">
            <button className="btn primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            <a className="btn ghost" href="/profile" onClick={navLink(go)}>Cancel</a>
            <span className="grow" />
            {piece && <button className="btn ghost sm danger" type="button" onClick={() => setConfirming(true)}>Delete piece…</button>}
          </div>
        </form>

        <aside className="col">
          <div className="panel">
            <h2>Source</h2>
            {piece?.source.quote
              ? <div className="src"><span>"{piece.source.quote}"</span><span className="where">{piece.source.from}</span></div>
              : <p className="mini muted">{piece ? `${piece.source.from}. You are the source, so the honesty line is yours to hold.` : "You're adding this yourself, so you are its source."}</p>}
          </div>
          <div className="panel">
            <h2>The honesty line</h2>
            <p className="mini muted">Allowed: stronger verbs, confident framing of real work, favourable but plausible rounding. Not allowed: numbers with nothing behind them, or skills you couldn't talk about for 5 minutes.</p>
          </div>
          {piece && (
            <div className="panel">
              <h2>Used in</h2>
              <p className="mini muted">No packages yet. Saving changes future packages only; approved and submitted ones keep their files.</p>
            </div>
          )}
        </aside>
      </div>
      {confirming && piece && (
        <DeleteDialog piece={piece} under={under?.pieces.filter((p) => p.id !== piece.id).length ?? 0} onDelete={() => void remove()} onCancel={() => setConfirming(false)} />
      )}
    </section>
  );
}

function kindFromUrl(): PieceKind {
  const k = new URLSearchParams(window.location.search).get("kind");
  return pieceKinds.includes(k as PieceKind) ? (k as PieceKind) : "achievement";
}

/** "Delete piece…": says what goes and what stays; focus starts on Cancel, the safe choice. */
function DeleteDialog({ piece, under, onDelete, onCancel }: { piece: ProfilePiece; under: number; onDelete: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const done = (fn: () => void) => { ref.current?.close(); fn(); };
  return (
    <dialog ref={ref} className="pass-dialog" aria-labelledby="del-h" aria-describedby="del-d" onCancel={(e) => { e.preventDefault(); done(onCancel); }}>
      <div className="stack" style={{ gap: "var(--s-4)" }}>
        <h2 id="del-h">Delete "{pieceName(piece)}"?</h2>
        <p id="del-d" className="muted mini">
          It leaves your master profile, so no new CV, letter or answer can use it.
          {under > 0 && ` The ${under === 1 ? "piece" : `${under} pieces`} under it stay, tied to no role.`}
          {" "}Packages already approved or submitted keep their files as they are.
        </p>
        <div className="row">
          <button className="btn danger" type="button" onClick={() => done(onDelete)}>Delete piece</button>
          <button className="btn ghost" type="button" autoFocus onClick={() => done(onCancel)}>Cancel</button>
        </div>
      </div>
    </dialog>
  );
}
