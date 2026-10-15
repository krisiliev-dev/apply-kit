// The Job page (hi-fi: docs/design/hifi/job.html): Fit check area, requirements with evidence,
// key facts with "Show where", low-confidence facts for Kris to confirm, the reading,
// couldn't-read and unscreened states, the Postings merged into the Job (target, split), and
// Bulgarian postings shown in English with the original one click away, and a closed Job: how it
// closed, Prepare disabled with the reason, reopen (with Undo) and similar open Jobs. Prepare (#62)
// starts the Job's package, or shows "Continue package · step N of 5" or "Package ready".
import type { FactAnswer, FeedJob, Fit, FitBand, HealthSummary, JobDetail, JobMarker, JobRequirement, KeyFact, NeedsYouItem, FactSource, PrepareStatus, RequirementEvidence } from "@apply-kit/core";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { boostJob, confirmFact, fetchJob, fetchPrepareStatus, fetchSources, readJob, reopenJobs, setPackageLanguage, startPackage, undoAdjustment, undoApplicationEvent, undoDecision } from "../api.ts";
import { useToaster, type Toaster } from "../feed/toast.tsx";
import { Chevron, Icon } from "../icons.tsx";
import { AskChip, StatusChip, statusLabel as requirementLabel } from "../requirements.tsx";
import { PostingsPanel } from "./PostingsPanel.tsx";
import { AddApplicationDialog, type Added } from "../applications/AddApplicationDialog.tsx";
import { shortDay, statusLabel } from "../applications/words.ts";
import { agoWords, AppliedPill, applicationHref, weekdayDay } from "../applications/markers.tsx";

