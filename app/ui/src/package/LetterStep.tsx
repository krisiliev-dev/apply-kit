// Step 3, the cover letter (hi-fi: docs/design/hifi/package.html, states "3 · Cover letter",
// "3 · Letter preview", "Error · a part failed" and "AI cap reached"; ticket #65). Edit: the draft in
// an editor with a live word count and the sentences written for the company highlighted (and named
// in text, PA-05), drafts paged, "Write draft N" with an instruction and quick ones, and "Write it
// myself". Preview: the exact PDF with the CV's letterhead, and the draft download. Beside it the
// checks and the voice, with exactly the excerpts this draft sent. Kris's edits save as she pauses.
import type { LetterCheckView, LetterView, PackageView } from "@apply-kit/core";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { editLetter, packageLetterUrl, redraftLetter, retryPart, showLetterDraft, writeLetterYourself } from "../api.ts";
import { Icon } from "../icons.tsx";

const PdfPreview = lazy(() => import("./PdfPreview.tsx").then((m) => ({ default: m.PdfPreview })));

export type LetterViewMode = "edit" | "preview";
type ChangeResult = { changed: boolean; reason?: string; package: PackageView };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
/** Words as the service counts them: runs with a letter or digit. */
const wordsIn = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** The body's words in the editor's text: without the greeting (first block) and closing (last block), as the service counts. */
function bodyWordsOf(text: string, letter: LetterView): number {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (letter.greeting && blocks[0] === letter.greeting) blocks.shift();
  if (letter.closing && blocks.at(-1)?.split("\n")[0] === letter.closing) blocks.pop();
  return wordsIn(blocks.join(" "));
}

/** Writing the letter myself, from wherever the letter wasn't written. */
export async function writeOwnLetter(pkg: PackageView, onChange: (p: PackageView) => void, say: (m: string) => void): Promise<boolean> {
  const r = await writeLetterYourself(pkg.id).catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
  onChange(r.package);
  say(r.changed ? "An empty draft with your letterhead is open. Write the letter in the editor." : r.reason ?? "Couldn't open an empty draft.");
  return r.changed;
}

export function LetterStep({ pkg, view, onView, onChange, onGo, say }: {
  pkg: PackageView; view: LetterViewMode; onView: (v: LetterViewMode) => void; onChange: (p: PackageView) => void; onGo: (v: "progress") => void; say: (m: string) => void;
}) {
  const part = pkg.parts.find((p) => p.part === "letter")!;
  const letter = pkg.letter;

  async function retry() {
    const r = await retryPart(pkg.id, "letter").catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
    onChange(r.package);
    say(r.changed ? "Writing the cover letter again…" : r.reason ?? "");
  }

  if (!letter) {
    if (part.state === "working" || part.state === "waiting") {
      return (
        <div className="panel">
          <div className="step-title"><h2>Cover letter</h2><p className="muted">Written in your voice, from your CV as you decide it.</p></div>
          <div className="stack" role="status"><p className="meta">Writing the letter…</p><span className="skel w70" /><span className="skel w90" /><span className="skel w50" /></div>
        </div>
      );
    }
    const capped = part.state === "not-written";
    return (
      <>
        <div className={`banner ${part.state === "failed" ? "error" : "warning"}`} role="alert">
          <span className="text"><b>The cover letter wasn't written.</b> {part.what} Your CV version and everything else are saved; nothing was lost.</span>
          {!capped && <button className="btn sm" type="button" onClick={() => void retry()}>Try again</button>}
        </div>
        <div className="panel">
          <div className="step-title"><h2>Cover letter</h2><p className="muted">A failure in one part never blocks the others.</p></div>
          <div className="stack">
            {capped && (
              <div className="row"><button className="btn" type="button" onClick={() => onGo("progress")}>See the budget</button><span className="meta">The app never raises the cap by itself: raise it in Settings, or wait for next month.</span></div>
            )}
            <div className="row">
              <button className="btn" type="button" onClick={() => void writeOwnLetter(pkg, onChange, say)}>Write the letter myself</button>
              <span className="meta">Opens an empty editor with your letterhead.</span>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="panel">
      <div className="sec-head">
        <div className="step-title grow">
          <h2>Cover letter</h2>
          <p className="muted">{view === "edit"
            ? "Written in your voice. Edit it here; your edits teach the voice for next time."
            : `The exact PDF that gets uploaded: draft ${letter.draft}${letter.editedAt ? ", as edited" : ""}.`}</p>
        </div>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "edit"} onClick={() => onView("edit")}>Edit</button>
          <button type="button" aria-pressed={view === "preview"} onClick={() => onView("preview")}>Preview</button>
        </div>
      </div>
      {view === "edit"
        ? <LetterEditor key={`${letter.draft}`} pkg={pkg} letter={letter} onChange={onChange} say={say} />
        : <LetterPreview pkg={pkg} letter={letter} />}
    </div>
  );
}

