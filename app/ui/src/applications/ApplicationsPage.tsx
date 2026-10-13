// Applications (hi-fi: docs/design/hifi/applications.html, states Normal, One application, No
// applications and Add application): the page head with Add application, the first-run empty state,
// and every Application grouped by Status. Interviewing, Screening, Offer and Applied start open;
// Closed starts collapsed and is never deleted. Each row has a labelled Status select: a change is an
// Event "by you" with a 10-second (or longer) undo toast. A row's title opens its Application page.
// Stats, Needs you, search and filters come with later Track tickets.
import type { ApplicationGroup, ApplicationList, ApplicationSummary, GroupKey, HealthSummary, Status } from "@apply-kit/core";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { fetchApplications, fetchSources, setApplicationStatus, undoApplicationEvent } from "../api.ts";
import { useToaster } from "../feed/toast.tsx";
import { Chevron } from "../icons.tsx";
import { AddApplicationDialog, type Added } from "./AddApplicationDialog.tsx";
import { angleLabel, eventTime, shortDay, statusLabel, statusOrder } from "./words.ts";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; list: ApplicationList };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const named = (a: ApplicationSummary) => `${a.title} at ${a.company}`;
const selectId = (id: string) => `st-${id}`;
const rowId = (id: string) => `app-${id}`;
/** Bulgarian titles are marked as such, so screen readers read them in Bulgarian. */
const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);
/** Groups that show 5 until asked for the rest. */
const limited: GroupKey[] = ["applied", "closed"];

