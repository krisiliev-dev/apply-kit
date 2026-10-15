// The Stats strip on Applications (hi-fi: docs/design/hifi/applications.html, states Normal, One
// application and 214 applications): applications per week as a single-series pine chart with the
// pace hairline, response rate, interviews and what's working. The tracker computes every number;
// this only draws and words them.
//
// The chart (TA-01, TA-08, TA-14): the current week is hatched, pink only when it is above the pace
// and then labelled so; every bar has a tooltip on hover and on keyboard focus, arrow keys move
// between bars, and "Show as table" holds every value. Labels are HTML in text tokens, not SVG text,
// so they stay at the caption size however wide the chart is drawn.
import type { TrackMailbox, TrackStats, WeekCount, WorkingRow } from "@apply-kit/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { fetchApplicationStats } from "../api.ts";
import { dayTime } from "./words.ts";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sep = (s: string) => s.replace("Sept", "Sep");
/** "12 Oct" (never "today": a week is named by its Monday). */
const dayMonth = (day: string) => sep(new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }));
/** "Tue 27 Oct". */
const weekdayDay = (day: string) => sep(new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }));
/** 4, or 3.5 for a half. */
const paceText = (pace: number) => (Number.isInteger(pace) ? String(pace) : pace.toFixed(1));

/**
 * Loads the Stats again whenever `version` changes. While the job mailbox can't be read, the response
 * rate says it may be low or missing replies since then.
 */
export function StatsStrip({ version, mailbox }: { version: unknown; mailbox?: TrackMailbox | null }) {
  const [stats, setStats] = useState<TrackStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchApplicationStats(ctrl.signal)
      .then((s) => { setStats(s); setFailed(false); })
      .catch(() => { if (!ctrl.signal.aborted) setFailed(true); });
    return () => ctrl.abort();
  }, [version]);

  if (!stats) return failed ? <p className="meta">Stats couldn't be loaded. They come back with the next reload.</p> : null;
  if (stats.total === 0) return null;

  const headline = stats.total === 1
    ? "Your first one. The weekly chart fills in from here."
    : `${stats.total} since ${stats.since ? dayMonth(stats.since) : "today"}`
      + (stats.lastWeek.best ? ` · last week ${stats.lastWeek.count}, your best yet` : "");

  return (
    <section className="strip" aria-label="Stats">
      <div className="tile">
        <div className="head"><span className="label">Applications per week</span><span className="sub">{headline}</span></div>
        <WeeklyChart stats={stats} />
      </div>
      <ResponseRate
        rate={stats.responseRate}
        stale={mailbox?.state === "not-connected" ? "Replies aren't being read, so this may be low"
          : stats.mayBeMissingRepliesSince ? `May be missing replies since ${dayTime(stats.mayBeMissingRepliesSince)}` : null}
      />
      <div className="tile">
        <span className="label">Interviews</span>
        <span className="value">{stats.interviews.upcoming}<small>upcoming</small></span>
        <span className="sub">
          {stats.interviews.soFar
            ? `${plural(stats.interviews.soFar, "interview")} so far, at ${plural(stats.interviews.companies, "company", "companies")}`
            : "None yet"}
        </span>
      </div>
      <Working working={stats.working} />
    </section>
  );
}

function ResponseRate({ rate: r, stale }: { rate: TrackStats["responseRate"]; stale: string | null }) {
  if (r.rate === null) {
    return (
      <div className={stale ? "tile stale" : "tile"}>
        <span className="label">Response rate</span>
        <span className="value">—<small>{r.countsFrom ? `Counts from ${weekdayDay(r.countsFrom)}` : "Nothing to count yet"}</small></span>
        <span className="sub">
          {stale && <><b>{stale}.</b>{" "}</>}
          Applications under 14 days old aren't counted, so {r.excluded === 1 ? "1 new one" : `${r.excluded} new ones`} can't drag the rate down
        </span>
      </div>
    );
  }
  return (
    <div className={stale ? "tile stale" : "tile"}>
      <span className="label">Response rate</span>
      <span className="value">{Math.round(r.rate * 100)}%<small>{r.replied} of {r.counted} replied</small></span>
      <span className="sub">
        {stale && <><b>{stale}.</b>{" "}</>}
        Rejections count as replies
        {r.excluded > 0 && ` · ${r.excluded} sent in the last 14 days ${r.excluded === 1 ? "isn't" : "aren't"} counted yet`}
      </span>
    </div>
  );
}

// Chart geometry, in viewBox units: 300 wide, the baseline at 76, bars at most 64 tall.
const W = 300, H = 80, BASE = 76, TALL = 64, LEFT = 10, RIGHT = 290;

