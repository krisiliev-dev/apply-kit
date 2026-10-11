import type { CheckProgress, FeedResult, FeedSort, FeedView, SchedulerStatus } from "@apply-kit/core";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { checkNow, fetchCheckStatus, fetchFeed, type FeedOptions } from "../api.ts";
import { JobsTable } from "./JobsTable.tsx";
import { PassedClosed } from "./PassedClosed.tsx";
import { receive, settle, showQueued, type ShownFeed } from "./queue.ts";
import { useToaster } from "./toast.tsx";
import { PasteLink } from "./PasteLink.tsx";
import { FailedSourceBanner, MailboxBanner, StatusLine, useTryNow } from "../health.tsx";

const views: [FeedView, string][] = [
  ["new", "New"],
  ["saved", "Saved"],
  ["open", "All open"],
  ["passed", "Passed & closed"],
];

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; feed: FeedResult; rows: ShownFeed };

export function FeedPage({ onHealth }: { onHealth: (h: FeedResult["health"]) => void }) {
  const [view, setView] = useState<FeedView>("new");
  const [options, setOptions] = useState<FeedOptions>({ sort: "fit", relocation: false });
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const check = useCheckStatus();
  const [announcement, setAnnouncement] = useState("");
  const tableRef = useRef<HTMLDivElement>(null);
  const focusAfterShow = useRef<string | null>(null);
  // "Try now" on a failed Source: its jobs join through the queue like any other check's.
  const [nudge, setNudge] = useState(0);
  const [said, say] = useState("");
  const { busy, tryNow } = useTryNow(() => setNudge((n) => n + 1), say);
  const toaster = useToaster();
  const [seenFitHint, dismissFitHint] = useFitHint();

  // After Save, Pass, Undo or Reopen: rows Kris acted on update in place (or come back, for an
  // undo); rows that left the view go; anything else new still waits under the bar.
  const afterTriage = useCallback((touched: string[] = []) => {
    fetchFeed(view, options)
      .then((feed) => {
        setLoad((prev) => prev.state === "ready" ? { state: "ready", feed, rows: settle(prev.rows, feed.jobs, touched) } : prev);
        onHealth(feed.health);
      })
      .catch((err: unknown) => toaster.show({ message: `Couldn't refresh the Feed: ${err instanceof Error ? err.message : String(err)}` }));
  }, [view, options, onHealth, toaster]);

  // A fresh load (first visit, another view, sort or filter, Try again) shows the Feed as it is.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchFeed(view, options, ctrl.signal)
      .then((feed) => { setLoad({ state: "ready", feed, rows: { shown: feed.jobs, queued: [] } }); onHealth(feed.health); })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [view, options, attempt, onHealth]);

  // While a check runs, each finished Source can bring jobs: fetch the Feed again and queue them.
  const { refreshKey } = check;
  useEffect(() => {
    if (refreshKey === null && nudge === 0) return;
    const ctrl = new AbortController();
    fetchFeed(view, options, ctrl.signal)
      .then((feed) => {
        setLoad((prev) => prev.state === "ready" ? { state: "ready", feed, rows: receive(prev.rows, feed.jobs) } : prev);
        onHealth(feed.health);
      })
      .catch(() => { /* the next progress step tries again */ });
    return () => ctrl.abort();
  }, [refreshKey, nudge, view, options, onHealth]);

  // While postings are being read, look again every few seconds so chips fill in place
  // (rows keep their order: receive() only updates rows already on screen).
  const reading = load.state === "ready" && load.rows.shown.some((j) => j.reading === "reading");
  useEffect(() => {
    if (!reading) return;
    const timer = setTimeout(() => setNudge((n) => n + 1), 3_000);
    return () => clearTimeout(timer);
  }, [reading, load]);

  // After "Show them", move focus to the first job that joined so keyboard users land on it.
  useEffect(() => {
    const id = focusAfterShow.current;
    if (!id || load.state !== "ready") return;
    focusAfterShow.current = null;
    tableRef.current?.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(id)}"]`)?.focus();
  }, [load]);

  return <>{content()}{toaster.element}</>;

  function content() {
    if (load.state === "loading") return <p className="meta" role="status">Loading the Feed…</p>;
    if (load.state === "error") {
      return (
        <div className="banner error" role="alert">
          <span className="text"><b>Couldn't reach the apply-kit service.</b> {load.message}. Check that it is running, then try again.</span>
          <button className="btn sm" type="button" onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}>Try again</button>
        </div>
      );
    }

    const { feed, rows } = load;
    if (feed.firstRun) {
      return (
        <section className="stack" style={{ gap: "var(--s-6)" }}>
          <Toolbar feed={feed} view={view} onView={setView} options={options} onOptions={setOptions} />
          <FirstRun />
        </section>
      );
    }

    const showThem = () => {
      const joined = rows.queued.length;
      focusAfterShow.current = rows.queued[0]?.id ?? null;
      setLoad({ state: "ready", feed, rows: { shown: showQueued(rows, feed.jobs), queued: [] } });
      setAnnouncement(`${joined} ${joined === 1 ? "job" : "jobs"} added in order. Your place in the list is kept.`);
    };

    return (
      <section className="stack" style={{ gap: "var(--s-6)" }}>
        {feed.health.mailbox?.state === "error" && <MailboxBanner mailbox={feed.health.mailbox} showHealthLink />}
        {feed.health.failing.map((f) => (
          <FailedSourceBanner
            key={f.sourceId}
            failure={f}
            busy={busy === f.sourceId}
            onTry={() => tryNow(f.sourceId, f.name, f.jobsKept)}
            showHealthLink
          />
        ))}
        <StatusLine message={said} />
        <CheckHead
          check={check}
          title={viewTitle(view, rows.shown.length)}
          subtitle={`${feed.counts.open} open across ${feed.health.sources} ${feed.health.sources === 1 ? "source" : "sources"} · ${view === "passed" ? "latest decision first" : options.sort === "fit" ? "sorted by fit" : "newest first"}`}
          waiting={rows.queued.length}
        />
        <Toolbar feed={feed} view={view} onView={setView} options={options} onOptions={setOptions} />
        {!seenFitHint && view !== "passed" && options.sort === "fit" && rows.shown.length > 0 && (
          <div className="banner info hint">
            <span className="text"><b>New here? Fit</b> is how well a job matches your profile and preferences, 0–100. The grey line under each title says why it ranks there.</span>
            <button className="btn sm" type="button" onClick={dismissFitHint}>Got it</button>
          </div>
        )}
        <div ref={tableRef}>
          {view === "passed"
            ? <PassedClosed feed={{ ...feed, jobs: rows.shown }} toaster={toaster} onChanged={afterTriage} />
            : (
              <JobsTable
                feed={{ ...feed, jobs: rows.shown }}
                view={view}
                sort={options.sort}
                toaster={toaster}
                onChanged={afterTriage}
                queued={rows.queued.length}
                onShowQueued={showThem}
                checking={check.status?.checking != null}
              />
            )}
        </div>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      </section>
    );
  }
}

