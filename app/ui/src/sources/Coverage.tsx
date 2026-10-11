// Settings › Sources › Coverage check (hi-fi: docs/design/hifi/sources.html, state "Coverage check").
// Kris tells apply-kit what he searched by hand and what he saw (a count, the listings pasted one per
// line, or a dev.bg results link); the result splits them into in the Feed / kept out (with the
// reason) / missing (with why and a fix), and every check is kept in the history below.
// CoverageCard is the summary panel on the Sources screen.
import type { CoverageFix, CoverageHistory, CoverageResult, CoverageResultListing, CoverageSummary } from "@apply-kit/core";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  addSource, checkSource, fetchCoverageCheck, fetchCoverageHistory, recordCoverageCheck, reopenJobs, resumeSource, undoDecision,
} from "../api.ts";
import { Chip, clockTime, StatusLine } from "../health.tsx";

const sites = ["dev.bg", "jobs.bg", "LinkedIn", "Google Jobs"];

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 Oct" (today: "Today"). */
function day(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString() ? "Today" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const searchText = (c: { site: string; query: string; location: string | null }) =>
  [c.site, c.query ? `"${c.query}"` : null, c.location].filter(Boolean).join(" · ");

/** The result chip of one check in the history and on the Sources card. */
function ResultChip({ c }: { c: CoverageSummary }) {
  if (c.listed === 0) {
    const short = c.saw - c.appHad;
    return short > 0 ? <Chip tone="warn">About {short} fewer</Chip> : <Chip tone="ok">Nothing missing</Chip>;
  }
  if (c.missing === 0) return <Chip tone="ok">Nothing missing</Chip>;
  if (c.fixed >= c.missing) return <Chip tone="ok">{c.missing} missing · fixed</Chip>;
  return <Chip tone="warn">{c.missing} missing{c.fixed > 0 ? ` · ${c.fixed} fixed` : ""}</Chip>;
}

/** The Coverage check panel on the Sources screen: when the last one ran, its result, and whether one is due. */
export function CoverageCard({ onOpen }: { onOpen: () => void }) {
  const [history, setHistory] = useState<CoverageHistory | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchCoverageHistory(ctrl.signal).then(setHistory).catch(() => {});
    return () => ctrl.abort();
  }, []);
  const last = history?.checks[0];
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Coverage check</h2>
        <span className="grow" />
        {history?.due && <Chip tone="none">Due</Chip>}
      </div>
      <p className="muted mini">
        Is the Feed missing anything you'd find by hand? Search a site the normal way, tell apply-kit what you searched, and it lists anything missing and why.
      </p>
      {last && (
        <dl className="kv">
          <dt>Last check</dt><dd>{day(last.at)} · {searchText(last)}</dd>
          <dt>Result</dt><dd><ResultChip c={last} /></dd>
          <dt>Rhythm</dt><dd>Weekly for the first month</dd>
        </dl>
      )}
      <div className="row"><button className="btn" type="button" onClick={onOpen}>Run a coverage check</button></div>
    </div>
  );
}

type Shown = { state: "none" } | { state: "loading" } | { state: "ready"; result: CoverageResult; fresh: boolean };

