// Profile › Answer bank (hi-fi: docs/design/hifi/profile.html, "Answer bank"): answers changed in a
// portal waiting for "keep new or old" with both versions to compare, then the table with its
// filters, search and paging. Long answers are clamped to two lines visually; the full text stays in
// the DOM and in Edit.
import type { Answer, AnswerList, AnswerQuery } from "@apply-kit/core";
import { useEffect, useRef, useState } from "react";
import { fetchAnswers, resolvePortalEdit } from "../api.ts";
import { Icon } from "../icons.tsx";
import { categoryLabel, languagesOf, modeSummary, shortDate } from "./answers-common.ts";
import { message, navLink, type Go } from "./common.tsx";

type Show = "all" | "standard" | "screening" | "stale";

const queryOf = (show: Show, search: string, page: number): AnswerQuery => ({
  ...(show === "standard" || show === "screening" ? { category: show } : {}),
  ...(show === "stale" && { notUsedIn90Days: true }),
  search,
  page,
});

export function AnswerBank({ go, announce, flash, clearFlash, onChanged }: {
  go: Go;
  announce: (msg: string) => void;
  flash: string | null;
  clearFlash: () => void;
  /** After a portal edit is resolved, so the section counts and the nav badge follow. */
  onChanged: () => void;
}) {
  const [show, setShow] = useState<Show>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<AnswerList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const first = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // After a save, delete or resolved edit, say what happened and put focus on the table's heading.
  useEffect(() => {
    if (!flash) return;
    announce(flash);
    clearFlash();
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }, [flash, announce, clearFlash]);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetchAnswers(queryOf(show, search, page), ctrl.signal)
        .then((l) => {
          setList(l);
          setError(null);
          if (!first.current) announce(`${l.total} ${l.total === 1 ? "answer" : "answers"} shown.`);
          first.current = false;
        })
        .catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    }, search ? 200 : 0);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [show, search, page, reload, announce]);

  if (error) return <div className="banner error" role="alert"><span className="text"><b>Couldn't load your answer bank.</b> {error}</span></div>;
  if (!list) return <p className="meta" role="status">Loading your answer bank…</p>;

  const filter = (s: Show) => { setShow(s); setPage(1); };
  const from = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const resolved = (said: string) => {
    onChanged();
    setReload((n) => n + 1);
    announce(said);
    window.setTimeout(() => headingRef.current?.focus(), 0);
  };

  return (
    <>
      {list.portalEdits.map((a) => <PortalEditItem key={a.id} answer={a} onResolved={resolved} onError={setError} />)}

      <section className="panel flush" aria-labelledby="answers-h">
        <div className="sec-head answers-head">
          <h2 className="grow" id="answers-h" tabIndex={-1} ref={headingRef}>Answer bank <span className="meta">· {list.counts.all} {list.counts.all === 1 ? "answer" : "answers"}</span></h2>
          <a className="btn" href="/profile/answers/new" onClick={navLink(go)}>Add answer</a>
        </div>
        <div className="toolbar answers-toolbar">
          <div className="segmented" role="group" aria-label="Show">
            {([["all", "All", list.counts.all], ["standard", "Standard", list.counts.standard], ["screening", "Screening", list.counts.screening], ["stale", "Not used in 90 days", list.counts.notUsedIn90Days]] as const).map(([s, label, n]) => (
              <button key={s} type="button" aria-pressed={show === s} onClick={() => filter(s)}>{label} <span className="num">{n}</span></button>
            ))}
          </div>
          <div className="search answers-search">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <label className="sr-only" htmlFor="as">Search answers</label>
            <input className="input" id="as" type="search" placeholder="Search questions…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

        {list.answers.length === 0 ? (
          <div className="row answers-none">
            <span className="meta grow">No answers match.</span>
            <button className="btn sm" type="button" onClick={() => { setShow("all"); setSearch(""); setPage(1); }}>Clear search and filters</button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table answers-table" aria-label="Answer bank">
              <thead><tr><th scope="col">Question</th><th scope="col">Answer</th><th scope="col">Kind</th><th scope="col">Languages</th><th scope="col">Last used</th><th scope="col">Used</th></tr></thead>
              <tbody>{list.answers.map((a) => <AnswerRow key={a.id} answer={a} go={go} />)}</tbody>
            </table>
          </div>
        )}
        {list.total > list.pageSize && (
          <div className="row answers-pages">
            <span className="meta grow">{from}–{to} of {list.total}</span>
            <button className="btn sm" type="button" disabled={list.page <= 1} onClick={() => setPage(list.page - 1)}>Previous<span className="sr-only"> page</span></button>
            <button className="btn sm" type="button" disabled={list.page >= pages} onClick={() => setPage(list.page + 1)}>Next<span className="sr-only"> page</span></button>
          </div>
        )}
      </section>
      <p className="meta">"Why this company?" and letter-style questions aren't stored: they're written fresh for each job. The extension fills portals only from this bank, your contact details and an approved package, and never fills an "ask each time" or "leave blank" answer by itself.</p>
    </>
  );
}

