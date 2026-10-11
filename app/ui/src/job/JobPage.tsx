// The Job page (hi-fi: docs/design/hifi/job.html): Fit check area, requirements with evidence,
// key facts with "Show where", low-confidence facts for Kris to confirm, and the reading,
// couldn't-read and unscreened states.
import type { FactAnswer, HealthSummary, JobDetail, KeyFact, NeedsYouItem, FactSource } from "@apply-kit/core";
import { useEffect, useId, useState, type FormEvent } from "react";
import { confirmFact, fetchJob, fetchSources, readJob } from "../api.ts";
import { Chevron, Icon } from "../icons.tsx";
import { AskChip, StatusChip } from "../requirements.tsx";

type Load = { state: "loading" } | { state: "missing" } | { state: "error"; message: string } | { state: "ready"; job: JobDetail };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function JobPage({ id, onHealth }: { id: string; onHealth: (h: HealthSummary) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [said, say] = useState("");

  // The top bar shows source health on every screen.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchJob(id, ctrl.signal)
      .then((job) => setLoad({ state: "ready", job }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const m = message(err);
        setLoad(m === "No such job" ? { state: "missing" } : { state: "error", message: m });
      });
    return () => ctrl.abort();
  }, [id, attempt]);

  // An unread posting is read as soon as its page opens; one being read is followed until it's done.
  const readingState = load.state === "ready" ? load.job.reading.state : null;
  useEffect(() => {
    if (readingState === "unread") {
      let live = true;
      readJob(id)
        .then((job) => { if (live) { setLoad({ state: "ready", job }); say(doneText(job)); } })
        .catch((err: unknown) => { if (live) say(`Couldn't read the posting: ${message(err)}`); });
      return () => { live = false; };
    }
    if (readingState === "reading") {
      const timer = setTimeout(() => setAttempt((n) => n + 1), 2_000);
      return () => clearTimeout(timer);
    }
  }, [id, readingState, attempt]);

  const titled = load.state === "ready" ? `${load.job.title} · ${load.job.company}` : null;
  useEffect(() => { document.title = `${titled ?? "Job"} · apply-kit`; }, [titled]);

  if (load.state === "loading") return <p className="meta" role="status">Loading the job…</p>;
  if (load.state === "missing") {
    return (
      <div className="empty">
        <h1>No such job</h1>
        <p>It may have come from a database that has since been replaced. Everything that is kept is in the Feed.</p>
        <a className="btn" href="/">Back to the Feed</a>
      </div>
    );
  }
  if (load.state === "error") {
    return (
      <div className="banner error" role="alert">
        <span className="text"><b>Couldn't reach the apply-kit service.</b> {load.message}. Check that it is running, then try again.</span>
        <button className="btn sm" type="button" onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}>Try again</button>
      </div>
    );
  }

  const { job } = load;
  const state = job.reading.state;
  const tryAgain = () => {
    say("Reading the posting again…");
    setLoad({ state: "ready", job: { ...job, reading: { state: "reading", error: null } } });
    readJob(id).then((j) => { setLoad({ state: "ready", job: j }); say(doneText(j)); }).catch((err: unknown) => say(`Couldn't read the posting: ${message(err)}`));
  };
  const answered = (j: JobDetail, text: string) => { setLoad({ state: "ready", job: j }); say(text); };

  return (
    <section className="stack job-page" style={{ gap: "var(--s-6)" }}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/">Feed</a><span aria-hidden="true">/</span><span aria-current="page">{job.title}</span>
      </nav>

      {state === "failed" && (
        <div className="banner error" role="alert">
          <span className="text"><b>Couldn't read this posting's requirements.</b> {job.reading.error}. The posting itself is saved, nothing was lost.</span>
          <button className="btn sm" type="button" onClick={tryAgain}>Try again</button>
        </div>
      )}
      {state === "unscreened" && <UnscreenedBanner job={job} />}
      {state === "read" && job.needsYou.length > 0 && (
        <div className="needs">
          <div>
            <b>{job.needsYou.length} {job.needsYou.length === 1 ? "fact needs" : "facts need"} you</b>
            <div className="meta">The posting is unclear here. Until you answer, screening uses the cautious reading.</div>
          </div>
          <a className="btn" href={`#q-${cssId(job.needsYou[0]!.key)}`}>Answer now</a>
        </div>
      )}

      <JobHead job={job} />

      <div className="cols">
        <div className="col">
          {(state === "unread" || state === "reading") && <ReadingPanel />}
          {state === "read" && (
            <>
              {job.needsYou.length > 0 && (
                <div className="stack o3" style={{ gap: "var(--s-6)" }}>
                  {job.needsYou.map((n) => <AskPanel key={n.key} jobId={job.id} item={n} onAnswered={answered} />)}
                </div>
              )}
              <FitCheck job={job} />
              <Requirements job={job} />
              <KeyFacts facts={job.keyFacts} />
              <FullPosting job={job} open={false} />
            </>
          )}
          {(state === "failed" || state === "unscreened") && <FullPosting job={job} open />}
        </div>
        <div className="col side">
          <Decide job={job} />
          <Postings job={job} />
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
    </section>
  );
}