function LetterPreview({ pkg, letter }: { pkg: PackageView; letter: LetterView }) {
  const file = letter.file;
  if (!file) return <p className="meta" role="status">Printing the letter…</p>;
  return (
    <>
      <Suspense fallback={<p className="meta" role="status">Opening the PDF…</p>}>
        <PdfPreview key={file.sha256} url={packageLetterUrl(pkg.id, file.sha256)} name="Cover letter" pages={file.pages} overflow={file.overflow !== null} />
      </Suspense>
      <div className="row">
        <a className="btn sm" href={packageLetterUrl(pkg.id, file.sha256, true)} download>Download draft PDF</a>
        <span className="meta">Same letterhead as your CV. Downloads say "draft" until the package is approved; highlights never reach the PDF.</span>
      </div>
    </>
  );
}

/** The draft's text with the sentences written for the company marked, for the backdrop behind the editor. */
function marked(text: string, sentences: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  const hits = sentences.flatMap((s) => {
    const i = text.indexOf(s);
    return i === -1 ? [] : [{ i, s }];
  }).sort((a, b) => a.i - b.i);
  for (const { i, s } of hits) {
    if (i < at) continue;
    out.push(text.slice(at, i), <mark key={i}>{s}</mark>);
    at = i + s.length;
  }
  out.push(text.slice(at));
  return out;
}

function LetterEditor({ pkg, letter, onChange, say }: { pkg: PackageView; letter: LetterView; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  const [text, setText] = useState(letter.text);
  const [highlight, setHighlight] = useState(true);
  const [saved, setSaved] = useState<{ at: string | null; error: string | null }>({ at: letter.editedAt, error: null });
  const [instruction, setInstruction] = useState("");
  const [writing, setWriting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ text, sent: letter.text });

  async function save() {
    window.clearTimeout(timer.current);
    const now = latest.current.text;
    if (now === latest.current.sent) return;
    latest.current.sent = now;
    try {
      const r = await editLetter(pkg.id, letter.draft, now);
      onChange(r.package);
      setSaved({ at: r.package.letter?.editedAt ?? null, error: r.changed ? null : r.reason ?? null });
    } catch (err) {
      latest.current.sent = "";
      setSaved((s) => ({ ...s, error: `Couldn't save: ${message(err)}. Your text is kept here; it saves again when you pause.` }));
    }
  }
  // Saves when Kris pauses, and before the draft is left.
  useEffect(() => () => { void save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next: string) => {
    setText(next);
    latest.current.text = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 1_200);
  };

  async function redraft(ask: string) {
    const said = ask.trim();
    if (!said) { setRefused("Say what to change, or pick one of the quick instructions."); return; }
    await save();
    setWriting(true);
    setRefused(null);
    say(`Writing draft ${letter.drafts + 1}. Draft ${letter.draft} is kept.`);
    const r: ChangeResult = await redraftLetter(pkg.id, said).catch((err: unknown) => ({ changed: false, reason: message(err), package: pkg }));
    setWriting(false);
    onChange(r.package);
    if (r.changed) say(`Draft ${r.package.letter!.draft} is ready.`);
    else { setRefused(r.reason ?? null); say(r.reason ?? ""); }
  }

  async function page(to: number) {
    await save();
    const r: ChangeResult = await showLetterDraft(pkg.id, to).catch((err: unknown) => ({ changed: false, reason: message(err), package: pkg }));
    onChange(r.package);
    say(r.changed ? `Draft ${to} of ${letter.drafts}.` : r.reason ?? "");
  }

  const words = bodyWordsOf(text, letter);
  const marks = letter.paragraphs.flat().filter((s) => s.forCompany).map((s) => s.text);
  const next = letter.drafts + 1;
  return (
    <>
      <div className="toolbar">
        <div className="row" role="group" aria-label="Drafts">
          <button className="btn ghost sm" type="button" aria-label="Previous draft" aria-disabled={letter.draft === 1 ? "true" : undefined} onClick={() => { if (letter.draft > 1) void page(letter.draft - 1); }}>‹</button>
          <span className="meta num">Draft {letter.draft} of {letter.drafts}</span>
          <button className="btn ghost sm" type="button" aria-label="Next draft" aria-disabled={letter.draft === letter.drafts ? "true" : undefined} onClick={() => { if (letter.draft < letter.drafts) void page(letter.draft + 1); }}>›</button>
        </div>
        <span className="grow" />
        {letter.forCompany.count > 0 && (
          <label className="check"><input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} /> Highlight sentences written for {pkg.company}</label>
        )}
        <span className={`count num${words > letter.target * 1.15 ? " over" : ""}`} id="letter-count" aria-live="polite">{words} words · target {letter.target}</span>
      </div>
      {letter.instruction && <p className="meta">Asked for: "{letter.instruction}"</p>}
      <div className="letter-editor">
        <div className="backdrop" aria-hidden="true">{highlight ? marked(text, marks) : text}{"\n"}</div>
        <textarea
          value={text} spellCheck lang={pkg.language} aria-label="Cover letter text" aria-describedby="letter-count letter-marks"
          onChange={(e) => edit(e.target.value)} onBlur={() => void save()}
        />
      </div>
      <p className="meta" id="letter-marks">
        {letter.origin === "own" ? "You're writing this draft yourself. Keep the greeting first and the closing last, each on its own; your name is signed under the closing."
          : letter.forCompany.count > 0
            ? <><span className="chip ask"><Icon name="info" />Highlighted</span> {letter.forCompany.count === 1 ? "1 sentence was" : `${letter.forCompany.count} sentences were`} written for {pkg.company}: {letter.forCompany.where}. Check those first; highlights never reach the PDF.</>
            : "No sentence is marked as written for this company."}
        {" "}<span className="why-off" role="status">{saved.error ?? (saved.at ? `Saved ${hhmm(saved.at)}` : "")}</span>
      </p>
      <div className="field">
        <label htmlFor="letter-instruction">Ask for a new draft</label>
        <span className="help" id="letter-instruction-help">Draft {letter.draft} stays as it is, so nothing is lost by trying. About $0.01.</span>
        <div className="row">
          <input className="input grow" id="letter-instruction" aria-describedby="letter-instruction-help" placeholder="e.g. Shorter, and mention the course…" value={instruction}
            onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void redraft(instruction); } }} />
          <button className="btn" type="button" aria-disabled={writing ? "true" : undefined} onClick={() => { if (!writing) void redraft(instruction); }}>
            {writing ? `Writing draft ${next}…` : `Write draft ${next}`}
          </button>
        </div>
        <div className="chips" role="group" aria-label="Quick instructions">
          {letter.quick.map((q) => <button className="filter" type="button" key={q} disabled={writing} onClick={() => void redraft(q)}>{q}</button>)}
        </div>
        {refused && <p className="why-off" role="alert">{refused}</p>}
      </div>
      <div className="row">
        <button className="btn ghost sm" type="button" onClick={() => void writeOwnLetter(pkg, onChange, say)}>Write it myself</button>
        <span className="meta">Starts an empty draft {next} with your letterhead; this one stays as draft {letter.draft}.</span>
      </div>
    </>
  );
}