function AnswerRow({ answer: a, go }: { answer: Answer; go: Go }) {
  const shown = a.mode === "fill" ? (a.versions.en ?? a.versions.bg) : undefined;
  return (
    <tr>
      <td>
        <a className="q" href={`/profile/answers/${encodeURIComponent(a.id)}`} onClick={navLink(go)}>{a.question}</a>
        {a.portalEdit && <> <span className="chip ask"><Icon name="ask" />Changed in a portal</span></>}
      </td>
      <td>
        {shown !== undefined
          ? <span className="ans" lang={a.versions.en ? undefined : "bg"}>{shown}</span>
          : <span className="ans meta">{modeSummary(a)}</span>}
      </td>
      <td>{categoryLabel[a.category]}</td>
      <td>{a.mode === "ask" ? "—" : languagesOf(a)}</td>
      <td className="num">{a.lastUsedAt ? shortDate(a.lastUsedAt) : "Not yet"}</td>
      <td className="num">{a.useCount}</td>
    </tr>
  );
}

/** "Keep new or old": the bank's version and what Kris typed in the portal, side by side on Compare. */
function PortalEditItem({ answer: a, onResolved, onError }: { answer: Answer; onResolved: (said: string) => void; onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const e = a.portalEdit!;
  const id = `cmp-${a.id.replace(/[^a-z0-9-]/gi, "")}`;
  const lang = e.language === "bg" ? "bg" : undefined;

  async function keep(which: "keep-new" | "keep-old") {
    setBusy(true);
    try {
      await resolvePortalEdit(a.id, which);
      onResolved(which === "keep-new"
        ? `Kept the new version of "${a.question}". The old one is in the answer's history.`
        : `Kept your answer to "${a.question}". The portal's version is noted in its history.`);
    } catch (err) {
      onError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="needs">
        <span className="grow">
          <b>"{a.question}" was changed in a portal.</b>{" "}
          <span className="muted">You edited it in the {e.portal} on {shortDate(e.at)}{e.language === "bg" ? " (Bulgarian version)" : ""}. Keep the new version for next time?</span>
        </span>
        <span className="row needs-acts">
          <button className="btn sm" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>Compare</button>
          <button className="btn sm" type="button" disabled={busy} onClick={() => void keep("keep-new")}>Keep new</button>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void keep("keep-old")}>Keep old</button>
        </span>
      </div>
      <div id={id} className="panel" hidden={!open}>
        <div className="pair">
          <div className="src"><span className="where">In your answer bank</span><span lang={lang}>"{e.before}"</span></div>
          <div className="src"><span className="where">What you typed in the portal</span><span lang={lang}>"{e.text}"</span></div>
        </div>
      </div>
    </>
  );
}