function viewTitle(view: FeedView, n: number): string {
  const label = { new: "new", saved: "saved", open: "open", passed: "passed or closed" }[view];
  return `${n} ${label}`;
}

interface CheckState {
  status: SchedulerStatus | null;
  error: string | null;
  /** Changes whenever a Source finishes or a check ends; null until a check has been seen. */
  refreshKey: string | null;
  start: () => void;
}

/**
 * Follows the service's checks, scheduled or started here: every 2 s while one runs, every 30 s
 * otherwise so a scheduled check shows up soon after it starts.
 */
function useCheckStatus(): CheckState {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poke, setPoke] = useState(0);
  const running = status?.checking != null;

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => setPoke((n) => n + 1), running ? 2_000 : 30_000);
    fetchCheckStatus(ctrl.signal)
      .then((s) => { setStatus(s); setError(null); })
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err)); });
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [poke, running]);

  const start = useCallback(() => {
    checkNow()
      .then((s) => { setStatus(s); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const c = status?.checking;
  const refreshKey = c ? `${c.startedAt}:${c.done}` : status?.lastCheck ? `done:${status.lastCheck.finishedAt}` : null;
  return { status, error, refreshKey, start };
}

/** The page head: the Feed's title normally, "Checking your sources" with progress during a check. */
function CheckHead({ check, title, subtitle, waiting }: { check: CheckState; title: string; subtitle: string; waiting: number }) {
  const { status, error, start } = check;
  const running = status?.checking ?? null;
  const last = status?.lastCheck ?? null;
  const waitingText = waiting > 0 ? `, ${waiting} waiting under the bar` : "";

  // Announced politely: changes only when a Source finishes or the check ends, never on the clock.
  let announced = "";
  if (error) announced = `Couldn't get the check status: ${error}`;
  else if (running) announced = `Checked ${running.done} of ${running.total} ${plural(running.total, "source")} · ${running.newJobs} new ${plural(running.newJobs, "job")} so far${waitingText}`;
  else if (last) announced = finishedText(last, waitingText);

  return (
    <div className="progress-head">
      <div className="page-head">
        <div className="lead">
          <h1>{running ? "Checking your sources" : title}</h1>
          <p className="meta">
            {!running && <>{subtitle}{announced && " · "}</>}
            <span role="status" aria-live="polite">{announced}</span>
            {running && ` · ${timeLeft(running)}`}
          </p>
        </div>
        <span className="grow" />
        <button className="btn sm" type="button" onClick={start} disabled={running !== null}>
          {running ? "Checking…" : "Check now"}
        </button>
      </div>
      {running && (
        <div
          className="meter"
          role="progressbar"
          aria-label="Sources checked"
          aria-valuemin={0}
          aria-valuemax={running.total}
          aria-valuenow={running.done}
          aria-valuetext={`${running.done} of ${running.total} ${plural(running.total, "source")}`}
        >
          <span style={{ width: `${running.total ? Math.round((running.done / running.total) * 100) : 0}%` }} />
        </div>
      )}
    </div>
  );
}

function finishedText(last: NonNullable<SchedulerStatus["lastCheck"]>, waitingText: string): string {
  const ok = last.sources.filter((s) => s.ok);
  const fresh = ok.reduce((n, s) => n + (s.ok ? s.newPostings : 0), 0);
  const total = last.sources.length;
  const failed = total - ok.length;
  const note = failed === 0 ? "" : ` · ${failed} failed, ${failed === 1 ? "its" : "their"} jobs kept as they were`;
  const at = new Date(last.finishedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `Check finished at ${at} · ${ok.length} of ${total} ${plural(total, "source")} · ${fresh} new ${plural(fresh, "job")}${note}${waitingText}`;
}

/** "about 40 seconds left", "about 2 minutes left"; refreshed with each status poll. */
function timeLeft(p: CheckProgress): string {
  if (!p.estimatedEndAt) return "estimating time left";
  const ms = new Date(p.estimatedEndAt).getTime() - Date.now();
  if (ms < 5_000) return "almost done";
  if (ms < 60_000) return `about ${Math.ceil(ms / 5_000) * 5} seconds left`;
  const min = Math.round(ms / 60_000);
  return `about ${min} ${plural(min, "minute")} left`;
}

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

function Toolbar({ feed, view, onView, options, onOptions }: {
  feed: FeedResult;
  view: FeedView;
  onView: (v: FeedView) => void;
  options: FeedOptions;
  onOptions: (o: FeedOptions) => void;
}) {
  const { counts, ranking } = feed;
  const ranked = view !== "passed";
  return (
    <div className="toolbar">
      <div className="segmented" role="group" aria-label="View">
        {views.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={view === key} onClick={() => onView(key)}>
            {label} <span className="num">{counts[key]}</span>
          </button>
        ))}
      </div>
      <button className="filter" type="button" aria-pressed="false">
        Hidden <span className="n num">{counts.hidden}</span>
      </button>
      {ranked && (
        <>
          <span className="sep" aria-hidden="true" />
          <button
            className="filter"
            type="button"
            aria-pressed={options.relocation}
            aria-describedby="relocation-why"
            onClick={() => onOptions({ ...options, relocation: !options.relocation })}
          >
            Relocation <span className="n num">{counts.relocation}</span>
          </button>
          <span className="sr-only" id="relocation-why">Jobs in Switzerland or Spain, a separate, lower-priority list shown after the others.</span>
        </>
      )}
      <span className="end">
        <span className="meta">
          {ranking.learnedAdjustments === 0 ? "Ranking: nothing learned yet" : `Ranking: ${ranking.learnedAdjustments} learned adjustments`}
        </span>
        {ranked && <SortMenu sort={options.sort} onSort={(sort) => onOptions({ ...options, sort })} />}
        {!feed.firstRun && <AddJobMenu />}
      </span>
    </div>
  );
}

const sortLabels: Record<FeedSort, string> = { fit: "best fit", newest: "newest" };

/** "Sort: best fit ▾" with its two choices (Feed hi-fi). Escape or a click elsewhere closes it. */
function SortMenu({ sort, onSort }: { sort: FeedSort; onSort: (s: FeedSort) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <span
      className="pop-wrap"
      ref={wrap}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); wrap.current?.querySelector<HTMLElement>("button")?.focus(); } }}
    >
      <button className="filter" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        Sort: {sortLabels[sort]}<span aria-hidden="true"> ▾</span>
      </button>
      <span className="pop end-align" id={id} hidden={!open}>
        {(Object.keys(sortLabels) as FeedSort[]).map((s) => (
          <button key={s} type="button" aria-pressed={s === sort} onClick={() => { onSort(s); setOpen(false); }}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            {sortLabels[s]}
          </button>
        ))}
      </span>
    </span>
  );
}

