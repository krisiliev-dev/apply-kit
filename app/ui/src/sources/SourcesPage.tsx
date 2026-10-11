// Settings › Sources & watchlist (hi-fi: docs/design/hifi/sources.html). Built so far: health summary,
// failed-source banners with Try now, and the sources table. Normal volume, history charts, adding
// companies, coverage checks and the mailbox arrive with their tickets.
import type { CheckRecord, HealthReport, HealthSummary, SourceHealth } from "@apply-kit/core";
import { useEffect, useState } from "react";
import { checkAndWait, fetchSources } from "../api.ts";
import { categoryLabel, Chip, clockTime, FailedSourceBanner, failureShort, StatusLine, useTryNow } from "../health.tsx";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; report: HealthReport };

export function SourcesPage({ onHealth }: { onHealth: (h: HealthSummary) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = () => setAttempt((n) => n + 1);
  const [said, say] = useState("");
  const { busy, tryNow } = useTryNow(reload, say);
  const [checkingAll, setCheckingAll] = useState(false);

  useEffect(() => { document.title = "Sources & watchlist · apply-kit"; }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal)
      .then((report) => { setLoad({ state: "ready", report }); onHealth(report.summary); })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [attempt, onHealth]);

  const checkAll = (count: number) => {
    setCheckingAll(true);
    say(`Checking all ${count} sources…`);
    checkAndWait()
      .then((r) => {
        const failed = r.sources.filter((s) => !s.ok).length;
        say(failed === 0
          ? `Check finished: all ${r.sources.length} sources working.`
          : `Check finished: ${failed} of ${r.sources.length} failed. Their jobs are kept as they were.`);
        reload();
      })
      .catch((err: unknown) => say(`Couldn't run the check: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setCheckingAll(false));
  };

  return (
    <div className="set">
      <nav className="rail" aria-label="Settings sections">
        <span className="rail-h">Settings</span>
        <a href="/settings/sources" aria-current="page">Sources &amp; watchlist</a>
        <a href="/settings/mailbox">Mailbox</a>
        <a href="/settings/model">Model &amp; budget</a>
        <a href="/settings/data">Data &amp; privacy</a>
      </nav>
      <div className="stack" style={{ gap: "var(--s-6)" }}>
        <StatusLine message={said} />
        {load.state === "loading" && <p className="meta">Loading sources…</p>}
        {load.state === "error" && (
          <div className="banner error" role="alert">
            <span className="text"><b>Couldn't reach the apply-kit service.</b> {load.message}. Check that it is running, then try again.</span>
            <button className="btn sm" type="button" onClick={() => { setLoad({ state: "loading" }); reload(); }}>Try again</button>
          </div>
        )}
        {load.state === "ready" && (
          <Ready
            report={load.report}
            busy={busy}
            onTry={(s) => tryNow(s.id, s.name, s.jobsKept)}
            checkingAll={checkingAll}
            onCheckAll={() => checkAll(load.report.sources.length)}
          />
        )}
      </div>
    </div>
  );
}

function Ready({ report, busy, onTry, checkingAll, onCheckAll }: {
  report: HealthReport;
  busy: string | null;
  onTry: (s: SourceHealth) => void;
  checkingAll: boolean;
  onCheckAll: () => void;
}) {
  const { summary, sources } = report;
  if (sources.length === 0) {
    return (
      <div className="empty">
        <h1>No sources yet</h1>
        <p>Sources are where your jobs come from: company job systems, job sites and alert emails. Until adding companies here is built, list them in the <code>APPLY_KIT_SOURCES</code> setting (for example <code>greenhouse:payhawkio</code>) and restart apply-kit.</p>
      </div>
    );
  }
  const failing = sources.filter((s) => s.status === "failing").length;
  const unchecked = sources.filter((s) => s.status === "not-checked").length;
  const working = sources.length - failing - unchecked;
  const byId = new Map(sources.map((s) => [s.id, s]));

  return (
    <>
      {summary.failing.map((f) => (
        <FailedSourceBanner key={f.sourceId} failure={f} busy={busy === f.sourceId} onTry={() => onTry(byId.get(f.sourceId)!)} />
      ))}
      <div className="page-head">
        <div className="lead">
          <h1>{headline(sources.length, working, failing)}</h1>
          <p className="meta">
            {summary.lastCheckAt ? `Last check ${clockTime(summary.lastCheckAt)}` : "Not checked yet"}
            {" · "}checked when you press Check now; automatic checks arrive soon
          </p>
        </div>
        <span className="grow" />
        <div className="row">
          <button className="btn" type="button" onClick={onCheckAll} disabled={checkingAll}>
            {checkingAll ? "Checking…" : "Check all now"}
          </button>
        </div>
      </div>
      <div className="board" role="group" aria-label={`Source health summary, ${sources.length} sources`}>
        <div className="tile ok"><span className="n"><TileIcon tone="ok" />{working}</span><span className="l">working: answered at the last check</span></div>
        {failing > 0 && <div className="tile bad"><span className="n"><TileIcon tone="bad" />{failing}</span><span className="l">failing: {summary.failing.map((f) => f.name).join(", ")}</span></div>}
        {unchecked > 0 && <div className="tile"><span className="n">{unchecked}</span><span className="l">not checked yet</span></div>}
      </div>
      <div className="panel flush">
        <div className="table-wrap">
          <table className="table" aria-label="Sources and watchlist">
            <thead>
              <tr>
                <th scope="col">Company / source</th>
                <th scope="col">Status</th>
                <th scope="col" className="c-last">Last check</th>
                <th scope="col" className="r">In your locations</th>
                <th scope="col" className="c-type">Type</th>
                <th scope="col" className="act"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => <SourceRow key={s.id} source={s} busy={busy === s.id} onTry={() => onTry(s)} />)}
            </tbody>
          </table>
        </div>
        <p className="table-foot">
          <b>In your locations</b> counts postings in Sofia or remote within Europe at the last good check; the grey number is everything the source listed. A source that fails keeps all its jobs exactly as they were: a failure never closes anything.
        </p>
      </div>
    </>
  );
}

function headline(total: number, working: number, failing: number): string {
  if (failing > 0) return `${failing} ${failing === 1 ? "source" : "sources"} failing`;
  if (working === total) return total === 1 ? "Your source is working" : `All ${total} sources working`;
  return `${working} of ${total} sources working`;
}

function SourceRow({ source: s, busy, onTry }: { source: SourceHealth; busy: boolean; onTry: () => void }) {
  const latest = s.history[0];
  const lastGood = s.history.find((c) => c.outcome === "ok");
  const status = s.status === "failing"
    ? <Chip tone="bad">Failing since {clockTime(s.failingSince!)}</Chip>
    : s.status === "working" ? <Chip tone="ok">Working</Chip> : <Chip tone="none">Not checked yet</Chip>;
  const last = !latest ? "Never" : latest.outcome === "ok" ? clockTime(latest.at) : `${clockTime(latest.at)} · ${failureShort[latest.outcome]}`;
  return (
    <tr>
      <td>
        <span className="src-name">{s.name}</span>
        <span className="src-id">{s.kind[0]!.toUpperCase() + s.kind.slice(1)} · {s.id.slice(s.kind.length + 1)}</span>
        {s.status === "failing" && (
          <div className="note quiet-note">
            {failureNote(latest)} {s.jobsKept === 0 ? "Nothing in your Feed depends on it." : `Its ${s.jobsKept} open ${s.jobsKept === 1 ? "job stays" : "jobs stay"} as ${s.jobsKept === 1 ? "it was" : "they were"}.`}
          </div>
        )}
      </td>
      <td>{status}</td>
      <td className="num c-last">{last}</td>
      <td className="r num">
        {lastGood ? <>{lastGood.inLocations}{lastGood.total !== lastGood.inLocations && <span className="total"> of {lastGood.total}</span>}</> : "—"}
      </td>
      <td className="c-type">{categoryLabel[s.category]}</td>
      <td className="act">
        {s.status === "failing" && (
          <button className="btn sm" type="button" onClick={onTry} disabled={busy}>
            {busy ? "Trying…" : "Try now"}<span className="sr-only">: {s.name}</span>
          </button>
        )}
      </td>
    </tr>
  );
}

function failureNote(c: CheckRecord | undefined): string {
  if (c?.outcome === "timeout") return "No answer within 30 seconds.";
  if (c?.outcome === "rate-limited") return "It asked us to slow down (rate limit).";
  return c?.error ? `${c.error.replace(/\.$/, "")}.` : "";
}

function TileIcon({ tone }: { tone: "ok" | "bad" }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      {tone === "ok"
        ? <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        : <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}
