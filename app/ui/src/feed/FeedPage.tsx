import type { CheckResult, FeedResult, FeedView } from "@apply-kit/core";
import { useCallback, useEffect, useState } from "react";
import { checkNow, fetchFeed } from "../api.ts";
import { JobsTable } from "./JobsTable.tsx";
import { PassedClosed } from "./PassedClosed.tsx";
import { useToaster } from "./toast.tsx";

const views: [FeedView, string][] = [
  ["new", "New"],
  ["saved", "Saved"],
  ["open", "All open"],
  ["passed", "Passed & closed"],
];

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; feed: FeedResult };

export function FeedPage({ onHealth }: { onHealth: (h: FeedResult["health"]) => void }) {
  const [view, setView] = useState<FeedView>("new");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const toaster = useToaster();
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchFeed(view, ctrl.signal)
      .then((feed) => { setLoad({ state: "ready", feed }); onHealth(feed.health); })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [view, attempt, onHealth]);

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

  const { feed } = load;
  if (feed.firstRun) {
    return (
      <section className="stack" style={{ gap: "var(--s-6)" }}>
        <Toolbar feed={feed} view={view} onView={setView} />
        <FirstRun />
      </section>
    );
  }
  return (
    <section className="stack" style={{ gap: "var(--s-6)" }}>
      <div className="page-head">
        <div className="lead">
          <h1>{viewTitle(view, feed)}</h1>
          <p className="meta">
            {feed.counts.open} open across {feed.health.sources} {feed.health.sources === 1 ? "source" : "sources"} · newest first
          </p>
        </div>
        <span className="grow" />
        <CheckNow onChecked={refresh} />
      </div>
      <Toolbar feed={feed} view={view} onView={setView} />
      {view === "passed"
        ? <PassedClosed feed={feed} toaster={toaster} onChanged={refresh} />
        : <JobsTable feed={feed} view={view} toaster={toaster} onChanged={refresh} />}
    </section>
  );
  }
}

function viewTitle(view: FeedView, feed: FeedResult): string {
  const n = feed.jobs.length;
  const label = { new: "new", saved: "saved", open: "open", passed: "passed or closed" }[view];
  return `${n} ${label}`;
}

type Check = { state: "idle" } | { state: "checking" } | { state: "done"; result: CheckResult } | { state: "error"; message: string };

function CheckNow({ onChecked }: { onChecked: () => void }) {
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const run = () => {
    setCheck({ state: "checking" });
    checkNow()
      .then((result) => { setCheck({ state: "done", result }); onChecked(); })
      .catch((err: unknown) => setCheck({ state: "error", message: err instanceof Error ? err.message : String(err) }));
  };
  const failed = check.state === "done" ? check.result.sources.filter((s) => !s.ok) : [];
  return (
    <div className="row" style={{ alignItems: "center" }}>
      <p className="meta" role="status" aria-live="polite">
        {check.state === "checking" && "Checking your sources…"}
        {check.state === "done" && summary(check.result)}
        {check.state === "error" && `Couldn't run the check: ${check.message}`}
      </p>
      {failed.length > 0 && (
        <p className="meta" role="alert">
          {failed.map((s) => `${s.name}: ${s.ok ? "" : s.error}. Its jobs are kept as they were.`).join(" ")}
        </p>
      )}
      <button className="btn sm" type="button" onClick={run} disabled={check.state === "checking"}>
        {check.state === "checking" ? "Checking…" : "Check now"}
      </button>
    </div>
  );
}

function summary(result: CheckResult): string {
  const ok = result.sources.filter((s) => s.ok);
  const found = ok.reduce((n, s) => n + (s.ok ? s.found : 0), 0);
  const fresh = ok.reduce((n, s) => n + (s.ok ? s.newPostings : 0), 0);
  const total = result.sources.length;
  return `Checked ${ok.length} of ${total} ${total === 1 ? "source" : "sources"} · ${found} jobs listed, ${fresh} new`;
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