function WeeklyChart({ stats }: { stats: TrackStats }) {
  const { weeks, pace, thisWeek } = stats;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hatch = `hatch-${uid}`;
  const tableId = `weeks-${uid}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const hitRefs = useRef<(SVGRectElement | null)[]>([]);
  const [active, setActive] = useState(weeks.length - 1);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [table, setTable] = useState(false);

  const n = weeks.length;
  const slot = (RIGHT - LEFT) / n;
  const bw = Math.min(20, slot - 6);
  const scale = TALL / Math.max(...weeks.map((w) => w.count), pace, 1);
  const paceY = BASE - pace * scale;
  const win = thisWeek.win;

  const label = (w: WeekCount) => `Week of ${dayMonth(w.weekOf)}: ${w.count} applied${w.current ? (win ? " so far, above your pace" : " so far") : ""}`;

  const show = (i: number) => {
    const hit = hitRefs.current[i], wrap = wrapRef.current;
    if (!hit || !wrap) return;
    const r = hit.getBoundingClientRect(), box = wrap.getBoundingClientRect();
    const barTop = BASE - weeks[i]!.count * scale;
    setTip({ text: label(weeks[i]!), x: r.left - box.left + r.width / 2, y: (Math.min(barTop, paceY) / H) * box.height });
  };
  const onKeyDown = (e: KeyboardEvent<SVGRectElement>, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to === null || to < 0 || to >= n) return;
    e.preventDefault();
    setActive(to);
    hitRefs.current[to]?.focus();
  };

  return (
    <>
      <div className="chart-wrap" ref={wrapRef}>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Applications per week, last ${n} weeks. Use the arrow keys to move between weeks.`}>
          <defs>
            <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="hatch-bg" /><rect width="2" height="5" className="hatch-line" />
            </pattern>
          </defs>
          <line className="grid" x1={LEFT} x2={RIGHT} y1={BASE} y2={BASE} />
          {pace > 0 && <line className="pace" x1={LEFT} x2={RIGHT} y1={paceY} y2={paceY} />}
          {weeks.map((w, i) => {
            const x = LEFT + i * slot + (slot - bw) / 2;
            const h = w.count ? Math.max(w.count * scale, 3) : 0;
            const y = BASE - h;
            const r = Math.min(4, h, bw / 2);
            const d = h ? `M${x} ${BASE}V${y + r}a${r} ${r} 0 0 1 ${r}-${r}h${bw - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${BASE}z` : "";
            const cls = w.current ? (win ? "bar win" : "bar partial") : "bar";
            return (
              <g key={w.weekOf}>
                <rect
                  className="hit" x={LEFT + i * slot} y={4} width={slot} height={BASE - 4}
                  role="img" aria-label={label(w)} tabIndex={i === active ? 0 : -1}
                  ref={(el) => { hitRefs.current[i] = el; }}
                  onPointerEnter={() => show(i)} onPointerLeave={() => setTip(null)}
                  onFocus={() => { setActive(i); show(i); }} onBlur={() => setTip(null)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                />
                {d && <path className={cls} d={d} style={w.current && !win ? { fill: `url(#${hatch})` } : undefined} />}
              </g>
            );
          })}
        </svg>
        {pace > 0 && <span className="pace-label" style={{ top: `${(paceY / H) * 100}%` }} aria-hidden="true">pace {paceText(pace)}/wk</span>}
        {tip && <div className="chart-tip" aria-hidden="true" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
      </div>
      <div className="chart-axis" aria-hidden="true">
        <span>{dayMonth(weeks[0]!.weekOf)}</span>
        <span>This week: <b>{thisWeek.count} so far</b>{win && " · above pace"}</span>
      </div>
      <button className="btn ghost sm table-toggle" type="button" aria-expanded={table} aria-controls={tableId} onClick={() => setTable((t) => !t)}>
        {table ? "Hide table" : "Show as table"}
      </button>
      <div id={tableId} hidden={!table}>
        <table className="data-table">
          <caption className="sr-only">Applications per week</caption>
          <thead><tr><th scope="col">Week of</th><th scope="col">Applied</th></tr></thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekOf}>
                <td>{dayMonth(w.weekOf)}{w.current && " (this week, so far)"}</td>
                <td>{w.count}{w.current && win && " · above pace"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td>Pace</td><td>{pace > 0 ? `${paceText(pace)} a week (median of the last 8 complete weeks)` : "None yet"}</td></tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

const sets = [
  { key: "angle", label: "Angle" },
  { key: "source", label: "Source" },
  { key: "cvVersion", label: "CV version" },
] as const;
type SetKey = (typeof sets)[number]["key"];

function Working({ working }: { working: TrackStats["working"] }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Opens on the first grouping that has anything to show (no CV versions before Packages exist).
  const [set, setSet] = useState<SetKey>(() => sets.find((s) => working[s.key].length)?.key ?? "angle");
  const enough = sets.some((s) => working[s.key].some((r) => !r.tooFew));
  if (!enough) {
    return (
      <div className="tile">
        <span className="label">What's working</span>
        <p className="muted mini">Shows which angle, source and CV version get replies, once 5 applications in a group are 14 days old.</p>
      </div>
    );
  }
  const rows = working[set];
  return (
    <div className="tile">
      <div className="head">
        <span className="label" id={`ww-${uid}`}>What's working · replies per sent</span>
        <div className="segmented" role="group" aria-labelledby={`ww-${uid}`}>
          {sets.map((s) => (
            <button key={s.key} type="button" aria-pressed={set === s.key} onClick={() => setSet(s.key)}>{s.label}</button>
          ))}
        </div>
      </div>
      {rows.length
        ? <ul className="work-parts">{rows.map((r) => <Part key={r.name} row={r} />)}</ul>
        : <p className="muted mini">{set === "cvVersion" ? "No CV versions yet: they come from the Packages you send, or a CV attached to an Application." : "None yet."}</p>}
      <span className="sub">Applications 14+ days old · under 5 sent is "too few" to tell</span>
    </div>
  );
}

function Part({ row: r }: { row: WorkingRow }) {
  return (
    <li>
      <span className="name" title={r.name}>{r.name}</span>
      <span className="track" role="img" aria-label={`${r.name}: ${r.replied} of ${r.sent} replied${r.tooFew ? ", too few to tell" : ""}`}>
        <span style={{ width: `${r.sent ? (r.replied / r.sent) * 100 : 0}%` }} />
      </span>
      <span className="nums" aria-hidden="true">
        {r.replied}/{r.sent}{r.tooFew ? <span className="few"> · too few</span> : ` · ${Math.round((r.replied / r.sent) * 100)}%`}
      </span>
    </li>
  );
}

