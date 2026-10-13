// Setup, phase A: import (hi-fi: docs/design/hifi/onboarding.html, states "A · Import", "Reading
// files", "Partial · one file unreadable" and "AI cap reached"). Old CVs, the LinkedIn export and links
// become drafted pieces, usable in Profile as each file finishes. The coach interview and the search
// check are later steps (#55, #56).
import type { HealthSummary, ImportInputProblem, ImportItem, ImportMerge, ImportStatus, UnreadableAction } from "@apply-kit/core";
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  cancelImport, fetchImport, fetchImportMerges, fetchLatestImport, fetchSources, resolveImportItem, resumeImport, startImport, toUpload,
} from "../api.ts";
import { Icon } from "../icons.tsx";

const POLL_MS = 1_000;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function SetupPage({ onHealth }: { onHealth: (h: HealthSummary) => void }) {
  const [status, setStatus] = useState<ImportStatus | null | undefined>(undefined);
  const [form, setForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState("");

  const announce = useCallback((msg: string) => {
    setLive("");
    window.setTimeout(() => setLive(msg), 60);
  }, []);

  // The top bar shows source health on every screen.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLatestImport(ctrl.signal).then(setStatus).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, []);

  // While sources are read, follow the import; each finished source is announced once.
  const seen = useRef(new Map<string, string>());
  const receive = useCallback((next: ImportStatus) => {
    const said: string[] = [];
    for (const item of next.items) {
      const before = seen.current.get(item.id);
      seen.current.set(item.id, item.state);
      if (before === undefined || before === item.state || (item.state !== "done" && item.state !== "unreadable" && item.state !== "waiting")) continue;
      said.push(item.state === "done" ? `${item.name} done, ${plural(item.pieces, "piece", "pieces")}.` : item.state === "unreadable" ? `${item.name} couldn't be read.` : `${item.name} waits for the AI budget.`);
    }
    if (said.length > 0) announce(said.join(" "));
    setStatus(next);
  }, [announce]);
  const running = status?.state === "running";
  const runId = status?.id;
  useEffect(() => {
    if (!running || !runId) return;
    const t = window.setInterval(() => {
      fetchImport(runId).then(receive).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [running, runId, receive]);

  const started = (s: ImportStatus) => {
    seen.current = new Map(s.items.map((i) => [i.id, i.state]));
    setStatus(s);
    setForm(false);
    announce(`Reading ${plural(s.total, "source", "sources")}.`);
    window.setTimeout(() => document.getElementById("setup-h")?.focus(), 0);
  };

  return (
    <section className="setup stack">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{live}</div>
      {error ? (
        <div className="banner error" role="alert"><span className="text"><b>Couldn't load setup.</b> {error}</span></div>
      ) : status === undefined ? (
        <p className="meta" role="status">Loading…</p>
      ) : status === null || form ? (
        <ImportForm onStarted={started} onBack={status ? () => setForm(false) : null} />
      ) : (
        <ImportRunView status={status} onStatus={receive} announce={announce} onImportMore={() => { setForm(true); window.setTimeout(() => document.getElementById("setup-h")?.focus(), 0); }} />
      )}
    </section>
  );
}

function Steps({ status }: { status: ImportStatus | null }) {
  const reading = status?.state === "running";
  return (
    <nav aria-label="Setup steps">
      <ol className="pk-steps">
        <li className={`current${reading ? " working" : ""}`}>
          <a href="/setup" aria-current="step">
            <span className="ic" aria-hidden="true">{reading ? <span className="spin" /> : "1"}</span>
            <span className="lbl">Import</span>
            <span className="sub">{reading ? "Reading…" : "Old CVs, LinkedIn"}</span>
          </a>
        </li>
        <li className="upcoming">
          <a href="/profile"><span className="ic" aria-hidden="true">2</span><span className="lbl">Check drafts</span><span className="sub">{status && status.pieces > 0 ? `${status.pieces} ready` : "Confirm or fix"}</span></a>
        </li>
        <li className="upcoming">
          <a aria-disabled="true"><span className="ic" aria-hidden="true">3</span><span className="lbl">Interview</span><span className="sub">Coming next</span></a>
        </li>
        <li className="upcoming">
          <a href="/profile/search"><span className="ic" aria-hidden="true">4</span><span className="lbl">Your search</span><span className="sub">Check defaults</span></a>
        </li>
      </ol>
    </nav>
  );
}

const typeLabel = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toUpperCase() ?? "File";
const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// ---------- A · Import ----------

function ImportForm({ onStarted, onBack }: { onStarted: (s: ImportStatus) => void; onBack: (() => void) | null }) {
  const [files, setFiles] = useState<File[]>([]);
  const [linkedIn, setLinkedIn] = useState<File | null>(null);
  const [github, setGithub] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<ImportInputProblem[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const links = (github.trim() ? 1 : 0) + (portfolio.trim() ? 1 : 0) + (linkedIn ? 1 : 0);

  const add = (list: FileList | null) => {
    if (!list) return;
    const names = new Set(files.map((f) => f.name));
    setFiles([...files, ...[...list].filter((f) => !names.has(f.name))]);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const answer = await startImport({
        files: await Promise.all(files.map(toUpload)),
        linkedIn: linkedIn ? await toUpload(linkedIn) : null,
        github,
        portfolio,
      });
      if (answer.started) return onStarted(answer.status);
      setProblems(answer.problems);
    } catch (err) {
      setProblems([{ field: "files", message: message(err) }]);
    } finally {
      setBusy(false);
    }
    // Focus follows the refusal to its reasons.
    window.setTimeout(() => summaryRef.current?.focus(), 0);
  };

  const err = (field: ImportInputProblem["field"]) => problems.filter((p) => p.field === field);
  const label = files.length + links === 0
    ? "Import"
    : `Import ${[files.length > 0 && plural(files.length, "file", "files"), links > 0 && plural(links, "link", "links")].filter(Boolean).join(" and ")}`;

  return (
    <form className="stack setup-form" onSubmit={submit} noValidate>
      <Steps status={null} />
      <div className="head">
        <h1 id="setup-h" tabIndex={-1}>Start with what you already have</h1>
        <p className="muted">Old CVs and your LinkedIn export give the coach something to question. Nothing needs to be up to date or polished. You can stop after any step.</p>
      </div>
      {problems.length > 0 && (
        <div className="banner error" role="alert" tabIndex={-1} ref={summaryRef}>
          <span className="text"><b>Can't import yet.</b>{" "}
            {problems.map((p, i) => <a key={i} href={`#${p.field === "files" ? "files-in" : p.field === "linkedIn" ? "li" : p.field === "github" ? "gh" : "pf"}`}>{p.message} </a>)}
          </span>
        </div>
      )}
      <div className="cols">
        <div className="col">
          <div className="panel">
            <div className={`dropzone${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 15v4h14v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <b>Drop old CVs and cover letters here</b>
              <span className="meta">PDF, DOCX or TXT · as many versions as you have · duplicates are merged</span>
              <label className="btn" htmlFor="files-in">Choose files</label>
              <input className="sr-only" id="files-in" type="file" multiple accept=".pdf,.docx,.txt,.pages,.doc" aria-describedby={err("files").length ? "files-err" : undefined} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
            </div>
            {err("files").map((p, i) => <p className="err-line" id="files-err" key={i}>{p.message}</p>)}
            {files.length > 0 && (
              <ul className="files" aria-label="Files to import">
                {files.map((f) => (
                  <li key={f.name}>
                    <span><span className="name">{f.name}</span><span className="meta" style={{ display: "block" }}>{typeLabel(f.name)} · {sizeLabel(f.size)}</span></span>
                    <button className="btn ghost sm" type="button" onClick={() => setFiles(files.filter((x) => x !== f))}>Remove<span className="sr-only"> {f.name}</span></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel links">
            <div className="field">
              <label htmlFor="li">LinkedIn data export <span className="meta">optional</span></label>
              <span className="help" id="li-help">LinkedIn › Settings › Data privacy › Get a copy of your data › "Positions, Education, Skills". The .zip arrives by email in about 10 minutes; you can add it later. It's read on this laptop, without the model.</span>
              <div className="row">
                <label className="btn sm" htmlFor="li">Choose .zip</label>
                <input className="sr-only" id="li" type="file" accept=".zip" aria-describedby={`li-help${err("linkedIn").length ? " li-err" : ""}`} onChange={(e) => { setLinkedIn(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                {linkedIn && <><span className="meta">{linkedIn.name}</span><button className="btn ghost sm" type="button" onClick={() => setLinkedIn(null)}>Remove<span className="sr-only"> {linkedIn.name}</span></button></>}
              </div>
              {err("linkedIn").map((p, i) => <span className="err" id="li-err" key={i}>{p.message}</span>)}
            </div>
            <div className="field">
              <label htmlFor="gh">GitHub profile <span className="meta">optional</span></label>
              <span className="help" id="gh-help">Public repositories only: their languages, read without the model.</span>
              <input className="input" id="gh" placeholder="github.com/your-name" value={github} onChange={(e) => setGithub(e.target.value)} aria-invalid={err("github").length > 0 || undefined} aria-describedby={`gh-help${err("github").length ? " gh-err" : ""}`} />
              {err("github").map((p, i) => <span className="err" id="gh-err" key={i}>{p.message}</span>)}
            </div>
            <div className="field">
              <label htmlFor="pf">Portfolio or personal site <span className="meta">optional</span></label>
              <span className="help" id="pf-help">Design case studies count as experience. The page's text is read like a CV.</span>
              <input className="input" id="pf" placeholder="https://…" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} aria-invalid={err("portfolio").length > 0 || undefined} aria-describedby={`pf-help${err("portfolio").length ? " pf-err" : ""}`} />
              {err("portfolio").map((p, i) => <span className="err" id="pf-err" key={i}>{p.message}</span>)}
            </div>
          </div>
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Starting…" : label}</button>
            {onBack && <button className="btn ghost" type="button" onClick={onBack}>Back to the last import</button>}
          </div>
        </div>
        <aside className="col side">
          <div className="panel privacy">
            <h2>Where this goes</h2>
            <ul>
              <li>Files stay on this laptop, in the app's data folder. They're never committed to git.</li>
              <li>To turn text into profile pieces, only the extracted text is sent to the model, through hosts outside China that don't store or train on it.</li>
              <li>Delete any piece at any time in Profile.</li>
            </ul>
          </div>
          <div className="panel next">
            <h2>What happens next</h2>
            <ol>
              <li>You check the drafted pieces</li>
              <li>The coach asks about what's unclear, gaps and forgotten skills</li>
              <li>You check what the Feed searches for</li>
            </ol>
          </div>
        </aside>
      </div>
    </form>
  );
}

// ---------- Reading, partial, cap reached ----------

const secondsLabel = (s: number) => (s < 60 ? `about ${s} s left` : `about ${Math.round(s / 60)} min left`);
const usd = (n: number) => `$${n.toFixed(2)}`;
/** The first day of the next month, when the budget resets: "1 Nov". */
function resetDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 1)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function ImportRunView({ status, onStatus, announce, onImportMore }: {
  status: ImportStatus;
  onStatus: (s: ImportStatus) => void;
  announce: (msg: string) => void;
  onImportMore: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const items = status.items;
  const unreadable = items.filter((i) => i.state === "unreadable");
  const waiting = items.filter((i) => i.state === "waiting" && i.waitingFor === "budget");
  const interrupted = items.filter((i) => (i.state === "waiting" && i.waitingFor === "restart") || i.state === "cancelled");
  const running = status.state === "running";
  const settled = items.filter((i) => i.state !== "queued" && i.state !== "reading").length;

  const act = async (run: () => Promise<ImportStatus>, said?: (s: ImportStatus) => string) => {
    setBusy(true);
    setFailure(null);
    try {
      const s = await run();
      onStatus(s);
      if (said) announce(said(s));
    } catch (err) {
      setFailure(message(err));
      window.setTimeout(() => failureRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  const heading = running ? "Reading your files"
    : status.state === "cancelled" ? "Import cancelled"
    : waiting.length > 0 ? "Reading your files"
    : `${status.done} of ${status.total} imported`;
  const check = status.pieces > 0 && <a className="btn primary" href="/profile">Check {plural(status.pieces, "piece", "pieces")}</a>;

  return (
    <div className="stack setup-run">
      <Steps status={status} />
      <div className="head">
        <h1 id="setup-h" tabIndex={-1}>{heading}</h1>
        {running && <p className="muted">{settled} of {status.total} done{status.secondsLeft ? ` · ${secondsLabel(status.secondsLeft)}` : ""}</p>}
      </div>
      {failure && <div className="banner error" role="alert" tabIndex={-1} ref={failureRef}><span className="text"><b>That didn't work.</b> {failure}</span></div>}

      {!running && waiting.length > 0 && (
        <div className="banner warning" role="status">
          <span className="text">
            <b>This month's AI budget is used up: {usd(status.budget.spentUsd)} of {usd(status.budget.capUsd)}.</b>{" "}
            {status.done} of {status.total} were read and their {plural(status.pieces, "piece is", "pieces are")} saved.{" "}
            {waiting.length === 1 ? "The other one waits" : `The other ${waiting.length} wait`} until the budget resets on {resetDay(status.budget.month)}, or until you raise the cap.
          </span>
        </div>
      )}
      {!running && waiting.length === 0 && unreadable.length > 0 && (
        <div className="banner warning" role="status">
          <span className="text">
            <b>{unreadable.length === 1 ? "One file couldn't be read." : `${unreadable.length} files couldn't be read.`}</b>{" "}
            Everything else is fine{status.pieces > 0 ? `: ${plural(status.pieces, "piece is", "pieces are")} waiting for you to check` : ""}.
          </span>
        </div>
      )}
      {running && status.pieces > 0 && (
        <div className="banner info">
          <span className="text"><b>{plural(status.pieces, "piece is", "pieces are")} ready.</b> Start checking now; the rest join the list as they finish.</span>
          <a className="btn primary sm" href="/profile">Start checking</a>
        </div>
      )}

      <div className="panel">
        {running && (
          <div className="meter" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={status.total} aria-valuenow={settled} aria-valuetext={`${settled} of ${status.total} sources read`}>
            <span style={{ width: `${(settled / Math.max(1, status.total)) * 100}%` }} />
          </div>
        )}
        <ul className="parts">
          {items.map((i) => <Part key={i.id} item={i} />)}
        </ul>
        {status.merged > 0 && <Merges id={status.id} count={status.merged} />}
      </div>

      {unreadable.map((item) => (
        <Unreadable key={item.id} item={item} busy={busy} onChoose={(action, file) => act(
          async () => resolveImportItem(item.id, action, file ? await toUpload(file) : undefined),
          () => action === "skip" ? `${item.name} skipped. The coach will ask about it instead.` : `Reading ${item.name} again.`,
        )} />
      ))}

      {running ? (
        <div className="row">
          <button className="btn ghost" type="button" disabled={busy} onClick={() => act(() => cancelImport(status.id), (s) => `Import cancelled. The ${plural(s.pieces, "piece", "pieces")} already drafted ${s.pieces === 1 ? "is" : "are"} kept.`)}>Cancel import</button>
          <span className="meta">Pieces already drafted are kept.</span>
        </div>
      ) : waiting.length > 0 ? (
        <div className="panel">
          <h2>How to continue</h2>
          <div className="stack">
            {check && <div className="row">{check}<span className="meta">Checking needs no model.</span></div>}
            <div className="row">
              <a className="btn" href="/settings">Raise the cap in Settings</a>
              <span className="meta">Reading {plural(waiting.length, "more file", "more files")} costs about {usd(Math.max(0.01, status.waitingCostUsd))}.</span>
            </div>
            <div className="row">
              <button className="btn ghost" type="button" disabled={busy} onClick={() => act(() => resumeImport(status.id), () => "Reading the waiting files.")}>Read the waiting files</button>
              <span className="meta">Once the cap is raised or the month turns.</span>
            </div>
          </div>
          <p className="meta">The app never raises the cap by itself.</p>
        </div>
      ) : (
        <div className="row">
          {check}
          {interrupted.length > 0 && (
            <button className="btn" type="button" disabled={busy} onClick={() => act(() => resumeImport(status.id), () => "Reading the rest.")}>Read the other {plural(interrupted.length, "source", "sources")}</button>
          )}
          <button className="btn ghost" type="button" onClick={onImportMore}>Import more files</button>
          {status.state === "cancelled" && <span className="meta">Pieces already drafted are kept.</span>}
        </div>
      )}
    </div>
  );
}

function Part({ item: i }: { item: ImportItem }) {
  const what = i.state === "done"
    ? [i.detail, i.pieces > 0 || i.merged === 0 ? `${plural(i.pieces, "piece", "pieces")} drafted` : null, i.merged > 0 ? `${i.merged} merged with earlier ones` : null, i.recognised ? "read by text recognition: check each piece" : null].filter(Boolean).join(" · ")
    : i.state === "reading" ? (i.source === "file" || i.source === "portfolio" ? "Drafting pieces · comparing with earlier files to merge duplicates" : "Reading")
    : i.state === "queued" ? "Waiting"
    : i.state === "unreadable" ? i.problem?.message
    : i.state === "waiting" ? (i.waitingFor === "budget" ? "Waits for the AI budget" : "Stopped when the app closed")
    : i.state === "skipped" ? "Skipped: the coach will ask about it instead"
    : "Cancelled";
  const [cls, icon, chip] = i.state === "done" ? ["done", <Icon name="met" key="i" />, <span className="chip met" key="c"><Icon name="met" />Done</span>]
    : i.state === "reading" ? ["working", <span className="spin" key="i" />, <span className="chip neutral" key="c">Reading…</span>]
    : i.state === "unreadable" ? ["failed", <Icon name="gap" key="i" />, <span className="chip gap" key="c"><Icon name="gap" />Not read</span>]
    : i.state === "waiting" ? ["stopped", <Icon name="partly" key="i" />, <span className="chip partly" key="c"><Icon name="partly" />Waiting</span>]
    : i.state === "queued" ? ["waiting", null, <span className="chip neutral" key="c">Queued</span>]
    : ["waiting", null, <span className="chip neutral" key="c">{i.state === "skipped" ? "Skipped" : "Cancelled"}</span>];
  return (
    <li className={cls}>
      <span className="ic" aria-hidden="true">{icon}</span>
      <span><b>{i.name}</b><span className="what">{what}</span></span>
      {chip}
    </li>
  );
}

function Merges({ id, count }: { id: string; count: number }) {
  const [merges, setMerges] = useState<ImportMerge[] | null>(null);
  const load = (open: boolean) => {
    if (open && !merges) fetchImportMerges(id).then(setMerges).catch(() => setMerges([]));
  };
  return (
    <details className="merges" onToggle={(e) => load(e.currentTarget.open)}>
      <summary>See merges <span className="meta">({count})</span></summary>
      {!merges ? <p className="meta">Loading…</p> : (
        <ul>
          {merges.map((m, i) => (
            <li key={i}>
              <b>{m.piece}</b>
              <span className="meta">Kept from {m.kept.from}{m.kept.quote ? <>: <q>{m.kept.quote}</q></> : null}</span>
              <span className="meta">Same in {m.merged.from}{m.merged.quote ? <>: <q>{m.merged.quote}</q></> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

const actionText: Record<UnreadableAction, [string, string]> = {
  recognise: ["Read it with text recognition", "Runs on this laptop, about 1 minute. Scans misread, so every piece from it is marked \"check this\"."],
  "text-version": ["Upload a text version", "A DOCX, or a PDF exported from Word or Google Docs."],
  retry: ["Try again", "Reads it again from the start."],
  skip: ["Skip it", "The coach will ask you about it instead."],
};

function Unreadable({ item, busy, onChoose }: { item: ImportItem; busy: boolean; onChoose: (action: UnreadableAction, file?: File) => void }) {
  const [choice, setChoice] = useState<UnreadableAction | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const options = item.problem?.options ?? [];
  const name = `choice-${item.id}`;
  const textVersion = item.source === "linkedin" ? ["Choose the right .zip", "The export LinkedIn emailed you."] as const : actionText["text-version"];

  const go = () => {
    if (!choice) return setMissing("Pick what to do with this file first.");
    if (choice === "text-version" && !file) return setMissing("Choose the text version's file.");
    setMissing(null);
    onChoose(choice, file ?? undefined);
  };

  return (
    <div className="panel">
      <fieldset className="choices">
        <legend>What do you want to do with {item.name}?</legend>
        {options.map((o) => (
          <label className="choice" key={o}>
            {/* Never pre-selected: Kris decides. */}
            <input type="radio" name={name} value={o} checked={choice === o} onChange={() => { setChoice(o); setMissing(null); }} />
            <b>{o === "text-version" ? textVersion[0] : actionText[o][0]}</b>
            <span className="meta">{o === "text-version" ? textVersion[1] : actionText[o][1]}</span>
          </label>
        ))}
      </fieldset>
      {/* The follow-up field shows from the checked state. */}
      {choice === "text-version" && (
        <div className="row">
          <label className="btn sm" htmlFor={`tv-${item.id}`}>Choose file</label>
          <input className="sr-only" id={`tv-${item.id}`} type="file" accept={item.source === "linkedin" ? ".zip" : ".pdf,.docx,.txt"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="meta">{file ? file.name : "No file chosen"}</span>
        </div>
      )}
      {missing && <p className="err-line" role="alert">{missing}</p>}
      <div className="row">
        <button className="btn" type="button" disabled={busy} onClick={go}>Continue<span className="sr-only"> with {item.name}</span></button>
        <span className="meta">You can come back to this file from Setup.</span>
      </div>
    </div>
  );
}
