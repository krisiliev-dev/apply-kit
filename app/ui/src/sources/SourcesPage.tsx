// Settings › Sources & watchlist (hi-fi: docs/design/hifi/sources.html). Built so far: health summary,
// failed-source banners with Try now, the job mailbox (status, errors with how to fix them), email
// alerts quiet longer than usual, the sources table, adding a company (AddCompany.tsx), pausing, and
// removing with an impact preview and Undo (RemoveDialog.tsx), each source's normal volume and its
// unusual drop (same banner as the Feed, close with the count, Undo), and coverage checks
// (Coverage.tsx). History charts arrive with their ticket.
import type { CheckRecord, HealthReport, HealthSummary, MailboxHealth, NormalVolume, QuietSource, SourceHealth, UnusualDrop } from "@apply-kit/core";
import { useEffect, useState } from "react";
import { checkAndWait, checkSource, fetchSources, pauseSource, removeSource, resumeSource, undoDecision } from "../api.ts";
import { useToaster } from "../feed/toast.tsx";
import { AddCompany, type Added } from "./AddCompany.tsx";
import { RemoveDialog } from "./RemoveDialog.tsx";
import { CoverageCard, CoveragePage } from "./Coverage.tsx";
import {
  categoryLabel, Chip, clockTime, DropBanner, FailedSourceBanner, failureShort, MailboxBanner, quietText, StatusLine, tryResultText, useConfirmDrop, useTryNow,
} from "../health.tsx";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; report: HealthReport };