export function ApplicationsPage({ onHealth }: { onHealth: (h: HealthSummary) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [all, setAll] = useState<GroupKey[]>([]);
  const [expanded, setExpanded] = useState<Partial<Record<GroupKey, boolean>>>({});
  const [adding, setAdding] = useState(false);
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the next list has rendered (the button it targets may be a new one). */
  const focusNext = useRef<(() => void) | null>(null);
  const toaster = useToaster();

  useEffect(() => {
    const f = focusNext.current;
    focusNext.current = null;
    f?.();
  }, [load]);

  useEffect(() => { document.title = "Applications · apply-kit"; }, []);

  // The top bar shows source health on every screen.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchApplications(all, ctrl.signal)
      .then((list) => setLoad({ state: "ready", list }))
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setLoad({ state: "error", message: message(err) }); });
    return () => ctrl.abort();
  }, [all, attempt]);

  const refresh = useCallback(async (show: GroupKey[] = all) => {
    const list = await fetchApplications(show);
    setLoad({ state: "ready", list });
    return list;
  }, [all]);

  /** Moves focus to an Application's Status select, or to its group's heading when its row isn't shown. */
  const focusApplication = useCallback((id: string, group?: GroupKey) => {
    requestAnimationFrame(() => {
      const select = document.getElementById(selectId(id));
      if (select && select.offsetParent !== null) select.focus();
      else if (group) document.getElementById(`g-${group}-h`)?.focus();
    });
  }, []);

  /** Shows one Application (a link to it, or one that already exists): its group opened in full, its row marked. */
  const reveal = useCallback(async (id: string) => {
    const show = [...new Set([...all, ...limited])];
    const list = await refresh(show);
    setAll(show);
    const group = list.groups.find((g) => g.applications.some((a) => a.id === id));
    if (!group) return;
    setExpanded((e) => ({ ...e, [group.key]: true }));
    setHighlight(id);
    requestAnimationFrame(() => {
      document.getElementById(rowId(id))?.scrollIntoView({ block: "center" });
      focusApplication(id, group.key);
    });
  }, [all, refresh, focusApplication]);

  // A link to one Application (#app-<id>), as "Add application" gives when one is already open.
  useEffect(() => {
    const fromHash = () => {
      const m = /^#app-(.+)$/.exec(window.location.hash);
      if (m) reveal(decodeURIComponent(m[1]!)).catch(() => {});
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // Only on arrival and on later hash changes, not each time `reveal` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupOf = (list: ApplicationList, id: string) => list.groups.find((g) => g.applications.some((a) => a.id === id))?.key;

  /** Applies a Status change; resolves false when it was refused (the list then shows the Status the service has). */
  async function changeStatus(app: ApplicationSummary, to: Status): Promise<boolean> {
    try {
      const { event } = await setApplicationStatus(app.id, to);
      const list = await refresh();
      const group = groupOf(list, app.id) ?? (to === "rejected" || to === "withdrawn" ? "closed" : (to as GroupKey));
      focusApplication(app.id, group);
      toaster.show({
        message: `${app.company}: ${statusLabel[app.status]} → ${statusLabel[to]}. Logged by you.`,
        returnFocus: () => focusApplication(app.id, group),
        undo: () => {
          undoApplicationEvent(event.id)
            .then(() => refresh())
            .then((after) => {
              focusApplication(app.id, groupOf(after, app.id));
              toaster.announce(`Undone. Back to ${statusLabel[app.status]}.`);
            })
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
      });
      return true;
    } catch (err) {
      await refresh().catch(() => {});
      focusApplication(app.id);
      toaster.show({ message: `Couldn't change the Status: ${message(err)}` });
      return false;
    }
  }

  function added(result: Added) {
    setAdding(false);
    setLinkProblem(result.linkProblem);
    const a = result.application;
    refresh()
      .then((list) => {
        const group = groupOf(list, a.id);
        if (group) focusApplication(a.id, group);
        else addRef.current?.focus();
      })
      .catch(() => addRef.current?.focus());
    toaster.show({
      message: `Added · ${named(a)}, ${statusLabel[a.status]} ${shortDay(a.appliedOn)}.`,
      returnFocus: () => (document.getElementById(selectId(a.id)) ?? addRef.current)?.focus(),
      undo: () => {
        undoApplicationEvent(result.event.id)
          .then(() => { focusNext.current = () => addRef.current?.focus(); return refresh(); })
          .then(() => { setLinkProblem(null); toaster.announce("Removed again."); })
          .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
      },
    });
  }

  const dialog = adding && (
    <AddApplicationDialog
      onAdded={added}
      onCancel={() => { setAdding(false); addRef.current?.focus(); }}
      onOpenExisting={(a) => { setAdding(false); reveal(a.id).catch(() => {}); }}
    />
  );

  if (load.state === "loading") return <p className="meta" role="status">Loading applications…</p>;
  if (load.state === "error") {
    return (
      <div className="banner error" role="alert">
        <span className="text"><b>Couldn't reach the apply-kit service.</b> {load.message}. Check that it is running, then try again.</span>
        <button className="btn sm" type="button" onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}>Try again</button>
      </div>
    );
  }

  const { list } = load;

  if (list.total === 0) {
    return (
      <>
        <div className="empty">
          <svg viewBox="0 0 120 48" width="120" height="48" aria-hidden="true"><path d="M2 46 32 12l18 20 14-14 26 28z" fill="var(--met-soft)" stroke="var(--action)" strokeWidth="2" strokeLinejoin="round" /><circle cx="96" cy="10" r="5" fill="var(--bloom)" /></svg>
          <h1>No applications yet</h1>
          <p>
            An Application appears here when you press <b>I applied without apply-kit…</b> on a Job, or add one by hand.
            Once packages arrive, marking one submitted adds it too. Each Application keeps its Status, and every change is logged with who made it.
          </p>
          <div className="row">
            <a className="btn primary" href="/">Find a job in the Feed</a>
            <button className="btn" type="button" ref={addRef} onClick={() => setAdding(true)}>Add an application from before</button>
          </div>
          <p className="meta">Applied somewhere before apply-kit? Add it so it's tracked with the rest.</p>
        </div>
        {dialog}
        {toaster.element}
      </>
    );
  }

  const isOpen = (g: ApplicationGroup) => expanded[g.key] ?? g.open;
  const toggle = (g: ApplicationGroup) => setExpanded((e) => ({ ...e, [g.key]: !isOpen(g) }));
  const showMore = (g: ApplicationGroup) => {
    const shown = g.applications.length;
    setAll((a) => [...new Set([...a, g.key])]);
    toaster.announce(`${g.count - shown} more ${g.label} applications shown.`);
    // Focus the first row that was hidden, once it's there.
    const wait = (tries: number) => requestAnimationFrame(() => {
      const rows = document.querySelectorAll<HTMLElement>(`#g-${g.key} tbody tr`);
      const next = rows[shown]?.querySelector<HTMLElement>("select");
      if (next) next.focus();
      else if (tries > 0) setTimeout(() => wait(tries - 1), 50);
    });
    wait(40);
  };

  return (
    <section className="stack" style={{ gap: "var(--s-7)" }}>
      <div className="page-head">
        <div className="lead">
          <h1>Applications</h1>
          <p className="meta">{list.total} since {list.since ? shortDay(list.since) : "today"} · {list.open} open</p>
        </div>
        <span className="grow" />
        <button className="btn" type="button" ref={addRef} onClick={() => setAdding(true)}>Add application</button>
      </div>

      {linkProblem && (
        <div className="banner warning">
          <span className="text">{linkProblem}</span>
          <button className="btn sm" type="button" onClick={() => { setLinkProblem(null); addRef.current?.focus(); }}>Dismiss</button>
        </div>
      )}

      {list.total === 1 && (
        <div className="calm">
          <h2 className="sr-only">Needs you</h2>
          <h3>Nothing needs you yet</h3>
          <p className="muted">Your first Application is in. Change its Status from the list whenever you hear back; every change is logged and can be undone.</p>
        </div>
      )}

      <section className="panel flush" aria-labelledby="apps-h">
        <div className="sec-head"><h2 id="apps-h">All applications · {list.total}</h2></div>
        <div className="groups">
          {list.groups.map((g) => (
            <Group
              key={g.key} group={g} list={list} open={isOpen(g)} highlight={highlight}
              onToggle={() => toggle(g)} onMore={() => showMore(g)} onStatus={changeStatus}
            />
          ))}
        </div>
      </section>
      {dialog}
      {toaster.element}
    </section>
  );
}

function Group({ group: g, list, open, highlight, onToggle, onMore, onStatus }: {
  group: ApplicationGroup;
  list: ApplicationList;
  open: boolean;
  highlight: string | null;
  onToggle: () => void;
  onMore: () => void;
  onStatus: (a: ApplicationSummary, to: Status) => Promise<boolean>;
}) {
  const hint = g.key === "closed"
    ? `${list.counts.rejected} rejected · ${list.counts.withdrawn} withdrawn · never deleted`
    : g.order;
  const hidden = g.count - g.applications.length;
  return (
    <div className="group">
      <div className="group-h">
        <h3>
          <button className="disclose" id={`g-${g.key}-h`} type="button" aria-expanded={open} aria-controls={`g-${g.key}`} onClick={onToggle}>
            <Chevron />{g.label} <span className="count">{g.count}</span>
          </button>
        </h3>
        {hint && <span className="meta">{hint}</span>}
      </div>
      <div id={`g-${g.key}`} hidden={!open}>
        <div className="table-wrap">
          <table className="table apps" aria-label={`${g.label} applications`}>
            <colgroup>
              <col className="c-job" /><col className="c-status" /><col className="c-date wide" /><col className="c-last wide" /><col className="c-angle wide" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Job</th><th scope="col">Status</th><th scope="col" className="wide">Applied</th>
                <th scope="col" className="wide">Last event</th><th scope="col" className="wide">Angle</th>
              </tr>
            </thead>
            <tbody>
              {g.applications.map((a) => <Row key={a.id} app={a} highlighted={a.id === highlight} onStatus={onStatus} />)}
            </tbody>
          </table>
        </div>
        {hidden > 0 && (
          <div className="group-foot">
            Showing {g.applications.length} of {g.count}
            <button className="btn sm" type="button" onClick={onMore}>Show {hidden} more</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ app: a, highlighted, onStatus }: { app: ApplicationSummary; highlighted: boolean; onStatus: (a: ApplicationSummary, to: Status) => Promise<boolean> }) {
  const closed = a.status === "rejected" || a.status === "withdrawn";
  const last = `${a.lastEvent.text} · ${eventTime(a.lastEvent.at)}`;
  const lang = langOf(a.title);
  return (
    <tr id={rowId(a.id)} className={[closed && "closed", highlighted && "is-focused"].filter(Boolean).join(" ") || undefined}>
      <td>
        <a className="t" href={`/applications/${encodeURIComponent(a.id)}`} lang={lang}>{a.title}</a>
        <span className="co">{a.company}</span>
        <span className="narrow">Applied {shortDay(a.appliedOn)} · {last}</span>
      </td>
      <td><StatusSelect key={a.status} app={a} onStatus={onStatus} /></td>
      <td className="wide num">{shortDay(a.appliedOn)}</td>
      <td className="wide"><div className="last">{last}</div><By cause={a.lastEvent.cause} /></td>
      <td className="wide meta">{a.angle ? angleLabel[a.angle] : "—"}</td>
    </tr>
  );
}

const pickKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/**
 * The row's quick Status change. Picked with the pointer from the open list, it applies at once.
 * Arrowing through the closed select (which fires `change` on some platforms) only moves the choice;
 * it applies on Enter or when focus leaves, so passing through Statuses never logs each one (TA-09).
 * Accepted is offered but disabled: accepting an offer is its own step, built later. Keyed by the
 * Status, so a new Status from the service starts it afresh. Its label is visually hidden unless
 * `label` is given (the Application page shows "Status" beside its stepper).
 */
export function StatusSelect({ app, onStatus, label }: {
  app: ApplicationSummary;
  onStatus: (a: ApplicationSummary, to: Status) => Promise<boolean>;
  label?: string;
}) {
  const [value, setValue] = useState<Status>(app.status);
  const keyed = useRef(false);
  const sent = useRef<Status | null>(null);

  const commit = (to: Status) => {
    keyed.current = false;
    if (to === app.status || to === sent.current) return;
    sent.current = to;
    onStatus(app, to).then((ok) => {
      // Refused: the select goes back to the Status it has. (Applied, the select is made afresh for the new Status.)
      if (!ok) { sent.current = null; setValue(app.status); }
    }).catch(() => {});
  };
  const onKeyDown = (e: KeyboardEvent<HTMLSelectElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit(value); return; }
    if (e.key === "Escape") { keyed.current = false; setValue(app.status); return; }
    if (pickKeys.has(e.key) || e.key.length === 1) keyed.current = true;
  };

  return (
    <>
      <label className={label ? undefined : "sr-only"} htmlFor={selectId(app.id)}>{label ?? `Status of ${app.title} at ${app.company}`}</label>
      <select
        className="input" id={selectId(app.id)} value={value} onKeyDown={onKeyDown}
        onChange={(e) => { const to = e.target.value as Status; setValue(to); if (!keyed.current) commit(to); }}
        onBlur={() => { if (value !== app.status) commit(value); }}
      >
        {statusOrder.map((s) => (
          <option key={s} value={s} disabled={s === "accepted"}>
            {s === "accepted" ? "Accepted (offer step, coming later)" : statusLabel[s]}
          </option>
        ))}
      </select>
    </>
  );
}

const byIcon = {
  you: <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="4" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M2 10.5c.6-2 2.1-3 4-3s3.4 1 4 3" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>,
  email: <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="2.5" width="9" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="m2 3.2 4 3 4-3" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>,
  "apply-kit": <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 10.5 4.5 4l2 3.5L8 5.5l3 5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
};

/** Who or what caused an Event: icon plus words, never colour alone. */
export function By({ cause }: { cause: ApplicationSummary["lastEvent"]["cause"] }) {
  const cls = cause === "apply-kit" ? "app" : cause;
  return <span className={`by ${cls}`}>{byIcon[cause]}by {cause}</span>;
}
