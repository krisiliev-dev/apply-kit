// Settings › Sources › Add company (hi-fi: docs/design/hifi/sources.html, states "Add company",
// "Add · detecting" and "Add · not found"). Kris types a name or pastes a careers link; every job
// system is asked once, with progress, and what was found can be added to the watchlist. When nothing
// readable is found, the fallbacks are offered best first.
import type { CompanyDetection, Fallback, SystemProbe } from "@apply-kit/core";
import { useEffect, useRef, useState } from "react";
import { addSource, detectCompany } from "../api.ts";
import { Chip } from "../health.tsx";

type Step =
  | { step: "form"; error?: string }
  | { step: "detecting"; input: string; detection: CompanyDetection | null }
  | { step: "done"; detection: CompanyDetection };

export interface Added {
  id: string;
  name: string;
  label: string;
}

export function AddCompany({ onAdded, onCancel }: { onAdded: (added: Added) => void; onCancel: () => void }) {
  const [state, setState] = useState<Step>({ step: "form" });
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  // Each later step moves focus to its heading, so a screen reader hears where it is. The form
  // itself starts with focus in its field.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) (state.step === "form" ? document.getElementById("co-input") : heading.current)?.focus();
    started.current = true;
  }, [state.step]);

  const detect = (input: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setAddError("");
    setState({ step: "detecting", input, detection: null });
    detectCompany(input, (d) => { if (!ctrl.signal.aborted) setState({ step: "detecting", input, detection: d }); }, ctrl.signal)
      .then((d) => { if (!ctrl.signal.aborted) setState({ step: "done", detection: d }); })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ step: "form", error: err instanceof Error ? err.message : String(err) });
      });
  };

  const add = (probe: SystemProbe, company: string) => {
    if (!probe.source) return;
    abort.current?.abort();
    setAdding(probe.kind);
    setAddError("");
    addSource(probe.source)
      .then((s) => onAdded({ id: s.id, name: s.name || company, label: probe.label }))
      .catch((err: unknown) => setAddError(`Couldn't add ${company}: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setAdding(null));
  };

  const crumb = (
    <span className="crumbs">
      <a href="/settings/sources" onClick={(e) => { e.preventDefault(); onCancel(); }}>Sources &amp; watchlist</a> › Add company
    </span>
  );

  if (state.step === "form") {
    return (
      <>
        <div className="page-head">
          <div className="lead">
            {crumb}
            <h1 ref={heading} tabIndex={-1}>Add a company to your watchlist</h1>
            <p className="meta">apply-kit finds which job system they use and checks it with your other sources.</p>
          </div>
        </div>
        <div className="panel narrow-panel">
          <CompanyForm error={state.error} onSubmit={detect} onCancel={onCancel} />
        </div>
      </>
    );
  }

  const d = state.step === "detecting" ? state.detection : state.detection;
  const company = d?.company ?? (state.step === "detecting" ? state.input : "");
  const systems = d?.systems ?? [];
  const answered = systems.filter((s) => s.status !== "waiting" && s.status !== "checking").length;
  const found = systems.filter((s) => s.status === "found");
  const finished = state.step === "done";
  const notFound = finished && d!.fallbacks.length > 0;

  return (
    <>
      <div className="page-head">
        <div className="lead">
          {crumb}
          <h1 ref={heading} tabIndex={-1}>
            {!finished ? `Looking for ${possessive(company)} jobs` : notFound ? `No job feed found for ${company}` : `Found ${possessive(company)} jobs`}
          </h1>
          <p className="meta">{finished ? doneSummary(d!) : `Checked ${answered} of ${systems.length || "…"} job systems`}</p>
        </div>
      </div>
      <div className="panel narrow-panel">
        {!finished && (
          <div
            className="meter" role="progressbar" aria-label="Job systems checked"
            aria-valuemin={0} aria-valuemax={systems.length} aria-valuenow={answered}
            aria-valuetext={`${answered} of ${systems.length} job systems`}
          >
            <span style={{ width: `${systems.length ? Math.round((answered / systems.length) * 100) : 0}%` }} />
          </div>
        )}
        <ul className="list detect" aria-live="polite" aria-label="Job systems">
          {d?.careersPage && (
            <li><span className="st"><PageChip page={d.careersPage} /></span><span className="grow">Careers page · {d.careersPage.url}</span></li>
          )}
          {systems.map((s) => <ProbeRow key={s.kind} probe={s} />)}
        </ul>
        {!finished && (
          <>
            <p className="meta">It keeps going after a hit, because some companies use two systems (say, Greenhouse for engineering and Workday for everyone else).</p>
            <div className="row">
              {found[0]?.source && !found[0].sourceId && (
                <button className="btn" type="button" disabled={adding !== null} onClick={() => add(found[0]!, company)}>Stop and use {found[0].label}</button>
              )}
              <button className="btn ghost" type="button" onClick={() => { abort.current?.abort(); setState({ step: "form" }); }}>Cancel</button>
            </div>
          </>
        )}
      </div>
      {addError && <div className="banner error" role="alert"><span className="text">{addError}</span></div>}
      {finished && found.map((p) => (
        <FoundPanel key={p.kind} probe={p} company={company} busy={adding === p.kind} disabled={adding !== null} onAdd={() => add(p, company)} />
      ))}
      {notFound && <Fallbacks company={company} fallbacks={d!.fallbacks} onLink={detect} />}
      {finished && (
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => setState({ step: "form" })}>Look for another company</button>
          <button className="btn ghost" type="button" onClick={onCancel}>Back to sources</button>
        </div>
      )}
    </>
  );
}

function CompanyForm({ error, onSubmit, onCancel }: { error?: string; onSubmit: (input: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const [empty, setEmpty] = useState(false);
  const message = empty ? "Type a company name or paste a link to its careers page." : error;
  return (
    <form
      className="stack" style={{ gap: "var(--s-5)" }} noValidate
      onSubmit={(e) => { e.preventDefault(); if (!value.trim()) { setEmpty(true); return; } onSubmit(value.trim()); }}
    >
      <div className="field">
        <label htmlFor="co-input">Company name or careers page link</label>
        <span className="help" id="co-help">A name is enough. A link to their careers page makes detection faster and surer.</span>
        <input
          className="input" id="co-input" name="company" autoComplete="off" spellCheck={false} autoFocus
          aria-describedby={message ? "co-help co-err" : "co-help"} aria-invalid={message ? true : undefined}
          placeholder="e.g. Kestrel Payments or kestrel.com/careers…"
          value={value} onChange={(e) => { setValue(e.target.value); setEmpty(false); }}
        />
        {message && <span className="err" id="co-err">{message}</span>}
      </div>
      <div className="row">
        <button className="btn primary" type="submit">Find their jobs</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ProbeRow({ probe: s }: { probe: SystemProbe }) {
  const what = s.tried ? `${s.label} · ${s.tried}` : s.label;
  const detail = s.status === "found"
    ? <><b>{what}</b>{s.openJobs != null && ` · ${plural(s.openJobs, "open job")}`}{s.sourceId && " · already on your watchlist"}</>
    : s.status === "not-found" || s.status === "waiting" || s.status === "checking" ? what
    : <>{what}<span className="note">{s.message}</span></>;
  return (
    <li>
      <span className="st"><ProbeChip status={s.status} /></span>
      <span className={`grow${s.status === "waiting" ? " muted" : ""}`}>{detail}</span>
    </li>
  );
}

function ProbeChip({ status }: { status: SystemProbe["status"] }) {
  switch (status) {
    case "found": return <Chip tone="ok">Found</Chip>;
    case "not-found": return <Chip tone="none">Not there</Chip>;
    case "error": return <Chip tone="bad">Couldn't check</Chip>;
    case "needs-link": return <Chip tone="warn">Needs a link</Chip>;
    case "needs-search": return <Chip tone="none">Own search</Chip>;
    case "checking": return <span className="chip neutral"><span className="spin sm" aria-hidden="true" />Checking</span>;
    default: return <span className="chip outline">Waiting</span>;
  }
}

function PageChip({ page }: { page: NonNullable<CompanyDetection["careersPage"]> }) {
  if (page.outcome === "reading") return <span className="chip neutral"><span className="spin sm" aria-hidden="true" />Reading</span>;
  if (page.outcome === "read") return <Chip tone="ok">Read</Chip>;
  return <Chip tone="bad">{page.outcome === "not-found" ? "Not found" : "Couldn't read"}</Chip>;
}

function FoundPanel({ probe: p, company, busy, disabled, onAdd }: {
  probe: SystemProbe; company: string; busy: boolean; disabled: boolean; onAdd: () => void;
}) {
  const name = p.source?.name ?? company;
  const counts = p.openJobs == null
    ? "Too many open jobs to count in one request; the first check counts them."
    : p.inLocations == null
      ? `${plural(p.openJobs, "open job")}; the first check finds those in your locations.`
      : `${plural(p.openJobs, "open job")}, ${p.inLocations} in your locations.`;
  return (
    <div className="panel narrow-panel">
      <div className="panel-h"><h2>{name} · {p.label}</h2><span className="grow" /><Chip tone="ok">Found</Chip></div>
      <p className="muted" style={{ fontSize: "var(--fs-small)" }}>
        <b>{counts}</b> {p.sourceId
          ? "It's already on your watchlist."
          : "Those in your locations appear in the Feed after the first check; the rest are kept but hidden as outside your locations."}
      </p>
      {!p.sourceId && (
        <div className="row">
          <button className="btn primary" type="button" onClick={onAdd} disabled={disabled}>
            {busy ? "Adding…" : "Add to watchlist"}<span className="sr-only">: {name} on {p.label}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Other ways to still catch the company's jobs, best first (email alert, aggregators, a different link). */
function Fallbacks({ company, fallbacks, onLink }: { company: string; fallbacks: Fallback[]; onLink: (link: string) => void }) {
  return (
    <section className="stack" style={{ gap: "var(--s-4)" }} aria-labelledby="fb-h">
      <h2 id="fb-h">Other ways to still catch {possessive(company)} jobs</h2>
      {fallbacks.map((f, i) => <FallbackCard key={f.kind} n={i + 1} company={company} fallback={f} onLink={onLink} />)}
    </section>
  );
}

function FallbackCard({ n, company, fallback: f, onLink }: { n: number; company: string; fallback: Fallback; onLink: (link: string) => void }) {
  const [link, setLink] = useState("");
  if (f.kind === "email-alert") {
    return (
      <div className="alt">
        <div className="panel-h"><h3>{n} · Email alert from LinkedIn</h3><span className="chip met">Recommended</span></div>
        <p className="muted" style={{ fontSize: "var(--fs-small)" }}>
          Follow {company} on LinkedIn and turn on job alerts for the company, sent to your job address. They forward to your job mailbox and appear in the Feed under "LinkedIn job alerts".
        </p>
        <details>
          <summary>Show me the steps</summary>
          <ol className="steps">
            <li>On LinkedIn, open {possessive(company)} page and press <b>Follow</b>.</li>
            <li>Open its <b>Jobs</b> tab and turn on <b>job alerts</b> for the company, delivered by email.</li>
            <li>Make sure LinkedIn sends alerts to your job address (the one that forwards to the job mailbox).</li>
            <li>If <code>email:linkedin</code> isn't in your <code>APPLY_KIT_SOURCES</code> yet, add it and restart apply-kit (the README has the mailbox setup).</li>
          </ol>
        </details>
      </div>
    );
  }
  if (f.kind === "aggregators") {
    const names = f.sources.map((s) => s.name);
    return (
      <div className="alt">
        <h3>{n} · Aggregators already watching</h3>
        <p className="muted" style={{ fontSize: "var(--fs-small)" }}>
          {f.jobs > 0
            ? `${list(names)} listed ${plural(f.jobs, `${company} job`)} in the last month, so many reach you anyway. Add ${company} as a company filter in those searches to be sure.`
            : `None of your aggregators or job sites listed ${company} jobs in the last month, so this company would be missed without an alert.`}
        </p>
      </div>
    );
  }
  return (
    <div className="alt">
      <h3>{n} · Try a different link</h3>
      <form className="field" onSubmit={(e) => { e.preventDefault(); if (link.trim()) onLink(link.trim()); }}>
        <label htmlFor="fb-link">Careers page link</label>
        <span className="help" id="fb-help">If you've seen their job page, paste its address and apply-kit checks again.</span>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input
            className="input" id="fb-link" name="careers-link" type="url" inputMode="url" autoComplete="off" spellCheck={false}
            aria-describedby="fb-help" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)}
          />
          <button className="btn" type="submit">Check</button>
        </div>
      </form>
    </div>
  );
}

function doneSummary(d: CompanyDetection): string {
  const asked = d.systems.length;
  const page = !d.careersPage ? ""
    : d.careersPage.outcome === "read" ? " and read their careers page"
    : ` and their careers page, which ${d.careersPage.outcome === "not-found" ? 'returned "page not found"' : `couldn't be read (${d.careersPage.message ?? "error"})`}`;
  if (d.fallbacks.length > 0) {
    return `Checked ${asked} job systems${page}. ${d.company} probably runs its own site, which apply-kit doesn't scrape.`;
  }
  const found = d.systems.filter((s) => s.status === "found").map((s) => s.label);
  const own = d.systems.filter((s) => s.status === "needs-search").map((s) => s.label);
  return `Checked ${asked} job systems${page}. ${found.length ? `Found on ${list(found)}.` : ""}${own.length ? ` ${list(own)} has its own careers search: add it with search words in APPLY_KIT_SOURCES (see the README).` : ""}`.trim();
}

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