export function SourcesPage({ onHealth }: { onHealth: (h: HealthSummary) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = () => setAttempt((n) => n + 1);
  const [said, say] = useState("");
  const { busy, tryNow } = useTryNow(reload, say);
  const [checkingAll, setCheckingAll] = useState(false);
  const [screen, setScreen] = useState<Screen>(screenOf);
  const adding = screen === "add";
  const [removing, setRemoving] = useState<SourceHealth | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const toaster = useToaster();
  const drops = useConfirmDrop(toaster, reload, say);
  const focusRow = (id: string) => () => document.getElementById(rowActId(id))?.focus();
  const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const go = (to: Screen) => {
    setScreen(to);
    window.history.pushState(null, "", screenPath[to]);
  };
  const openAdd = (open: boolean) => go(open ? "add" : "list");
  useEffect(() => {
    const onPop = () => setScreen(screenOf());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const added = ({ id, name, label }: Added) => {
    openAdd(false);
    reload();
    toaster.show({ message: `Added ${name} (${label}) to your watchlist. Checking it now…` });
    checkSource(id)
      .then((r) => toaster.show({ message: r.ok ? tryResultText(r, 0) : `${name} couldn't be checked yet: ${r.error}. It's tried again at the next check.` }))
      .catch((err: unknown) => toaster.show({ message: `Couldn't check ${name}: ${errorText(err)}` }))
      .finally(reload);
  };

  const pause = (s: SourceHealth) => {
    setActing(s.id);
    pauseSource(s.id)
      .then(() => {
        reload();
        toaster.show({
          message: `${s.name} paused. ${s.jobsKept === 0 ? "Nothing closes." : `Its ${s.jobsKept} open ${s.jobsKept === 1 ? "job stays" : "jobs stay"} open, not being checked.`}`,
          undo: () => { resumeSource(s.id).then(reload).catch((err: unknown) => say(`Couldn't resume ${s.name}: ${errorText(err)}`)); },
          returnFocus: focusRow(s.id),
        });
      })
      .catch((err: unknown) => say(`Couldn't pause ${s.name}: ${errorText(err)}`))
      .finally(() => setActing(null));
  };

  const resume = (s: SourceHealth) => {
    setActing(s.id);
    resumeSource(s.id)
      .then(() => { reload(); toaster.show({ message: `${s.name} resumed. It's checked again from the next check.` }); })
      .catch((err: unknown) => say(`Couldn't resume ${s.name}: ${errorText(err)}`))
      .finally(() => setActing(null));
  };

  const remove = (s: SourceHealth, closing: number) => {
    setActing(s.id);
    removeSource(s.id)
      .then(({ decision }) => {
        reload();
        const closed = decision.jobIds.length;
        toaster.show({
          message: closed > 0 ? `${s.name} removed · ${closed} ${closed === 1 ? "job" : "jobs"} closed with "Source removed"` : `${s.name} removed · nothing closed`,
          undo: () => {
            undoDecision(decision.id)
              .then((u) => { reload(); toaster.announce(`Undone. ${s.name} is back on your watchlist${u.jobIds.length ? ` and its ${u.jobIds.length} ${u.jobIds.length === 1 ? "job is" : "jobs are"} open` : ""}.`); })
              .catch((err: unknown) => say(`Couldn't undo: ${errorText(err)}`));
          },
        });
        if (closed !== closing) say(`${closed} closed instead of ${closing}: some changed since the preview.`);
      })
      .catch((err: unknown) => say(`Couldn't remove ${s.name}: ${errorText(err)}`))
      .finally(() => setActing(null));
  };

  useEffect(() => {
    if (screen !== "coverage") document.title = `${adding ? "Add company" : "Sources & watchlist"} · apply-kit`;
  }, [adding, screen]);

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
        {adding && <AddCompany onAdded={added} onCancel={() => openAdd(false)} />}
        {screen === "coverage" && <CoveragePage onClose={() => go("list")} onChanged={reload} />}
        {screen === "list" && load.state === "ready" && (
          <Ready
            report={load.report}
            busy={busy}
            onTry={(s) => tryNow(s.id, s.name, s.jobsKept)}
            checkingAll={checkingAll}
            onCheckAll={() => checkAll(load.report.sources.length)}
            onAdd={() => openAdd(true)}
            onCoverage={() => go("coverage")}
            acting={acting}
            onPause={pause}
            onResume={resume}
            onRemove={setRemoving}
            closingDrop={drops.busy}
            onCloseDrop={drops.confirm}
          />
        )}
        {removing && (
          <RemoveDialog
            source={removing}
            onRemove={(p) => { setRemoving(null); remove(removing, p.closing); }}
            onPause={() => { setRemoving(null); pause(removing); }}
            onCancel={() => { const id = removing.id; setRemoving(null); focusRow(id)(); }}
          />
        )}
        {toaster.element}
      </div>
    </div>
  );
}

interface RowActions {
  acting: string | null;
  onPause: (s: SourceHealth) => void;
  onResume: (s: SourceHealth) => void;
  onRemove: (s: SourceHealth) => void;
}

const rowActId = (sourceId: string) => `remove-${sourceId.replace(/[^a-z0-9_-]/gi, "_")}`;

type Screen = "list" | "add" | "coverage";
const screenPath: Record<Screen, string> = { list: "/settings/sources", add: "/settings/sources/add", coverage: "/settings/sources/coverage" };
const screenOf = (): Screen => {
  const path = window.location.pathname;
  return path === screenPath.add ? "add" : path === screenPath.coverage ? "coverage" : "list";
};

function Ready({ report, busy, onTry, checkingAll, onCheckAll, onAdd, onCoverage, closingDrop, onCloseDrop, ...actions }: {
  report: HealthReport;
  busy: string | null;
  onTry: (s: SourceHealth) => void;
  checkingAll: boolean;
  onCheckAll: () => void;
  onAdd: () => void;
  onCoverage: () => void;
  closingDrop: string | null;
  onCloseDrop: (drop: UnusualDrop) => void;
} & RowActions) {
  const { summary, sources } = report;
  if (sources.length === 0) {
    return (
      <div className="empty">
        <h1>No sources yet</h1>
        <p>Sources are where your jobs come from: company job systems, job sites and alert emails. Add a company by its name or careers link and apply-kit finds its job system. Job sites and alert emails are set in the <code>APPLY_KIT_SOURCES</code> setting (the README lists every type).</p>
        <button className="btn primary" type="button" onClick={onAdd}>Add company</button>
      </div>
    );
  }
  const failing = sources.filter((s) => s.status === "failing").length;
  const unchecked = sources.filter((s) => s.status === "not-checked").length;
  const quiet = summary.quiet;
  const unusual = summary.unusual;
  const paused = sources.filter((s) => s.status === "paused");
  const working = sources.length - failing - unchecked - quiet.length - unusual.length - paused.length;
  const byId = new Map(sources.map((s) => [s.id, s]));
  const mailboxDown = summary.mailbox?.state === "error";

  return (
    <>
      {summary.mailbox && mailboxDown && <MailboxBanner mailbox={summary.mailbox} />}
      {summary.failing.map((f) => (
        <FailedSourceBanner key={f.sourceId} failure={f} busy={busy === f.sourceId} onTry={() => onTry(byId.get(f.sourceId)!)} />
      ))}
      {unusual.map((d) => <DropBanner key={d.sourceId} drop={d} busy={closingDrop === d.sourceId} onClose={() => onCloseDrop(d)} />)}
      <div className="page-head">
        <div className="lead">
          <h1>{headline(sources.length - paused.length, working, failing, quiet.length + unusual.length)}</h1>
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
          <button className="btn primary" type="button" onClick={onAdd}>Add company</button>
        </div>
      </div>
      <div className="board" role="group" aria-label={`Source health summary, ${sources.length} sources`}>
        <div className="tile ok"><span className="n"><TileIcon tone="ok" />{working}</span><span className="l">working: answered at the last check</span></div>
        {failing > 0 && <div className="tile bad"><span className="n"><TileIcon tone="bad" />{failing}</span><span className="l">failing: {summary.failing.map((f) => f.name).join(", ")}</span></div>}
        {quiet.length > 0 && (
          <div className="tile warn">
            <span className="n"><TileIcon tone="warn" />{quiet.length}</span>
            <span className="l">quiet longer than usual: {quiet.map((q) => q.name).join(", ")}</span>
          </div>
        )}
        {unusual.length > 0 && (
          <div className="tile warn">
            <span className="n"><TileIcon tone="warn" />{unusual.length}</span>
            <span className="l">unusual drop: {unusual.map((d) => `${d.name} listed ${d.listed}`).join("; ")}</span>
          </div>
        )}
        {paused.length > 0 && <div className="tile"><span className="n">{paused.length}</span><span className="l">paused: {paused.map((s) => s.name).join(", ")}</span></div>}
        {unchecked > 0 && <div className="tile"><span className="n">{unchecked}</span><span className="l">not checked yet</span></div>}
        {summary.mailbox && <MailboxTile mailbox={summary.mailbox} />}
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
              {sources.map((s) => <SourceRow key={s.id} source={s} busy={busy === s.id} onTry={() => onTry(s)} mailboxDown={mailboxDown} quiet={quiet.find((q) => q.sourceId === s.id)} {...actions} />)}
            </tbody>
          </table>
        </div>
        <p className="table-foot">
          <b>In your locations</b> counts postings in Sofia or remote within Europe at the last good check; the grey number is everything the source listed. A source that fails keeps all its jobs exactly as they were: a failure never closes anything. A job a source stops listing closes with "No longer listed", unless the source is a capped search (Jooble, Reed, EURES, Microsoft, Amazon), which never closes anything that way. <b>Unusual drop</b>: a check listing less than half of a source's usual count keeps every job open; after 2 more checks just as low you're asked to confirm, and only your confirmation closes them (with Undo). <b>Pause</b> stops checking a source and closes nothing; <b>Remove</b> first shows which jobs would close (only those no other source lists) and can be undone. <b>Email alerts</b> are read from the job mailbox (read-only) at each check; each learns its usual rhythm and is flagged when no email arrives for more than 3× its usual gap.
        </p>
      </div>
      <div className="two">
        <CoverageCard onOpen={onCoverage} />
      </div>
    </>
  );
}

/** `unusual`: quiet longer than usual, or in an unusual drop. */
function headline(total: number, working: number, failing: number, unusual: number): string {
  const unusualPart = unusual > 0 ? `${unusual} unusual` : "";
  if (failing > 0) return [`${failing} ${failing === 1 ? "source" : "sources"} failing`, unusualPart].filter(Boolean).join(", ");
  if (unusual > 0) return `${total - unusual} of ${total} sources look normal`;
  if (working === total) return total === 1 ? "Your source is working" : `All ${total} sources working`;
  return `${working} of ${total} sources working`;
}

function SourceRow({ source: s, busy, onTry, mailboxDown, quiet, acting, onPause, onResume, onRemove }: {
  source: SourceHealth;
  busy: boolean;
  onTry: () => void;
  mailboxDown: boolean;
  quiet: QuietSource | undefined;
} & RowActions) {
  const latest = s.history[0];
  const lastGood = s.history.find((c) => c.outcome === "ok");
  const status = s.status === "failing"
    ? <Chip tone="bad">{s.category === "email" && mailboxDown ? "Mailbox not read" : `Failing since ${clockTime(s.failingSince!)}`}</Chip>
    : s.status === "quiet" ? <Chip tone="warn">Quiet longer than usual</Chip>
    : s.status === "unusual" ? <Chip tone="warn">Unusual drop</Chip>
    : s.status === "working" ? <Chip tone="ok">Working</Chip>
    : s.status === "paused" ? <Chip tone="none">Paused</Chip> : <Chip tone="none">Not checked yet</Chip>;
  const lastEmail = s.alerts ? (s.alerts.lastEmailAt ? `email ${clockTime(s.alerts.lastEmailAt)}` : "no email yet") : null;
  const last = !latest ? "Never" : latest.outcome === "ok" ? lastEmail ?? clockTime(latest.at) : `${clockTime(latest.at)} · ${failureShort[latest.outcome]}`;
  return (
    <tr>
      <td>
        <span className="src-name">{s.name}</span>
        <span className="src-id">{s.label} · {s.id.slice(s.kind.length + 1)}</span>
        {quiet && (
          <div className="note quiet-note">
            {quietText(quiet.silentHours, quiet.usualGapHours)} Check the alert is still on, and that the iCloud forward still sends this sender's mail. Its jobs stay open.
          </div>
        )}
        {s.drop && s.status === "unusual" && (
          <div className="note quiet-note">{s.drop.wording.headline} {s.drop.wording.kept}</div>
        )}
        {s.status === "paused" && (
          <div className="note">
            Not being checked. {s.jobsKept === 0 ? "Nothing in your Feed depends on it." : `Its ${s.jobsKept} open ${s.jobsKept === 1 ? "job stays" : "jobs stay"} open.`}
          </div>
        )}
        {s.status === "failing" && s.category === "email" && mailboxDown && (
          <div className="note quiet-note">The job mailbox can't be read; see above for how to fix it. Its jobs stay as they were.</div>
        )}
        {s.status === "failing" && !(s.category === "email" && mailboxDown) && (
          <div className="note quiet-note">
            {failureNote(latest)} {s.jobsKept === 0 ? "Nothing in your Feed depends on it." : `Its ${s.jobsKept} open ${s.jobsKept === 1 ? "job stays" : "jobs stay"} as ${s.jobsKept === 1 ? "it was" : "they were"}.`}
          </div>
        )}
      </td>
      <td>{status}</td>
      <td className="num c-last">{last}</td>
      <td className="r num">
        {lastGood ? <>{lastGood.inLocations}{lastGood.total !== lastGood.inLocations && <span className="total"> of {lastGood.total}</span>}</> : "—"}
        {s.normal && <span className="total usual">{usualText(s.normal)}</span>}
      </td>
      <td className="c-type">{categoryLabel[s.category]}</td>
      <td className="act">
        {(s.status === "failing" || s.status === "quiet" || s.status === "unusual") && (
          <button className="btn sm" type="button" onClick={onTry} disabled={busy}>
            {busy ? "Checking…" : s.category === "email" ? "Check mailbox" : "Try now"}<span className="sr-only">: {s.name}</span>
          </button>
        )}
        {s.status === "paused"
          ? <button className="btn ghost sm" type="button" disabled={acting === s.id} onClick={() => onResume(s)}>Resume<span className="sr-only"> {s.name}</span></button>
          : <button className="btn ghost sm" type="button" disabled={acting === s.id} onClick={() => onPause(s)}>Pause<span className="sr-only"> {s.name}</span></button>}
        <button className="btn ghost sm" type="button" id={rowActId(s.id)} disabled={acting === s.id} onClick={() => onRemove(s)}>Remove…<span className="sr-only"> {s.name}</span></button>
      </td>
    </tr>
  );
}

/** "usually 30–36": what the Source lists per check, all locations. */
function usualText(n: NormalVolume): string {
  return `usually ${n.low === n.high ? n.usual : `${n.low}–${n.high}`}`;
}

function failureNote(c: CheckRecord | undefined): string {
  if (c?.outcome === "timeout") return "No answer within 30 seconds.";
  if (c?.outcome === "rate-limited") return "It asked us to slow down (rate limit).";
  return c?.error ? `${c.error.replace(/\.$/, "")}.` : "";
}

/** The job mailbox at a glance: connected (read-only) with its latest email, or not read. */
function MailboxTile({ mailbox: m }: { mailbox: MailboxHealth }) {
  const word = m.state === "connected" ? "Connected" : m.state === "error" ? "Not read" : "Not read yet";
  const detail = m.state === "error"
    ? `job mailbox · ${m.lastReadAt ? `last read ${clockTime(m.lastReadAt)}` : "never read"}`
    : `job mailbox, read-only · ${m.lastEmailAt ? `last email ${clockTime(m.lastEmailAt)}` : "no alert email yet"}`;
  return (
    <div className={`tile${m.state === "error" ? " bad" : ""}`}>
      <span className="n word">{word}</span>
      <span className="l">{detail}</span>
    </div>
  );
}

function TileIcon({ tone }: { tone: "ok" | "bad" | "warn" }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      {tone === "ok" && <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
      {tone === "bad" && <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
      {tone === "warn" && <><path d="M6 2.2v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="6" cy="9.6" r="1.1" fill="currentColor" /></>}
    </svg>
  );
}