type Load = { state: "loading" } | { state: "missing" } | { state: "error"; message: string } | { state: "ready"; job: JobDetail };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function JobPage({ id, onHealth }: { id: string; onHealth: (h: HealthSummary) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [said, say] = useState("");
  // What Track knows about this Job (its Application, the History with its company).
  const [track, setTrack] = useState<JobMarker | null>(null);
  const toaster = useToaster();

  // The top bar shows source health on every screen.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchJob(id, ctrl.signal)
      .then((job) => {
        setLoad({ state: "ready", job });
        setTrack(job.track);
        // A Job merged into another lives on under that Job's id.
        if (job.id !== id) window.history.replaceState(null, "", `/jobs/${encodeURIComponent(job.id)}`);
      })
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

  const titled = load.state === "ready" ? `${titleOf(load.job)} · ${load.job.company}` : null;
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
  const refresh = () => fetchJob(job.id).then((j) => { setLoad({ state: "ready", job: j }); setTrack(j.track); });
  const reopen = () => {
    reopenJobs([job.id])
      .then(async (decision) => {
        await refresh();
        toaster.show({
          message: `Reopened · ${titleOf(job)} at ${job.company}. It's back in All open.`,
          undo: () => { undoDecision(decision.id).then(refresh).then(() => toaster.announce("Undone. The job is closed again.")).catch((err: unknown) => say(`Couldn't undo: ${message(err)}`)); },
        });
      })
      .catch((err: unknown) => say(`Couldn't reopen the job: ${message(err)}`));
  };

  return (
    <section className="stack job-page" style={{ gap: "var(--s-6)" }}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/">Feed</a><span aria-hidden="true">/</span><span aria-current="page">{titleOf(job)}</span>
      </nav>

      {job.closed && (
        <div className="banner info">
          <span className="text">
            <b>This job closed on {shortDate(job.closed.at)}: {job.closed.how}.</b> It stays here so nothing you saved or noted is lost, and you can find it later in <a href="/">Feed › Passed &amp; closed</a>.
          </span>
        </div>
      )}
      <PastedLinkNote />
      <TrackBanner job={job} track={track} />
      {job.unverified && (
        <div className="banner warning">
          <span className="text">
            <b>Unverified since {shortDate(job.unverified.since)}.</b> You captured or pasted this job, and no job system apply-kit checks has listed it for 30 days. It stays in your Feed; check the posting is still open before preparing a package.
          </span>
        </div>
      )}

      {job.language === "bg" && <BulgarianBanner job={job} />}

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

      <JobHead job={job} track={track} />

      <div className="cols">
        <div className="col">
          {job.closed && <SimilarJobs jobs={job.similar} />}
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
          {state !== "read" && <FitCheck job={job} />}
        </div>
        <div className="col side">
          <Decide job={job} track={track} onReopen={reopen} onTracked={refresh} toaster={toaster} />
          {/* With Applications at this company, their history comes right after the decision. */}
          {track?.history.length ? <History job={job} track={track} /> : null}
          <Boost job={job} onChanged={answered} />
          <PostingsPanel job={job} onChanged={answered} />
          {!track?.history.length && <History job={job} track={track} />}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
      {toaster.element}
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

/** The title Kris reads: the English one for a posting in another language. */
const titleOf = (job: JobDetail) => job.titleTranslation ?? job.title;
const languageNames: Record<string, string> = { bg: "Bulgarian", de: "German", fr: "French", es: "Spanish" };
const languageName = (code: string | null) => (code && languageNames[code]) || "another language";

const bandLabel: Record<FitBand, string> = { strong: "Strong fit", good: "Good fit", stretch: "Stretch" };
const bandChip: Record<FitBand, "met" | "partly" | "neutral"> = { strong: "met", good: "met", stretch: "neutral" };

function JobHead({ job, track }: { job: JobDetail; track: JobMarker | null }) {
  const salary = job.keyFacts.find((f) => f.key === "salary");
  const salaryText = job.salary ?? (salary ? salary.value : job.reading.state === "read" ? "Salary not stated" : null);
  const { fit } = job;
  return (
    <div className="job-head">
      <h1 tabIndex={-1}>
        {titleOf(job)}
        {job.titleTranslation && <span className="orig" lang={job.language ?? undefined}>{job.title}</span>}
      </h1>
      <div className="job-meta">
        <b>{job.company}</b>
        <span>{job.location ?? "Location not stated"}</span>
        {salary?.needsYou ? <AskChip label="Salary unclear" /> : salaryText && <span className="num">{salaryText}</span>}
        {job.postedAt && <span>Posted {new Date(job.postedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
      </div>
      <div className="chips">
        {fit.provisional
          ? <span className="chip partly"><Icon name="partly" />{bandLabel[fit.band]} · provisional</span>
          : <span className={`chip ${bandChip[fit.band]}`}>{fit.band !== "stretch" && <Icon name="met" />}{bandLabel[fit.band]}</span>}
        {fit.angle && <span className="chip neutral">{angleName(fit)} angle</span>}
        {job.reading.state === "read" && job.needsYou.length > 0 && <span className="chip partly"><Icon name="partly" />Screening provisional</span>}
        {job.reading.state === "failed" && <span className="chip neutral">Fit check not run</span>}
        {job.reading.state === "unscreened" && <span className="chip neutral">Unscreened</span>}
        {job.language && job.language !== "en" && <span className="chip neutral">{languageName(job.language)} original</span>}
        <span className="chip neutral">Seen in {job.postings.length} {job.postings.length === 1 ? "posting" : "postings"}</span>
        {track?.application ? <AppliedPill application={track.application} /> : track?.sameCompany && <span className="chip applied">Applied before</span>}
      </div>
    </div>
  );
}

const angleName = (fit: Fit) => (fit.angle ? fit.angle.charAt(0).toUpperCase() + fit.angle.slice(1) : "");

/** A posting not in English: read from the original, shown in English, the original one click away. */
function BulgarianBanner({ job }: { job: JobDetail }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const lines = job.postingText.split("\n").filter(Boolean);
  const read = job.reading.state === "read";
  return (
    <>
      <div className="banner info">
        <span className="text">
          <b>This posting is in {languageName(job.language)}.</b>{" "}
          {read
            ? "Requirements and facts were read from the original and are shown in English. Quotes stay in the original, with a translation under each."
            : "Once it's read, requirements and facts are shown in English, with the original quotes kept."}
        </span>
        <button className="btn sm" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Chevron />View original</button>
      </div>
      <section id={id} className="panel" aria-label="Original posting" hidden={!open}>
        <p className="meta">Original · {job.postings.find((p) => p.isTarget)?.source.name ?? "posting"} · {job.company}</p>
        <div className="posting-text" lang={job.language ?? undefined}>
          <h2 style={{ fontSize: "var(--fs-body)" }}>{job.title}</h2>
          {lines.length === 0 ? <p className="meta">This posting has no text.</p> : lines.map((l, i) => <p key={i} className={l.startsWith("• ") ? "li" : undefined}>{l.startsWith("• ") ? l.slice(2) : l}</p>)}
        </div>
      </section>
    </>
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

/** The Fit check: the number, what it is made of ("What makes up 91?"), closest angle and gaps. */
function FitCheck({ job }: { job: JobDetail }) {
  const { fit } = job;
  const [open, setOpen] = useState(false);
  const id = useId();
  const read = job.reading.state === "read";
  const title = fit.provisional ? "Fit check: provisional" : `Fit check: ${bandLabel[fit.band].toLowerCase()}`;
  const parts = fit.reasons.filter((r) => r.factor !== "adjustment");
  const adjustments = fit.reasons.filter((r) => r.factor === "adjustment");
  const points = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}`;
  return (
    <article className="panel o1" aria-labelledby="fit-h">
      <div className="fitcheck">
        <div className={`fit-num${fit.provisional ? " provisional" : ""}`}>
          {fit.provisional && <span aria-hidden="true">~</span>}{fit.value}<small>{fit.provisional ? "fit · provisional" : "fit"}</small>
        </div>
        <div className="verdict">
          <h2 id="fit-h">{title}</h2>
          <p>{fit.why}.</p>
          {!read && <p className="meta">The posting isn't read yet, so this Fit comes from the title, location and date only.</p>}
          {read && job.screening?.provisional && (
            <p className="meta">Until you answer the questions above, the Fit uses the cautious reading: unclear requirements count as preferred, an unclear salary as not stated.</p>
          )}
          <div>
            <button className="btn ghost sm" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Chevron />What makes up {fit.value}?</button>
          </div>
          <div id={id} className="fit-why" hidden={!open}>
            <p className="muted">Fit is how well this job matches your profile and preferences, 0–100. Strong is 85 and up, good 70–84, stretch below 70. A part that can't be told yet is left out, never counted against the job.</p>
            <dl className="kv">
              {parts.map((r) => (
                <div key={r.factor} style={{ display: "contents" }}>
                  <dt>{r.label}</dt>
                  <dd>{r.text} · {r.score == null ? "left out for now" : `${points(r.points)} points`}</dd>
                </div>
              ))}
              <dt>Learned adjustments</dt>
              <dd>
                {adjustments.length === 0 ? "None affect this job" : adjustments.map((a) => `${a.text} (${points(a.points)})`).join(" · ")}
                {" · "}<a href="/profile/search#ranking">review or undo</a>
              </dd>
            </dl>
          </div>
        </div>
        <dl className="kv">
          <dt>Closest angle</dt>
          <dd>{fit.angle ? parts.find((r) => r.factor === "angle")!.text : "None of developer, security or design, going by the title and requirements"}</dd>
          <dt>Where</dt>
          <dd>{fit.place.label}{fit.place.tier === "relocation" && <span className="meta"> · shown with the Relocation filter</span>}</dd>
          <dt>Dealbreakers</dt>
          <dd>
            {!read ? <span className="meta">Checked once the posting is read. Until then the job is never hidden.</span>
              : job.dealbreakers.length === 0 ? <span className="meta">None apply</span>
              : (
                <>
                  <div className="chips">{job.dealbreakers.map((d) => <span key={d.key} className="chip hidden-reason">{d.text}</span>)}</div>
                  <span className="meta">
                    {job.hidden ? "Hidden from the Feed: it's in the hidden pile." : job.shownByYou ? "Shown in the Feed because you chose Show this job." : "Shown in the Feed because you decided on it."}
                    {" "}<a href="/profile/search">Edit dealbreakers</a>
                  </span>
                </>
              )}
          </dd>
          <dt>Gaps</dt>
          <dd>
            {fit.gaps.length > 0
              ? <div className="chips">{fit.gaps.map((g) => <StatusChip key={g} status="gap" label={g} />)}</div>
              : <span className="meta">{!read ? "Not known until the posting is read." : job.requirements.some((r) => r.evidence) ? "None: your master profile has evidence for every required item it can check." : "None known: whether you meet each requirement needs your master profile, so nothing is counted as a gap yet."}</span>}
          </dd>
        </dl>
      </div>
    </article>
  );
}

function Requirements({ job }: { job: JobDetail }) {
  const reqs = job.requirements;
  const ask = reqs.filter((r) => r.needsYou).length;
  const checked = reqs.some((r) => r.evidence);
  const n = (s: JobRequirement["status"]) => reqs.filter((r) => !r.needsYou && r.status === s).length;
  // The same counts as the Feed row's chips: needs-you items are counted once, as waiting on you.
  const counts = [
    `${n("met")} met`,
    n("partly") ? `${n("partly")} partly` : "",
    n("gap") ? `${n("gap")} ${n("gap") === 1 ? "gap" : "gaps"}` : "",
    n("not-held") ? `${n("not-held")} preferred not held` : "",
    n("unknown") ? `${n("unknown")} not checked` : "",
  ].filter(Boolean);
  const summary = reqs.length === 0
    ? "None found in the posting"
    : checked
      ? [`${reqs.length} found`, ...counts, ask ? `${ask} waiting on you` : ""].filter(Boolean).join(" · ")
      : `${reqs.length} found${ask ? ` · ${reqs.length - ask} read confidently · ${ask} waiting on you` : ""}`;
  return (
    <div className="panel flush o3">
      <div className="sec-head"><h2>Requirements</h2><span className="meta">{summary}</span></div>
      {job.requirements.length > 0 && (
        <div className="table-wrap">
          <table className="table req" aria-label={checked ? "Requirements against your master profile" : "Requirements from the posting"}>
            <thead><tr><th scope="col">Requirement</th><th scope="col">Asked as</th><th scope="col">You</th><th scope="col">Evidence in your master profile</th></tr></thead>
            <tbody>
              {reqs.map((r) => (
                <tr key={r.key} className={r.needsYou ? "is-ask" : undefined}>
                  <td>{r.text}</td>
                  <td className="asked">{r.askedAs}</td>
                  <td>{r.needsYou ? <AskChip label="Needs you" /> : <StatusChip status={r.status} label={requirementLabel[r.status]} />}</td>
                  <td className="ev">{r.evidence ? <EvidenceCell evidence={r.evidence} /> : "No master profile yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The pieces behind a status, each linked to its place in Profile, then what was found. */
function EvidenceCell({ evidence }: { evidence: RequirementEvidence }) {
  return (
    <>
      {evidence.pieces.map((p, i) => (
        <span key={p.id}>{i > 0 && " · "}<a href={`/profile/pieces/${encodeURIComponent(p.id)}`}>{p.label}</a></span>
      ))}
      {evidence.note && <>{evidence.pieces.length > 0 && <br />}<span className={evidence.pieces.length > 0 ? "meta" : undefined}>{evidence.note}</span></>}
    </>
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
      <div className="sec-head"><h2>Key facts</h2><span className="meta">From the target posting. Each one shows the line it came from.</span></div>
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

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** On a closed Job: open Jobs with the same closest angle, best Fit first. */
function SimilarJobs({ jobs }: { jobs: FeedJob[] }) {
  return (
    <div className="panel flush o1">
      <div className="sec-head"><h2>Similar open jobs</h2><span className="meta">Same angle, best fit first</span></div>
      {jobs.length === 0
        ? <p className="meta" style={{ padding: "0 var(--s-5) var(--s-5)" }}>No open jobs share this job's angle right now.</p>
        : (
          <div className="table-wrap">
            <table className="table" aria-label="Similar open jobs">
              <thead><tr><th scope="col">Job</th><th scope="col">Where</th><th scope="col">Salary</th><th scope="col" className="r">Fit</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td><a href={`/jobs/${encodeURIComponent(j.id)}`}>{j.titleTranslation ?? j.title}</a><span className="src-id">{j.company}</span></td>
                    <td>{j.location ?? "Not stated"}</td>
                    <td className="num">{j.salary ?? "Not stated"}</td>
                    <td className="r num">{j.fit.provisional ? "~" : ""}{j.fit.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

/** An open Application on this Job (the main action becomes Open application), or null. */
const openApplication = (track: JobMarker | null) =>
  track?.application && !isClosed(track.application.status) ? track.application : null;
const isClosed = (s: string) => s === "rejected" || s === "withdrawn";

function Decide({ job, track, onReopen, onTracked, toaster }: {
  job: JobDetail;
  track: JobMarker | null;
  onReopen: () => void;
  /** Fetch what Track knows again (after "I applied" and its undo). */
  onTracked: () => Promise<void>;
  toaster: Toaster;
}) {
  const [language, setLanguage] = useState(job.packageLanguage);
  const [status, setStatus] = useState<PrepareStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const packagePage = `/jobs/${encodeURIComponent(job.id)}/package`;

  // The button's state comes from the service: it can start, why it can't, or the Job's package.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchPrepareStatus(job.id, ctrl.signal).then(setStatus).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, [job.id, job.reading.state, job.state]);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const r = await startPackage(job.id);
      if (!r.started) {
        setStatus({ canStart: false, problem: r.problem, reason: r.reason, package: null });
        return;
      }
      if (language !== r.package.language) await setPackageLanguage(r.package.id, language);
      window.location.assign(packagePage);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const [adding, setAdding] = useState(false);
  const appliedRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);
  const open = openApplication(track);
  // Once added, focus moves to Open application (the button that opened the dialog is gone);
  // after Undo, back to the button.
  const focusNext = useRef<"open" | "applied" | null>(null);
  useEffect(() => {
    if (focusNext.current === "open" && open) { focusNext.current = null; openRef.current?.focus(); }
    if (focusNext.current === "applied" && !open) { focusNext.current = null; appliedRef.current?.focus(); }
  }, [open]);
  const applied = (result: Added) => {
    setAdding(false);
    focusNext.current = "open";
    onTracked().catch((err: unknown) => toaster.show({ message: `Added, but couldn't refresh the page: ${message(err)}` }));
    const a = result.application;
    toaster.show({
      message: `Added to Applications · ${statusLabel[a.status]} ${shortDay(a.appliedOn)}.`,
      returnFocus: () => (openRef.current ?? appliedRef.current)?.focus(),
      undo: () => {
        undoApplicationEvent(result.event.id)
          .then(() => { focusNext.current = "applied"; return onTracked(); })
          .then(() => toaster.announce("Removed from Applications again."))
          .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
      },
    });
  };
  const chip = status?.package ?? null;
  // No master profile: the button still opens the package, which shows setup and the quick start.
  const opensEmpty = status?.canStart === false && status.problem === "no-profile";
  const why = status && !status.canStart && !opensEmpty ? status.reason : null;
  const inOriginal = job.packageLanguage !== "en";
  // With an open Application, Open application leads and Prepare package stays secondary (for reapplying later).
  const prepareCls = open ? "btn" : "btn primary";
  return (
    <>
      <div className="panel decide o2" role="group" aria-label="Decide">
        {open && (
          <a className="btn primary" href={applicationHref(open.id)} ref={openRef}>
            Open application<span className="sr-only">: {statusLabel[open.status]}, applied {shortDay(open.appliedOn)}</span>
          </a>
        )}
        {chip ? (
          <a className={prepareCls} href={packagePage}>{chip.label}{chip.kind === "preparing" && "…"}</a>
        ) : opensEmpty ? (
          <a className={prepareCls} href={packagePage}>Prepare package</a>
        ) : (
          <button className={prepareCls} type="button" disabled={!status?.canStart || busy} aria-describedby={why ? "prep-why" : undefined} onClick={() => void prepare()}>
            {busy ? "Starting…" : <>Prepare package{inOriginal && ` in ${language === "bg" ? "Bulgarian" : "English"}`}</>}
          </button>
        )}
        {why && <p className="why-off" id="prep-why">{why}</p>}
        {!status && !error && <p className="meta" role="status">Checking whether a package can start…</p>}
        {error && <p className="why-off" role="alert">Couldn't reach the service: {error}</p>}
        {job.closed && <button className="btn ghost" type="button" onClick={onReopen}>It's still open: reopen</button>}
        <a className="btn" href={job.url} target="_blank" rel="noopener noreferrer">Open the posting<span className="sr-only"> (new tab)</span><span aria-hidden="true"> ↗</span></a>
        {!open && (
          <>
            <button className="btn ghost sm" type="button" ref={appliedRef} style={{ justifySelf: "start" }} onClick={() => setAdding(true)}>I applied without apply-kit…</button>
            <p className="meta">For a job you applied to on the company's site directly. Opens Add application with this Job chosen.</p>
          </>
        )}
        {inOriginal && !chip && (
          <div className="lang">
            <span aria-live="polite">
              {language === "bg"
                ? <>The posting is in Bulgarian, so your CV, cover letter and screening answers will be in <b>Bulgarian</b>.</>
                : <>Your package will be in <b>English</b>.</>}
            </span>
            <button className="btn sm" type="button" onClick={() => setLanguage(language === "bg" ? "en" : "bg")}>
              {language === "bg" ? "Switch to English" : "Switch back to Bulgarian"}
            </button>
          </div>
        )}
      </div>
      {adding && (
        <AddApplicationDialog
          chosen={{ id: job.id, title: titleOf(job), company: job.company }}
          onAdded={applied}
          onCancel={() => { setAdding(false); appliedRef.current?.focus(); }}
        />
      )}
    </>
  );
}

/**
 * The Job page leads with what Track knows: "You applied to this job on …" with Open application,
 * else a recent Application at the same company ("You applied to Kestrel Payments 4 months ago").
 */
function TrackBanner({ job, track }: { job: JobDetail; track: JobMarker | null }) {
  const mine = track?.application;
  if (mine) {
    return (
      <div className="banner info">
        <span className="text">
          <b>You applied to this job on {weekdayDay(mine.appliedOn)}.</b> Status: {statusLabel[mine.status]}
          {mine.closedOn && `, since ${shortDay(mine.closedOn)}`}.
          {isClosed(mine.status) && " Applying again is allowed."}
        </span>
        <a className="btn sm" href={applicationHref(mine.id)}>Open application</a>
      </div>
    );
  }
  const before = track?.sameCompany;
  if (!before) return null;
  const outcome = before.status === "rejected"
    ? `, rejected${before.closedOn ? ` ${shortDay(before.closedOn)}` : ""}`
    : before.status === "withdrawn" ? `, withdrawn${before.closedOn ? ` ${shortDay(before.closedOn)}` : ""}` : `, ${statusLabel[before.status]} now`;
  return (
    <div className={`banner ${before.status === "rejected" ? "warning" : "info"}`}>
      <span className="text">
        <b>You applied to {job.company} {agoWords(before.appliedOn)}.</b> {before.title}, applied {shortDay(before.appliedOn)}{outcome}.
        {" "}{before.title === job.title || before.title === titleOf(job) ? "Applying again is allowed." : "This is a different role, so applying again is normal."}
      </span>
      <a className="btn sm" href={applicationHref(before.id)}>Open that application<span className="sr-only">: {before.title}</span></a>
    </div>
  );
}

/** "History with <company>": every Application at this company, this Job's marked, newest first. */
function History({ job, track }: { job: JobDetail; track: JobMarker | null }) {
  const history = track?.history ?? [];
  const id = useId();
  return (
    <section className="panel o4" aria-labelledby={id}>
      <h2 id={id}>History with {job.company}</h2>
      {history.length === 0 ? (
        <p className="meta">No applications at {job.company} yet.</p>
      ) : (
        <ul className="hist">
          {history.map((m) => (
            <li key={m.id}>
              <span>
                <b><a href={applicationHref(m.id)}>{m.title}</a></b><br />
                <span className="meta">Applied {shortDay(m.appliedOn)}{m.onThisJob && " · this job"}</span>
              </span>
              <span className={`status ${m.status}`}><i aria-hidden="true" />{statusLabel[m.status]}</span>
            </li>
          ))}
          {!track?.application && (
            <li>
              <span><b>{titleOf(job)}</b><br /><span className="meta">This job</span></span>
              <span className="chip neutral">Not applied</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

const angleNames = { developer: "developer", security: "security", design: "design" } as const;

/**
 * "Boost new {company} {angle} jobs in the Feed": off unless Kris turns it on. Turning it on is a
 * learned adjustment like any other (listed and undoable under Dealbreakers and search); turning it
 * off here undoes it.
 */
function Boost({ job, onChanged }: { job: JobDetail; onChanged: (j: JobDetail, said: string) => void }) {
  const [boostId, setBoostId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = `new ${job.company}${job.fit.angle ? ` ${angleNames[job.fit.angle]}` : ""} jobs`;

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      let said: string;
      if (on) {
        const a = await boostJob(job.id);
        setBoostId(a.id);
        said = `Boost on: ${a.applies} rank higher. Listed under Dealbreakers and search.`;
      } else {
        await undoAdjustment(boostId!);
        setBoostId(null);
        said = "Boost off.";
      }
      setError(null);
      onChanged(await fetchJob(job.id), said);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel o2 field">
      <label className="check">
        <input type="checkbox" checked={boostId != null} disabled={busy} onChange={(e) => void toggle(e.target.checked)} aria-describedby="boost-help" />
        Boost {what} in the Feed
      </label>
      <span className="help" id="boost-help">
        Off unless you turn it on. A boost is listed under <a href="/profile/search#ranking">Dealbreakers and search</a>, where you can undo it, and why-lines say when it moved a job.
      </span>
      {error && <span className="err" role="alert">Couldn't change the boost: {error}</span>}
    </div>
  );
}

/**
 * After "Paste a job link" opened this page: says whether the link was already in the Feed or joined
 * a Job found elsewhere, so a pasted link never silently lands on an older Job.
 */
function PastedLinkNote() {
  const [outcome] = useState(() => new URLSearchParams(window.location.search).get("link"));
  useEffect(() => {
    if (!outcome) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("link");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [outcome]);
  const text = outcome === "existing" ? "This job was already in your Feed, so it opened here instead of being added twice."
    : outcome === "merged" ? "This job was already in your Feed from another site. The link you pasted is now one of its postings."
    : outcome === "added" ? "Added to your Feed from the link you pasted."
    : null;
  if (!text) return null;
  return (
    <div className="banner info" role="status">
      <span className="text">{text}</span>
    </div>
  );
}