/** The coverage check screen: the form, the result, and the history. */
export function CoveragePage({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [history, setHistory] = useState<CoverageHistory | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [shown, setShown] = useState<Shown>({ state: "none" });
  const [said, say] = useState("");
  const [reloads, setReloads] = useState(0);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { document.title = "Coverage check · apply-kit"; }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchCoverageHistory(ctrl.signal).then((h) => { setHistory(h); setHistoryError(""); })
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setHistoryError(errorText(err)); });
    return () => ctrl.abort();
  }, [reloads]);
  useEffect(() => { if (shown.state === "ready") resultHeading.current?.focus(); }, [shown]);

  const recorded = (result: CoverageResult) => {
    setShown({ state: "ready", result, fresh: true });
    setReloads((n) => n + 1);
    say(headline(result));
  };

  const open = (id: string) => {
    setShown({ state: "loading" });
    fetchCoverageCheck(id)
      .then((result) => setShown({ state: "ready", result, fresh: false }))
      .catch((err: unknown) => { setShown({ state: "none" }); say(`Couldn't open that check: ${errorText(err)}`); });
  };

  return (
    <>
      <div className="page-head">
        <div className="lead">
          <span className="crumbs">
            <a href="/settings/sources" onClick={(e) => { e.preventDefault(); onClose(); }}>Sources &amp; watchlist</a> › Coverage check
          </span>
          <h1>Is the Feed missing anything?</h1>
          <p className="meta">Search a site the way you normally would, then tell apply-kit what you searched and what you saw.</p>
        </div>
      </div>
      <div className="panel">
        <CoverageForm onRecorded={recorded} />
      </div>
      <StatusLine message={said} />
      {shown.state === "loading" && <p className="meta">Opening the check…</p>}
      {shown.state === "ready" && (
        <ResultPanel
          key={shown.result.id}
          result={shown.result}
          headingRef={resultHeading}
          say={say}
          onFixed={() => { setReloads((n) => n + 1); onChanged(); }}
        />
      )}
      <div className="panel flush">
        <div className="panel-pad">
          <h2>Coverage history</h2>
          <p className="meta">Gaps that repeat point to a source or a company to add. A missing job that arrives later counts as fixed.</p>
        </div>
        {historyError && <p className="meta panel-pad">Couldn't load the history: {historyError}</p>}
        {history && history.checks.length === 0 && <p className="meta panel-pad">No coverage checks yet.</p>}
        {history && history.checks.length > 0 && (
          <div className="table-wrap">
            <table className="table static" aria-label="Coverage history">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Site and search</th>
                  <th scope="col" className="r">You saw</th>
                  <th scope="col" className="r">apply-kit had</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {history.checks.map((c) => (
                  <tr key={c.id}>
                    <td className="num">{day(c.at)}</td>
                    <td>
                      <button className="link-btn" type="button" onClick={() => open(c.id)}>
                        {searchText(c)}<span className="sr-only">: open this check</span>
                      </button>
                    </td>
                    <td className="r num">{c.saw}</td>
                    <td className="r num">{c.appHad}</td>
                    <td><ResultChip c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function CoverageForm({ onRecorded }: { onRecorded: (r: CoverageResult) => void }) {
  const [site, setSite] = useState("dev.bg");
  const [otherSite, setOtherSite] = useState("");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("Sofia");
  const [count, setCount] = useState("");
  const [link, setLink] = useState("");
  const [listings, setListings] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const other = site === "other";

  const submit = () => {
    setError("");
    setSending(true);
    recordCoverageCheck({
      site: other ? otherSite : site, query, location: location || null,
      resultCount: count.trim() === "" ? null : Number(count), listings: listings || undefined, resultsUrl: link || null,
    })
      .then(onRecorded)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setSending(false));
  };

  return (
    <form className="stack" style={{ gap: "var(--s-5)" }} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="field">
        <span id="cv-site" className="field-label">Site you searched</span>
        <div className="segmented wrap" role="group" aria-labelledby="cv-site">
          {sites.map((s) => <button key={s} type="button" aria-pressed={site === s} onClick={() => setSite(s)}>{s}</button>)}
          <button type="button" aria-pressed={other} onClick={() => setSite("other")}>Other</button>
        </div>
        {other && (
          <input
            className="input" aria-label="Which site" autoComplete="off" placeholder="e.g. Indeed…"
            value={otherSite} onChange={(e) => setOtherSite(e.target.value)}
          />
        )}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="cv-q">Search words</label>
          <input className="input" id="cv-q" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. security…" />
        </div>
        <div className="field">
          <label htmlFor="cv-loc">Location</label>
          <input className="input" id="cv-loc" autoComplete="off" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cv-n">Results you saw <span className="meta">(optional with listings or a link)</span></label>
          <input
            className="input num" id="cv-n" inputMode="numeric" autoComplete="off" aria-describedby="cv-n-help"
            value={count} onChange={(e) => setCount(e.target.value)}
          />
          <span className="help" id="cv-n-help">Leave empty if you paste the listings or a dev.bg results link: apply-kit counts them.</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="cv-list">Listings you saw <span className="meta">(optional)</span></label>
        <span className="help" id="cv-list-help">One per line: title · company · location, or a link to the job. With listings, apply-kit says exactly which are missing and why.</span>
        <textarea
          className="input cv-list" id="cv-list" rows={5} spellCheck={false} aria-describedby="cv-list-help"
          placeholder={"Security Engineer · Acme · Sofia\nhttps://…"}
          value={listings} onChange={(e) => setListings(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cv-url">Results page link <span className="meta">(optional, dev.bg)</span></label>
        <span className="help" id="cv-url-help">For dev.bg apply-kit reads the page once and lists exactly what's missing. Other sites can't be read: paste their listings instead.</span>
        <input
          className="input" id="cv-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} aria-describedby="cv-url-help"
          placeholder="https://dev.bg/…" value={link} onChange={(e) => setLink(e.target.value)}
        />
      </div>
      {error && <p className="err-line" role="alert">{error}</p>}
      <div className="row">
        <button className="btn primary" type="submit" disabled={sending}>{sending ? "Comparing…" : "Compare"}</button>
      </div>
    </form>
  );
}

function headline(r: CoverageResult): string {
  const t = r.totals;
  if (t.listed === 0) return `You saw ${plural(t.saw, "result")}; apply-kit has ${plural(t.appHad, "job")} for that search.`;
  const parts = [`${t.inFeed} in the Feed`, t.hidden > 0 && `${t.hidden} kept out of the main list`, `${t.missing} missing`].filter(Boolean);
  return `${t.found} of ${plural(t.listed, "listing")} found: ${parts.join(", ")}`;
}

function ResultPanel({ result: r, headingRef, say, onFixed }: {
  result: CoverageResult;
  headingRef: RefObject<HTMLHeadingElement | null>;
  say: (m: string) => void;
  onFixed: () => void;
}) {
  const t = r.totals;
  const missing = r.listings.filter((l) => l.status === "missing");
  const hidden = r.listings.filter((l) => l.status === "hidden");
  const inFeed = r.listings.filter((l) => l.status === "in-feed");
  const of = t.listed > 0 ? t.listed : t.saw;
  const had = t.listed > 0 ? t.found : Math.min(t.appHad, t.saw);
  const unlisted = t.saw - t.listed;
  return (
    <section className="panel" aria-labelledby="cv-result">
      <div className="panel-h">
        <h2 id="cv-result" ref={headingRef} tabIndex={-1}>{headline(r)}</h2>
        <span className="grow" />
        {t.listed > 0 && (t.missing > 0 ? <Chip tone="warn">{t.missing} missing</Chip> : <Chip tone="ok">Nothing missing</Chip>)}
      </div>
      <p className="meta">
        {day(r.at)}, {clockTime(r.at)} · you searched {searchText(r)} and saw {plural(t.saw, "result")}.
        {t.listed === 0 && " apply-kit counts the jobs in any view whose title or company has every search word, in a place that agrees with yours: an estimate, since sites also search the posting text. Paste the listings to see exactly which are missing."}
        {t.listed > 0 && unlisted > 0 && ` You listed ${t.listed} of them; the other ${unlisted} aren't compared.`}
      </p>
      {of > 0 && (
        <div
          className="meter" role="meter" aria-valuemin={0} aria-valuemax={of} aria-valuenow={had}
          aria-valuetext={`${had} of ${of} found`} aria-label="Found by apply-kit"
        >
          <span style={{ width: `${Math.round((had / of) * 100)}%` }} />
        </div>
      )}
      {missing.length > 0 && (
        <div>
          <h3 className="sub-h">Missing</h3>
          {missing.map((l, i) => <ListingOutcome key={`m${i}`} listing={l} say={say} onFixed={onFixed} />)}
        </div>
      )}
      {hidden.length > 0 && (
        <div>
          <h3 className="sub-h">Found, but not in the main Feed</h3>
          {hidden.map((l, i) => <ListingOutcome key={`h${i}`} listing={l} say={say} onFixed={onFixed} />)}
        </div>
      )}
      {inFeed.length > 0 && (
        <details>
          <summary className="meta">{plural(inFeed.length, "job")} already in the Feed</summary>
          <ul className="list found-list">
            {inFeed.map((l, i) => (
              <li key={`f${i}`}><a href={`/jobs/${encodeURIComponent(l.jobId!)}`}>{l.title}</a> <span className="meta">· {l.company}</span></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ListingOutcome({ listing: l, say, onFixed }: { listing: CoverageResultListing; say: (m: string) => void; onFixed: () => void }) {
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const what = l.company ? `${l.title} · ${l.company}` : l.title;
  const act = (fix: CoverageFix) => {
    const run = fixAction(fix);
    if (!run) return;
    setBusy(true);
    run()
      .then((message) => { setDone(message); say(message); onFixed(); })
      .catch((err: unknown) => say(`Couldn't do that: ${errorText(err)}`))
      .finally(() => setBusy(false));
  };
  return (
    <div className="miss">
      <div className="panel-h">
        <span className="src-name">
          {l.jobId ? <a href={`/jobs/${encodeURIComponent(l.jobId)}`}>{what}</a> : what}
        </span>
        {l.location && <span className="meta">{l.location}</span>}
        <span className="grow" />
        {l.fixedBy && <Chip tone="ok">Arrived since</Chip>}
      </div>
      {l.reason && <p className="why"><b>{l.status === "missing" ? "Why missed:" : "Why not in the main Feed:"}</b> {l.reason.text}</p>}
      {l.fixedBy ? (
        <div className="row"><a className="btn sm" href={`/jobs/${encodeURIComponent(l.fixedBy)}`}>Open the job<span className="sr-only">: {what}</span></a></div>
      ) : done ? (
        <div className="row"><Chip tone="ok">{done}</Chip></div>
      ) : l.fixes.length > 0 && (
        <div className="row">
          {l.fixes.map((f, i) => {
            const href = fixLink(f);
            const cls = `btn sm${i === 0 ? " primary" : ""}`;
            return href
              ? <a key={i} className={cls} href={href}>{f.label}<span className="sr-only">: {what}</span></a>
              : <button key={i} className={cls} type="button" disabled={busy} onClick={() => act(f)}>{f.label}<span className="sr-only">: {what}</span></button>;
          })}
        </div>
      )}
    </div>
  );
}

/** Fixes that go somewhere else. */
function fixLink(f: CoverageFix): string | null {
  switch (f.kind) {
    case "add-company": return `/settings/sources/add?company=${encodeURIComponent(f.company)}`;
    case "show-relocation": return "/?relocation=1";
    // Kris's search settings (locations, dealbreakers).
    case "adjust-locations": return "/profile/search";
    default: return null;
  }
}

/** Fixes done right here; each resolves with what happened, in plain words. */
function fixAction(f: CoverageFix): (() => Promise<string>) | null {
  switch (f.kind) {
    case "check-source": return () => checkSource(f.sourceId).then((r) =>
      r.ok ? `${r.name} answered: ${plural(r.found, "job")} listed, ${r.newPostings} new` : `${r.name} still couldn't be checked: ${r.error}`);
    case "resume-source": return () => resumeSource(f.sourceId).then((s) => `${s.name} resumed: it's checked again from the next check`);
    case "add-source": return () => addSource(f.source).then((s) => `${s.name} added: it's checked from the next check`);
    case "undo": return () => undoDecision(f.decisionId).then(() => "Pass undone: it's back in the Feed");
    case "reopen": return () => reopenJobs([f.jobId]).then(() => "Reopened: it's back in New");
    default: return null;
  }
}