function doneText(job: JobDetail): string {
  if (job.reading.state === "read") {
    const n = job.needsYou.length;
    return `Posting read: ${job.requirements.length} requirements${n ? `, ${n} ${n === 1 ? "fact needs" : "facts need"} you` : ""}.`;
  }
  if (job.reading.state === "failed") return `Couldn't read the posting: ${job.reading.error}.`;
  if (job.reading.state === "unscreened") return "Not read: this month's AI budget is used up.";
  return "";
}

const cssId = (key: string) => key.replace(/[^a-z0-9]/gi, "-");

function JobHead({ job }: { job: JobDetail }) {
  const salary = job.keyFacts.find((f) => f.key === "salary");
  const salaryText = job.salary ?? (salary ? salary.value : job.reading.state === "read" ? "Salary not stated" : null);
  return (
    <div className="job-head">
      <h1 tabIndex={-1}>{job.title}</h1>
      <div className="job-meta">
        <b>{job.company}</b>
        <span>{job.location ?? "Location not stated"}</span>
        {salary?.needsYou ? <AskChip label="Salary unclear" /> : salaryText && <span className="num">{salaryText}</span>}
        {job.postedAt && <span>Posted {new Date(job.postedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
      </div>
      <div className="chips">
        {job.reading.state === "read" && job.needsYou.length > 0 && <span className="chip partly"><Icon name="partly" />Screening provisional</span>}
        {job.reading.state === "failed" && <span className="chip neutral">Fit check not run</span>}
        {job.reading.state === "unscreened" && <span className="chip neutral">Unscreened</span>}
        <span className="chip neutral">Seen in {job.postings.length} {job.postings.length === 1 ? "posting" : "postings"}</span>
      </div>
    </div>
  );
}

function UnscreenedBanner({ job }: { job: JobDetail }) {
  const { capUsd, spentUsd } = job.budget;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return (
    <div className="banner warning" role="status">
      <span className="text">
        {capUsd <= 0
          ? <><b>Not screened: no monthly AI budget is set.</b> Postings aren't read until AI_MONTHLY_CAP_USD is set in .env. The job stays in your Feed either way.</>
          : <><b>Not screened: this month's AI budget is used up</b> ({usd(spentUsd)} of {usd(capUsd)}). The job stays in your Feed and is read when the budget allows: next month, or after raising AI_MONTHLY_CAP_USD.</>}
      </span>
    </div>
  );
}

function ReadingPanel() {
  return (
    <>
      <div className="panel o1" role="status" aria-live="polite">
        <div className="sec-head"><h2>Reading the posting</h2><span className="grow" /><span className="meta">Usually 5–10 seconds</span></div>
        <ol className="steps">
          <li className="done"><span className="ic"><Icon name="met" /></span><span className="sr-only">Done: </span>Fetched the posting</li>
          <li className="now" aria-current="step"><span className="ic"><span className="spin" aria-hidden="true" /></span><span className="sr-only">In progress: </span>Pulling out requirements and key facts</li>
          <li className="next"><span className="ic" aria-hidden="true" /><span className="sr-only">Next: </span>Checking which facts are unclear</li>
        </ol>
      </div>
      <div className="panel flush o3" aria-hidden="true" aria-busy="true">
        <div className="sec-head"><h2>Requirements</h2></div>
        <div className="table-wrap">
          <table className="table req">
            <thead><tr><th>Requirement</th><th>Asked as</th><th>You</th><th>Evidence in your master profile</th></tr></thead>
            <tbody>
              {[["w80", "w60", "w40", "w90"], ["w60", "w60", "w40", "w80"], ["w80", "w40", "w40", "w60"]].map((r, i) => (
                <tr key={i}>{r.map((w, j) => <td key={j}><span className={`skel ${w}`} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel o3" aria-hidden="true" aria-busy="true"><span className="skel w30" /><span className="skel w90" /><span className="skel w80" /></div>
    </>
  );
}

/** The Fit check area. Fit needs the master profile; until it exists this says so plainly. */
function FitCheck({ job }: { job: JobDetail }) {
  const required = job.requirements.filter((r) => r.kind === "required").length;
  const preferred = job.requirements.length - required;
  return (
    <article className="panel o1" aria-labelledby="fit-h">
      <div className="fitcheck">
        <div className="fit-num provisional">–<small>no fit yet</small></div>
        <div className="verdict">
          <h2 id="fit-h">Fit check: not available yet</h2>
          <p>
            {job.requirements.length} requirements read: {required} required, {preferred} preferred.
            Whether you meet them isn't checked yet: that needs your master profile, so nothing here is marked met or missing.
          </p>
          {job.screening?.provisional && (
            <p className="meta">Until you answer the questions above, screening uses the cautious reading: unclear requirements count as preferred, an unclear salary as not stated.</p>
          )}
        </div>
      </div>
    </article>
  );
}

function Requirements({ job }: { job: JobDetail }) {
  const ask = job.requirements.filter((r) => r.needsYou).length;
  const summary = job.requirements.length === 0
    ? "None found in the posting"
    : `${job.requirements.length} found${ask ? ` · ${job.requirements.length - ask} read confidently · ${ask} waiting on you` : ""}`;
  return (
    <div className="panel flush o3">
      <div className="sec-head"><h2>Requirements</h2><span className="meta">{summary}</span></div>
      {job.requirements.length > 0 && (
        <div className="table-wrap">
          <table className="table req" aria-label="Requirements from the posting">
            <thead><tr><th scope="col">Requirement</th><th scope="col">Asked as</th><th scope="col">You</th><th scope="col">Evidence in your master profile</th></tr></thead>
            <tbody>
              {job.requirements.map((r) => (
                <tr key={r.key} className={r.needsYou ? "is-ask" : undefined}>
                  <td>{r.text}</td>
                  <td className="asked">{r.askedAs}</td>
                  <td>{r.needsYou ? <AskChip label="Needs you" /> : <StatusChip status={r.status} label={r.status === "unknown" ? "Not checked" : r.status} />}</td>
                  <td className="ev">{r.status === "unknown" ? "No master profile yet" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Quote({ source }: { source: FactSource }) {
  return (
    <>
      <span>“{source.quote}”</span>
      {source.translation && <span className="tr">{source.translation}</span>}
      <span className="where">{source.line != null ? `Posting text, line ${source.line}` : "Not found word for word in the posting text: check it yourself"}</span>
    </>
  );
}

function KeyFacts({ facts }: { facts: KeyFact[] }) {
  return (
    <div className="panel o3">
      <div className="sec-head"><h2>Key facts</h2><span className="meta">From the posting. Each one shows the line it came from.</span></div>
      <dl className="facts">{facts.map((f) => <Fact key={f.key} fact={f} />)}</dl>
    </div>
  );
}

function Fact({ fact }: { fact: KeyFact }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="fact">
      <dt>{fact.label}</dt>
      <dd>{fact.value}{fact.needsYou && <> <AskChip label="Needs you" /></>}</dd>
      <dd>
        {fact.source
          ? <button className="btn ghost sm" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Chevron />Show where<span className="sr-only">: {fact.label}</span></button>
          : <span className="meta">Not in the posting</span>}
      </dd>
      {fact.source && <div id={id} className="src" hidden={!open}><Quote source={fact.source} /></div>}
    </div>
  );
}

function AskPanel({ jobId, item, onAnswered }: { jobId: string; item: NeedsYouItem; onAnswered: (j: JobDetail, said: string) => void }) {
  const [answer, setAnswer] = useState<FactAnswer>("cautious");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = useId();
  const same = item.extracted === item.cautious;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    confirmFact(jobId, item.key, same ? "extracted" : answer)
      .then((j) => onAnswered(j, `${item.label}: using “${same || answer === "extracted" ? item.extracted : item.cautious}” for this job.`))
      .catch((err: unknown) => { setError(message(err)); setBusy(false); });
  };
  const hId = `q-${cssId(item.key)}-h`;
  return (
    <form className="panel ask-panel" id={`q-${cssId(item.key)}`} aria-labelledby={hId} onSubmit={submit}>
      <div className="sec-head"><h2 id={hId}>{item.question}</h2><AskChip label="Needs you" /></div>
      {item.source && <div className="src"><Quote source={item.source} /></div>}
      {same ? (
        <p className="muted mini">Read as “{item.extracted}”, but not confidently. It can't count against the job either way.</p>
      ) : (
        <fieldset>
          <legend>Which reading is right?</legend>
          <label className="opt">
            <input type="radio" name={name} checked={answer === "extracted"} onChange={() => setAnswer("extracted")} />
            <span>{item.extracted}<span className="meta">As the model read it</span></span>
          </label>
          <label className="opt">
            <input type="radio" name={name} checked={answer === "cautious"} onChange={() => setAnswer("cautious")} />
            <span>{item.cautious}<span className="meta">The cautious reading, used until you answer</span></span>
          </label>
        </fieldset>
      )}
      <div className="row">
        <button className="btn sm" type="submit" disabled={busy}>{same ? "That's right" : "Use this reading"}</button>
        <span className="meta">Only for this job. The posting itself isn't changed.</span>
      </div>
      {error && <p className="meta" role="alert">{error}</p>}
    </form>
  );
}

function FullPosting({ job, open }: { job: JobDetail; open: boolean }) {
  const [shown, setShown] = useState(open);
  const id = useId();
  const lines = job.postingText.split("\n").filter(Boolean);
  const host = (() => { try { return new URL(job.url).host; } catch { return job.url; } })();
  const body = lines.length === 0
    ? <p className="meta">This posting has no text. Open it on {host} to read it.</p>
    : <div id={id} className="posting-text" hidden={!shown}>{lines.map((l, i) => l.startsWith("• ") ? <p key={i} className="li">{l.slice(2)}</p> : <p key={i}>{l}</p>)}</div>;
  if (open) {
    return (
      <div className="panel o1">
        <div className="sec-head"><h2>Full posting</h2><span className="meta">Read it yourself in the meantime · {host}</span></div>
        {body}
      </div>
    );
  }
  return (
    <div className="panel o3">
      <button className="disclose" type="button" aria-expanded={shown} aria-controls={id} onClick={() => setShown(!shown)}>
        <Chevron />Full posting <span className="meta">{host} · {lines.length} lines</span>
      </button>
      {body}
    </div>
  );
}

function Decide({ job }: { job: JobDetail }) {
  const why = job.reading.state === "read"
    ? "Packages arrive with a later part of the rebuild."
    : "A package needs the requirements first, and packages arrive with a later part of the rebuild.";
  return (
    <div className="panel decide o2" role="group" aria-label="Decide">
      <button className="btn primary" type="button" disabled aria-describedby="prep-why">Prepare package</button>
      <p className="why-off" id="prep-why">{why}</p>
      <a className="btn" href={job.url} target="_blank" rel="noopener noreferrer">Open the posting<span className="sr-only"> (new tab)</span><span aria-hidden="true"> ↗</span></a>
    </div>
  );
}

function Postings({ job }: { job: JobDetail }) {
  return (
    <div className="panel o4">
      <div className="sec-head"><h2>Postings</h2><span className="meta">{job.postings.length}</span></div>
      <div className="postings">
        {job.postings.map((p) => (
          <div className="posting" key={p.id}>
            <span className="name">{p.source}</span>
            <span className="meta">First seen {new Date(p.firstSeenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            <div className="row acts">
              <a className="btn ghost sm" href={p.url} target="_blank" rel="noopener noreferrer">Open<span className="sr-only"> the {p.source} posting</span><span aria-hidden="true"> ↗</span></a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