/** The one-time "New here? Fit is…" hint; remembered in this browser once dismissed. */
function useFitHint(): [boolean, () => void] {
  const key = "apply-kit:fit-hint-seen";
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const dismiss = useCallback(() => {
    setSeen(true);
    try { localStorage.setItem(key, "1"); } catch { /* private window: the hint comes back next time */ }
  }, []);
  return [seen, dismiss];
}

function FirstRun() {
  return (
    <div className="empty">
      <svg viewBox="0 0 120 48" width="120" height="48" aria-hidden="true"><path d="M2 46 32 12l18 20 14-14 26 28z" fill="var(--met-soft)" stroke="var(--action)" strokeWidth="2" strokeLinejoin="round" /><circle cx="96" cy="10" r="5" fill="var(--bloom)" /></svg>
      <h1>Your feed fills up once sources are connected</h1>
      <p>Pick companies from the Sofia watchlist and connect your job mailbox. The first check takes about a minute, and new jobs wait under a bar until you choose to show them.</p>
      <div className="row">
        <a className="btn primary" href="/settings/sources">Choose companies</a>
        <a className="btn" href="/settings/mailbox">Connect mailbox</a>
      </div>
      <div className="paste-first">
        <PasteLink label="Or start with one job" />
      </div>
    </div>
  );
}

/** The toolbar's "Add job": the paste-a-link field in a popover. Escape or a click elsewhere closes it. */
function AddJobMenu() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <span
      className="pop-wrap"
      ref={wrap}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); wrap.current?.querySelector<HTMLElement>("button")?.focus(); } }}
    >
      <button className="filter" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        Add job<span aria-hidden="true"> ▾</span>
      </button>
      <span className="pop end-align add-job-pop" id={id} hidden={!open}>
        {open && <PasteLink label="Paste a job link" autoFocus />}
      </span>
    </span>
  );
}
