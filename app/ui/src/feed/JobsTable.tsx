import type { FeedJob, FeedResult, FeedSort, FeedView, PassInput } from "@apply-kit/core";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { passJobs, saveJobs, undoDecision } from "../api.ts";
import { PassDialog } from "./PassDialog.tsx";
import { useShortcutsSetting } from "./shortcuts.ts";
import type { Toaster } from "./toast.tsx";
import { RowChips } from "../requirements.tsx";

const jobPage = (id: string) => `/jobs/${encodeURIComponent(id)}`;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** The title Kris reads: the English one for a posting in another language. */
const titleOf = (j: FeedJob) => j.titleTranslation ?? j.title;
const named = (j: FeedJob) => `${titleOf(j)} at ${j.company}`;
const backIn: Record<FeedView, string> = { new: "New", saved: "Saved", open: "All open", passed: "Passed & closed", hidden: "Hidden" };

/** Which actions take a job out of the view it is in. */
const leavesView = (view: FeedView, action: "save" | "pass") => action === "pass" || view === "new";

/**
 * The jobs table: roving focus (one row is in the Tab order, arrow keys move between rows),
 * multi-select with bulk Save and Pass, and single-key shortcuts that work only while focus is in
 * the table and can be turned off.
 */
export function JobsTable({ feed, view, sort, toaster, onChanged, queued, onShowQueued, checking, onShowRelocation, onShowHidden }: {
  /** The Feed, with `jobs` set to the rows on screen. */
  feed: FeedResult;
  view: FeedView;
  sort: FeedSort;
  toaster: Toaster;
  /** Refresh after a change; `touched` rows show even if they'd otherwise wait under the bar. */
  onChanged: (touched?: string[]) => void;
  /** Rows found by a running check, waiting behind the "Show them" bar. */
  queued: number;
  onShowQueued: () => void;
  checking: boolean;
  /** One-click fixes when filters leave the list empty: turn Relocation on, or open the hidden pile. */
  onShowRelocation: () => void;
  onShowHidden: () => void;
}) {
  const jobs = feed.jobs;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [shortcutsOn, setShortcutsOn] = useShortcutsSetting();
  const [passing, setPassing] = useState<{ ids: string[]; what: string; from: string | null } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const panelRef = useRef<HTMLDivElement>(null);

  const current = jobs.some((j) => j.id === activeId) ? activeId : (jobs[0]?.id ?? null);
  const chosen = jobs.filter((j) => selected.has(j.id));

  // A row to focus once it is on screen, for a row an undo brings back: set when the undo is
  // done, used (or given up) on the next Feed update. Focusing the row makes it active.
  const pendingFocus = useRef<string | null>(null);
  const focusLater = (id: string | undefined) => { pendingFocus.current = id ?? null; };
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    rowRefs.current.get(id)?.focus();
  }, [jobs]);

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setActiveId(id);
    rowRefs.current.get(id)?.focus();
  };

  /** The row to land on after `ids` leave the view: the next one, else the one before. */
  const nextAfter = (ids: string[]): string | null => {
    const gone = new Set(ids);
    const last = Math.max(...ids.map((id) => jobs.findIndex((j) => j.id === id)));
    const first = Math.min(...ids.map((id) => jobs.findIndex((j) => j.id === id)));
    const after = jobs.slice(last + 1).find((j) => !gone.has(j.id));
    const before = jobs.slice(0, Math.max(first, 0)).reverse().find((j) => !gone.has(j.id));
    return (after ?? before)?.id ?? null;
  };

  const land = (id: string | null) => {
    if (id) focusRow(id);
    else panelRef.current?.focus();
  };

  const clearSelection = (ids: string[]) => setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));

  async function save(ids: string[]) {
    const fresh = jobs.filter((j) => ids.includes(j.id) && j.state === "new");
    if (fresh.length === 0) return toaster.announce(ids.length === 1 ? "Already saved." : "Those jobs are already saved.");
    const next = leavesView(view, "save") ? nextAfter(fresh.map((j) => j.id)) : null;
    try {
      const d = await saveJobs(fresh.map((j) => j.id));
      clearSelection(ids);
      if (leavesView(view, "save")) land(next);
      onChanged();
      toaster.show({
        message: d.jobIds.length === 1 ? `Saved · ${named(fresh[0]!)}` : `Saved ${d.jobIds.length} jobs`,
        undo: () => {
          undoDecision(d.id)
            .then((r) => { focusLater(r.jobIds[0]); onChanged(r.jobIds); toaster.announce("Save undone."); })
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
        returnFocus: () => focusRow(current ?? undefined),
      });
    } catch (err) {
      toaster.show({ message: `Couldn't save: ${message(err)}` });
    }
  }

  function askPass(ids: string[]) {
    const list = jobs.filter((j) => ids.includes(j.id));
    if (list.length === 0) return;
    setPassing({ ids: list.map((j) => j.id), what: list.length === 1 ? named(list[0]!) : `${list.length} jobs`, from: list.length === 1 ? list[0]!.id : current });
  }

  async function pass(ids: string[], input: PassInput) {
    const list = jobs.filter((j) => ids.includes(j.id));
    const next = nextAfter(ids);
    setPassing(null);
    try {
      const d = await passJobs(ids, input);
      clearSelection(ids);
      land(next);
      onChanged();
      toaster.show({
        message: d.jobIds.length === 1 ? `Passed · ${named(list[0]!)}. It's in Passed & closed.` : `Passed ${d.jobIds.length} jobs. They're in Passed & closed.`,
        undo: () => {
          undoDecision(d.id)
            .then((r) => {
              focusLater(r.jobIds[0]);
              onChanged(r.jobIds);
              toaster.announce(r.jobIds.length === 1 ? `Pass undone. The job is back in ${backIn[view]}.` : `Pass undone. ${r.jobIds.length} jobs are back.`);
            })
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
        returnFocus: () => land(next),
      });
    } catch (err) {
      toaster.show({ message: `Couldn't pass: ${message(err)}` });
      focusRow(ids[0]);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-id]");
    if (!tr || e.altKey || e.ctrlKey || e.metaKey) return;
    const id = tr.dataset.id!;
    const i = jobs.findIndex((j) => j.id === id);
    const move = (to: number) => { e.preventDefault(); focusRow(jobs[Math.min(jobs.length - 1, Math.max(0, to))]?.id); };
    if (e.key === "ArrowDown") return move(i + 1);
    if (e.key === "ArrowUp") return move(i - 1);
    if (e.key === "Home" && e.target === tr) return move(0);
    if (e.key === "End" && e.target === tr) return move(jobs.length - 1);
    if (e.key === "Enter" && e.target === tr) {
      e.preventDefault();
      window.location.assign(jobPage(jobs[i]!.id));
      return;
    }
    // Single-key shortcuts: opt-out, scoped to the table, never with Shift (so typed capitals and
    // screen-reader or speech commands pass through).
    if (!shortcutsOn || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === "j") return move(i + 1);
    if (k === "k") return move(i - 1);
    if (k === "s") { e.preventDefault(); void save([id]); return; }
    if (k === "x") { e.preventDefault(); askPass([id]); }
  }

  const toggleShortcuts = () => {
    setShortcutsOn(!shortcutsOn);
    toaster.announce(shortcutsOn ? "Keyboard shortcuts off" : "Keyboard shortcuts on");
  };

  const filtered = feed.filteredToNothing;
  if (jobs.length === 0 && filtered && !checking) {
    const hidden = filtered.hidden.total;
    return (
      <div className="empty" ref={panelRef} tabIndex={-1}>
        <h2>Nothing to show with these filters</h2>
        <p>{filtered.text}</p>
        <div className="row">
          {filtered.relocation > 0 && (
            <button className="btn primary" type="button" onClick={onShowRelocation}>
              Show {filtered.relocation} relocation {filtered.relocation === 1 ? "job" : "jobs"}
            </button>
          )}
          {hidden > 0 && (
            <button className={`btn${filtered.relocation > 0 ? "" : " primary"}`} type="button" onClick={onShowHidden}>
              {hidden === 1 ? "Show the hidden one" : `Show the ${hidden} hidden jobs`}
            </button>
          )}
        </div>
        {queued > 0 && <button className="btn sm" type="button" onClick={onShowQueued}>Show {queued} new {queued === 1 ? "job" : "jobs"}</button>}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="empty" ref={panelRef} tabIndex={-1}>
        <h2>Nothing here yet</h2>
        <p>
          {checking ? "Jobs appear here as each source finishes."
            : view === "new" ? "No new jobs. Run a check to look again."
              : view === "saved" ? "No saved jobs. Save one from New to keep it here." : "No open jobs."}
        </p>
        {queued > 0 && <button className="btn sm" type="button" onClick={onShowQueued}>Show {queued} new {queued === 1 ? "job" : "jobs"}</button>}
        {passing && <PassDialog what={passing.what} onPass={(input) => void pass(passing.ids, input)} onCancel={() => setPassing(null)} />}
      </div>
    );
  }

  const allChosen = chosen.length === jobs.length;
  return (
    <div className="panel flush" ref={panelRef} tabIndex={-1}>
      <div className="bulk">
        <span>{chosen.length ? `${chosen.length} selected` : "Select jobs to save or pass several at once"}</span>
        <button className="btn sm" type="button" disabled={!chosen.some((j) => j.state === "new")} onClick={() => void save(chosen.map((j) => j.id))}>Save</button>
        <button className="btn sm" type="button" disabled={chosen.length === 0} onClick={() => askPass(chosen.map((j) => j.id))}>Pass…</button>
        <span className="keys">
          {shortcutsOn
            ? <><span>Keyboard shortcuts in the list: <b>on</b> ·</span><kbd>J</kbd><kbd>K</kbd> move <kbd>Enter</kbd> open <kbd>S</kbd> save <kbd>X</kbd> pass</>
            : <span>Keyboard shortcuts: <b>off</b> · arrow keys and Enter still work</span>}
          <button className="linkish" type="button" onClick={toggleShortcuts}>{shortcutsOn ? "Turn off" : "Turn on"}</button>
        </span>
      </div>
      {queued > 0 && (
        <div className="queue">
          <span>{queued} new {queued === 1 ? "job" : "jobs"} found</span>
          <button className="btn sm" type="button" onClick={onShowQueued}>Show them</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table jobs" aria-label={sort === "fit" ? "Jobs, best fit first" : "Jobs, newest first"} aria-describedby="jobs-keys-help">
          <thead>
            <tr>
              <th scope="col" className="col-check">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allChosen}
                  ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && !allChosen; }}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(jobs.map((j) => j.id)))}
                />
              </th>
              <th scope="col">Job</th>
              <th scope="col" className="wide">Where</th>
              <th scope="col" className="wide">Requirements</th>
              <th scope="col" className="wide">Salary</th>
              <th scope="col" className="wide" aria-sort={sort === "newest" ? "descending" : undefined}>Posted</th>
              <FitHeader sorted={sort === "fit"} />
            </tr>
          </thead>
          <tbody onKeyDown={onKeyDown}>
            {jobs.map((j, i) => (
              <Fragment key={j.id}>
                {j.fit.place.tier === "relocation" && jobs[i - 1]?.fit.place.tier !== "relocation" && (
                  <tr className="group"><th colSpan={7} scope="colgroup">Relocation · a separate, lower-priority list</th></tr>
                )}
                <JobRow
                  job={j}
                  asOf={feed.asOf}
                  active={j.id === current}
                  checked={selected.has(j.id)}
                  showSavedChip={view !== "saved"}
                  rowRef={(el) => { if (el) rowRefs.current.set(j.id, el); else rowRefs.current.delete(j.id); }}
                  onFocus={() => setActiveId(j.id)}
                  onCheck={(on) => setSelected((s) => { const n = new Set(s); if (on) n.add(j.id); else n.delete(j.id); return n; })}
                  onSave={() => void save([j.id])}
                  onPass={() => askPass([j.id])}
                />
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sr-only" id="jobs-keys-help">
        Up and down arrows move between jobs; Enter opens the job.{shortcutsOn ? " J and K also move, S saves, X passes." : ""}
      </p>
      <div className="foot">
        {checking
          ? <span>More appear as sources finish. They wait under the bar above, so nothing moves while you work.</span>
          : <span className="num">Showing {jobs.length} of {jobs.length + queued}</span>}
      </div>
      {passing && (
        <PassDialog
          what={passing.what}
          onPass={(input) => void pass(passing.ids, input)}
          onCancel={() => { const from = passing.from; setPassing(null); focusRow(from ?? undefined); }}
        />
      )}
    </div>
  );
}

function JobRow({ job, asOf, active, checked, showSavedChip, rowRef, onFocus, onCheck, onSave, onPass }: {
  job: FeedJob;
  asOf: string;
  active: boolean;
  checked: boolean;
  showSavedChip: boolean;
  rowRef: (el: HTMLTableRowElement | null) => void;
  onFocus: () => void;
  onCheck: (on: boolean) => void;
  onSave: () => void;
  onPass: () => void;
}) {
  // Roving focus: only the active row (and its controls) is in the Tab order.
  const tab = active ? 0 : -1;
  const where = job.location ?? "Location not stated";
  // "Not stated" is only claimed once the posting has been read.
  const salary = job.salary ?? (job.reading === "read" ? "Not stated" : "Not read yet");
  const posted = job.postedAt ? ago(job.postedAt, asOf) : "Unknown";
  return (
    <tr ref={rowRef} data-id={job.id} tabIndex={tab} className={checked ? "is-selected" : undefined} onFocus={onFocus}>
      <td className="col-check">
        <input type="checkbox" tabIndex={tab} aria-label={`Select ${named(job)}`} checked={checked} onChange={(e) => onCheck(e.target.checked)} />
      </td>
      <td className="job">
        <a className="t" href={jobPage(job.id)} tabIndex={tab}>{titleOf(job)}</a>
        <span className="co">{job.company}</span>
        {showSavedChip && job.state === "saved" && <span className="chip met saved-chip">Saved</span>}
        {job.unverified && <span className="chip partly" title="Captured or pasted, and nothing has seen it for 30 days. Still in the Feed.">Unverified after 30 days</span>}
        {job.titleTranslation && <span className="meta"> · <span lang={job.language ?? undefined}>{job.title}</span></span>}
        {job.siteCount > 1
          ? <span className="meta"> · on {job.siteCount} sites</span>
          : job.postingCount > 1 && <span className="meta"> · seen in {job.postingCount} postings</span>}
        <span className="narrow meta">{where} · {salary} · {posted}</span>
        <div className="narrow"><RowChips job={job} /></div>
        <div className="why-row">
          <div className="why">
            {job.fit.why}
            {job.dealbreakers.length > 0 && (
              <span className="learned">
                Dealbreaker: {job.dealbreakers.map((d) => d.text).join(" · ")}
                {job.shownByYou ? " · shown because you chose Show this job" : job.state === "saved" ? " · shown because you saved it" : ""}
              </span>
            )}
          </div>
          <div className="row-acts">
            {job.state === "new" && (
              <button className="btn ghost sm" type="button" tabIndex={tab} onClick={onSave}>Save<span className="sr-only"> {named(job)}</span></button>
            )}
            <button className="btn ghost sm" type="button" tabIndex={tab} onClick={onPass}>Pass…<span className="sr-only"> {named(job)}</span></button>
          </div>
        </div>
      </td>
      <td className="wide">{where}</td>
      <td className="wide"><RowChips job={job} /></td>
      <td className="num wide">{salary}</td>
      <td className="num wide">
        {job.postedAt ? <time dateTime={job.postedAt} title={new Date(job.postedAt).toLocaleDateString("en-GB", { dateStyle: "long" })}>{posted}</time> : posted}
      </td>
      <FitCell job={job} />
    </tr>
  );
}

/**
 * The Fit column header with its explanation: the definition is the header's description (read
 * with it by screen readers), and the "?" button shows it on screen; hover or focus shows it too.
 */
function FitHeader({ sorted }: { sorted: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <th scope="col" className="fit-h" aria-sort={sorted ? "descending" : undefined} aria-describedby={id}>
      <span className="fit-hw" onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}>
        <span>Fit{sorted && <span aria-hidden="true"> ↓</span>}</span>
        <button type="button" className="info" aria-label="What Fit means" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} onBlur={() => setOpen(false)}>?</button>
        <span className={`tip${open ? " open" : ""}`} id={id} role="note">
          How well this job matches your profile and preferences, 0–100. The line under each title says why. A ~ means it may still change: the posting isn't read yet, or a fact needs you.
        </span>
      </span>
    </th>
  );
}

/** The Fit number; "~" and grey while provisional (not read yet, or a fact waits for Kris). */
function FitCell({ job }: { job: FeedJob }) {
  const { fit } = job;
  const note = job.reading === "read" ? (fit.provisional ? "provisional" : "fit") : "not read yet";
  return (
    <td className={`fit${fit.provisional ? " provisional" : ""}`}>
      {fit.provisional && <span aria-hidden="true">~</span>}{fit.value}<small>{note}</small>
    </td>
  );
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "today", "3 days ago", "6 months ago", relative to when the Feed was computed. */
export function ago(iso: string, asOf: string): string {
  const days = Math.floor((new Date(asOf).getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 45) return rtf.format(-days, "day");
  if (days < 365) return rtf.format(-Math.round(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}
