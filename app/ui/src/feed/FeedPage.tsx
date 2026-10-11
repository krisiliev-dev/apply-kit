import type { CheckProgress, FeedJob, FeedResult, FeedView, SchedulerStatus } from "@apply-kit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkNow, fetchCheckStatus, fetchFeed } from "../api.ts";
import { receive, showQueued, type ShownFeed } from "./queue.ts";
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

  // A fresh load (first visit, another view, Try again) shows the Feed as it is.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchFeed(view, ctrl.signal)
      .then((feed) => { setLoad({ state: "ready", feed, rows: { shown: feed.jobs, queued: [] } }); onHealth(feed.health); })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [view, attempt, onHealth]);

  // While a check runs, each finished Source can bring jobs: fetch the Feed again and queue them.
  const { refreshKey } = check;
  useEffect(() => {
    if (refreshKey === null && nudge === 0) return;
    const ctrl = new AbortController();
    fetchFeed(view, ctrl.signal)
      .then((feed) => {
        setLoad((prev) => prev.state === "ready" ? { state: "ready", feed, rows: receive(prev.rows, feed.jobs) } : prev);
        onHealth(feed.health);
      })
      .catch(() => { /* the next progress step tries again */ });
    return () => ctrl.abort();
  }, [refreshKey, nudge, view, onHealth]);

  // After "Show them", move focus to the first job that joined so keyboard users land on it.
  useEffect(() => {
    const id = focusAfterShow.current;
    if (!id || load.state !== "ready") return;
    focusAfterShow.current = null;
    tableRef.current?.querySelector<HTMLAnchorElement>(`tr[data-id="${CSS.escape(id)}"] a`)?.focus();
  }, [load]);

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
        <Toolbar feed={feed} view={view} onView={setView} />
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
        subtitle={`${feed.counts.open} open across ${feed.health.sources} ${feed.health.sources === 1 ? "source" : "sources"} · newest first`}
        waiting={rows.queued.length}
      />
      <Toolbar feed={feed} view={view} onView={setView} />
      <div ref={tableRef}>
        <JobsTable jobs={rows.shown} queued={rows.queued.length} onShowQueued={showThem} asOf={feed.asOf} view={view} checking={check.status?.checking != null} />
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </section>
  );
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

interface JobsTableProps {
  jobs: FeedJob[];
  queued: number;
  onShowQueued: () => void;
  asOf: string;
  view: FeedView;
  checking: boolean;
}

function JobsTable({ jobs, queued, onShowQueued, asOf, view, checking }: JobsTableProps) {
  if (jobs.length === 0) {
    return (
      <div className="empty">
        <h2>Nothing here yet</h2>
        <p>
          {checking ? "Jobs appear here as each source finishes." : view === "new" ? "No new jobs. Run a check to look again." : "No jobs in this view yet."}
        </p>
      </div>
    );
  }
  return (
    <div className="panel flush">
      {queued > 0 && (
        <div className="queue">
          <span>{queued} new {queued === 1 ? "job" : "jobs"} found</span>
          <button className="btn sm" type="button" onClick={onShowQueued}>Show them</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table jobs" aria-label="Jobs, newest first">
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col" className="wide">Where</th>
              <th scope="col" className="wide">Salary</th>
              <th scope="col" className="wide" aria-sort="descending">Posted</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => <JobRow key={j.id} job={j} asOf={asOf} />)}
          </tbody>
        </table>
      </div>
      <div className="foot">
        {checking
          ? <span>More appear as sources finish. They wait under the bar above, so nothing moves while you work.</span>
          : <span className="num">Showing {jobs.length} of {jobs.length + queued}</span>}
      </div>
    </div>
  );
}

function JobRow({ job, asOf }: { job: FeedJob; asOf: string }) {
  const where = job.location ?? "Location not stated";
  const salary = job.salary ?? "Not stated";
  const posted = job.postedAt ? ago(job.postedAt, asOf) : "Unknown";
  return (
    <tr data-id={job.id}>
      <td className="job">
        <a className="t" href={job.url} target="_blank" rel="noopener noreferrer">
          {job.title}<span className="sr-only"> (opens the posting in a new tab)</span>
        </a>
        <span className="co">{job.company}</span>
        {job.postingCount > 1 && <span className="meta"> · seen in {job.postingCount} postings</span>}
        <span className="narrow meta">{where} · {salary} · {posted}</span>
      </td>
      <td className="wide">{where}</td>
      <td className="num wide">{salary}</td>
      <td className="num wide">
        {job.postedAt ? <time dateTime={job.postedAt} title={new Date(job.postedAt).toLocaleDateString("en-GB", { dateStyle: "long" })}>{posted}</time> : posted}
      </td>
    </tr>
  );
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "today", "3 days ago", "6 months ago", relative to when the Feed was computed. */
function ago(iso: string, asOf: string): string {
  const days = Math.floor((new Date(asOf).getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 45) return rtf.format(-days, "day");
  if (days < 365) return rtf.format(-Math.round(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}

function Toolbar({ feed, view, onView }: { feed: FeedResult; view: FeedView; onView: (v: FeedView) => void }) {
  const { counts, ranking } = feed;
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
      <span className="end">
        <span className="meta">
          {ranking.learnedAdjustments === 0 ? "Ranking: nothing learned yet" : `Ranking: ${ranking.learnedAdjustments} learned adjustments`}
        </span>
      </span>
    </div>
  );
}

function FirstRun() {
  const [note, setNote] = useState("");
  return (
    <div className="empty">
      <svg viewBox="0 0 120 48" width="120" height="48" aria-hidden="true"><path d="M2 46 32 12l18 20 14-14 26 28z" fill="var(--met-soft)" stroke="var(--action)" strokeWidth="2" strokeLinejoin="round" /><circle cx="96" cy="10" r="5" fill="var(--bloom)" /></svg>
      <h1>Your feed fills up once sources are connected</h1>
      <p>Pick companies from the Sofia watchlist and connect your job mailbox. The first check takes about a minute, and new jobs wait under a bar until you choose to show them.</p>
      <div className="row">
        <a className="btn primary" href="/settings/sources">Choose companies</a>
        <a className="btn" href="/settings/mailbox">Connect mailbox</a>
      </div>
      <form
        className="field"
        style={{ width: "min(460px, 100%)" }}
        onSubmit={(e) => { e.preventDefault(); setNote("Adding a job from a link isn't available yet."); }}
      >
        <label htmlFor="paste-job">Or start with one job</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input className="input" id="paste-job" name="job-link" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="Paste a job link…" />
          <button className="btn" type="submit">Add</button>
        </div>
        <p className="meta" role="status">{note}</p>
      </form>
    </div>
  );
}