const checkChip: Record<LetterCheckView["state"], ReactNode> = {
  ok: <span className="chip met"><Icon name="met" />OK</span>,
  problem: <span className="chip gap"><Icon name="gap" />Fix</span>,
  warning: <span className="chip partly"><Icon name="partly" />Check</span>,
};

/** Beside the letter: its checks, and the voice it was written with (exactly the excerpts this draft sent). */
export function LetterSide({ letter }: { letter: LetterView }) {
  const [open, setOpen] = useState(false);
  const { voice } = letter;
  return (
    <>
      <div className="panel">
        <h2>Checks</h2>
        <ul className="checks">
          {letter.checks.map((c) => (
            <li key={c.id}>{checkChip[c.state]}<span>{c.label}{c.detail && <span className="meta" style={{ display: "block" }}>{c.detail}</span>}</span></li>
          ))}
        </ul>
      </div>
      <div className="panel">
        <h2>Voice</h2>
        <p className="mini muted">
          From {voice.samples} {voice.samples === 1 ? "sample" : "samples"} and {voice.edits} {voice.edits === 1 ? "edit" : "edits"}. The samples stay on this laptop.
        </p>
        {letter.origin === "own" ? <p className="meta">You're writing this draft: nothing of your writing was sent for it.</p>
          : voice.sent.length === 0 ? <p className="meta">Sent with this draft: no excerpts of your writing.</p>
          : (
            <>
              <button className="btn ghost sm" type="button" aria-expanded={open} aria-controls="sent-excerpts" onClick={() => setOpen(!open)}>
                Sent with this draft: {voice.sent.length} {voice.sent.length === 1 ? "excerpt" : "excerpts"}, {voice.sentWords} words
              </button>
              <div id="sent-excerpts" className="src" hidden={!open}>
                {voice.sent.map((e, i) => <span key={i}>"{e.text}" <span className="where">{e.from}</span></span>)}
              </div>
            </>
          )}
        <a className="btn ghost sm" href="/profile#voice">What the voice learned</a>
      </div>
    </>
  );
}
