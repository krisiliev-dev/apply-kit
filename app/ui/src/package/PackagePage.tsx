// The Package (hi-fi: docs/design/hifi/package.html, ticket #62): generating with per-part progress,
// time estimate and cost, Stop generating and Retry; the stepper (done, current, flagged, working,
// failed, upcoming) with steps approved in order and reading ahead free; step 1, the target posting
// and language; step 2, the CV as the exact PDF with Fit / 100%, the photo switch, the file name and
// the draft download; the empty state without a master profile. The sticky action bar holds the
// step's Approve, which explains itself when it can't approve and moves focus to the reason.
import type { BudgetInfo, HealthSummary, PackagePart, PackageStep, PackageStepView, PackageView, PrepareStatus } from "@apply-kit/core";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  approveStep, fetchPackage, fetchPrepareStatus, fetchSources, packageCvUrl, retryPart, setPackageLanguage, setPackagePhoto,
  setTargetPosting, startPackage, stopGenerating,
} from "../api.ts";
import { useToaster } from "../feed/toast.tsx";
import { Icon } from "../icons.tsx";
import { PdfPreview } from "./PdfPreview.tsx";

const steps: PackageStep[] = ["target", "cv", "letter", "answers", "ats"];
/** What Kris is looking at: the generating progress, or one step. */
type Viewing = "progress" | PackageStep;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "status"; status: PrepareStatus }
  | { state: "ready"; pkg: PackageView };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 3 : 2)}`;
const fromHash = (): PackageStep | null => {
  const h = window.location.hash.slice(1);
  return steps.includes(h as PackageStep) ? (h as PackageStep) : null;
};

export function PackagePage({ jobId, onHealth }: { jobId: string; onHealth: (h: HealthSummary) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const toaster = useToaster();
  const jobPage = `/jobs/${encodeURIComponent(jobId)}`;

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);

  // The Job's package, or why there isn't one.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const status = await fetchPrepareStatus(jobId, ctrl.signal);
      if (!status.package) return setLoad({ state: "status", status });
      const pkg = await fetchPackage(status.package.packageId, ctrl.signal);
      // The first view: the progress while parts are written, else the step in the address, else the current step.
      setViewing(pkg.generating ? "progress" : fromHash() ?? pkg.steps.find((s) => !s.approvedAt)?.step ?? "ats");
      setLoad({ state: "ready", pkg });
    })().catch((err: unknown) => { if (!ctrl.signal.aborted) setLoad({ state: "error", message: message(err) }); });
    return () => ctrl.abort();
  }, [jobId]);

  const pkg = load.state === "ready" ? load.pkg : null;
  useEffect(() => {
    document.title = `${pkg ? `Package · ${pkg.title}` : "Package"} · apply-kit`;
  }, [pkg]);

  // While parts are written, follow them; each part that finishes is announced once (PA-09).
  const announced = useRef(new Map<string, string>());
  useEffect(() => {
    if (!pkg) return;
    for (const p of pkg.parts) {
      const before = announced.current.get(p.part);
      if (before && before !== p.state && p.state !== "working") toaster.announce(partSaid(p));
      announced.current.set(p.part, p.state);
    }
    if (!pkg.generating) return;
    const timer = window.setTimeout(() => {
      fetchPackage(pkg.id).then((p) => setLoad({ state: "ready", pkg: p })).catch(() => {});
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [pkg, toaster]);

  const go = useCallback((to: Viewing, focus = true) => {
    setViewing(to);
    window.history.replaceState(null, "", to === "progress" ? window.location.pathname : `#${to}`);
    window.scrollTo(0, 0);
    if (focus) window.setTimeout(() => document.querySelector<HTMLElement>("#main h1")?.focus({ preventScroll: true }), 0);
  }, []);

  if (load.state === "loading") return <p className="meta" role="status">Loading the package…</p>;
  if (load.state === "error") {
    return (
      <div className="banner error" role="alert">
        <span className="text"><b>Couldn't load the package.</b> {load.message}. Check that the apply-kit service is running, then reload.</span>
      </div>
    );
  }
  if (load.state === "status") return <NoPackage jobId={jobId} status={load.status} onStarted={(p) => { setViewing("progress"); setLoad({ state: "ready", pkg: p }); }} />;

  const p = load.pkg;
  const update = (next: PackageView) => setLoad({ state: "ready", pkg: next });
  const shown: Viewing = viewing ?? "progress";
  return (
    <section className="stack package-page" style={{ gap: "var(--s-6)" }}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/">Feed</a><span aria-hidden="true">/</span><a href={jobPage}>{p.title}</a><span aria-hidden="true">/</span><span aria-current="page">Package</span>
      </nav>
      {shown === "progress"
        ? <Generating pkg={p} budget={p.budget} onChange={update} onGo={go} say={toaster.announce} />
        : <Steps pkg={p} viewing={shown} jobPage={jobPage} onChange={update} onGo={go} say={toaster.announce} />}
      {toaster.element}
    </section>
  );
}

/** What is announced when a part finishes, fails or stops. */
function partSaid(p: PackagePart): string {
  switch (p.state) {
    case "done": return `${p.label} ready.`;
    case "failed": return `${p.label} failed: ${p.error ?? "the model didn't answer"}. Everything else is saved.`;
    case "stopped": return `${p.label} stopped. Finished parts are kept.`;
    case "not-written": return `${p.label} not written: this month's AI budget would be crossed.`;
    default: return `${p.label}: ${p.what}`;
  }
}

function Head({ pkg, title, extra }: { pkg: PackageView; title: string; extra?: ReactNode }) {
  return (
    <div className="pk-head">
      <h1 tabIndex={-1}>{title}</h1>
      <div className="sub">
        <span><b>{pkg.title}</b> at {pkg.company}</span>
        <span>{pkg.language === "bg" ? "Bulgarian" : "English"} · {pkg.angle.label} angle</span>
        {extra}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Generating

function PartIcon({ part }: { part: PackagePart }) {
  if (part.state === "working") return <span className="ic"><span className="spin" aria-hidden="true" /></span>;
  if (part.state === "done") return <span className="ic"><Icon name="met" /></span>;
  if (part.state === "failed") return <span className="ic"><Icon name="gap" /></span>;
  if (part.state === "stopped" || part.state === "not-written") return <span className="ic"><Icon name="partly" /></span>;
  return <span className="ic" />;
}

const partChip: Record<PackagePart["state"], [string, string]> = {
  done: ["met", "Ready"],
  working: ["neutral", "Writing…"],
  waiting: ["neutral", "Waits"],
  failed: ["gap", "Failed"],
  stopped: ["partly", "Stopped"],
  "not-written": ["partly", "Not written"],
  later: ["neutral", "Not built yet"],
};

function Parts({ pkg }: { pkg: PackageView }) {
  return (
    <ul className="parts" aria-label="Parts of the package">
      {pkg.parts.map((part) => {
        const [cls, label] = part.part === "ats" && part.state === "waiting" ? ["neutral", "Waits for CV"] : partChip[part.state];
        const li = part.state === "not-written" ? "stopped" : part.state === "later" ? "waiting" : part.state;
        return (
          <li key={part.part} className={li}>
            <PartIcon part={part} />
            <span><b>{part.label}</b><span className="what">{part.what}</span></span>
            <span className={`chip ${cls}`}>{cls === "met" && <Icon name="met" />}{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Generating({ pkg, budget, onChange, onGo, say }: {
  pkg: PackageView; budget: BudgetInfo; onChange: (p: PackageView) => void; onGo: (v: Viewing) => void; say: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const failed = pkg.parts.find((p) => p.state === "failed");
  const capped = pkg.parts.find((p) => p.state === "not-written");
  const stopped = pkg.parts.filter((p) => p.state === "stopped");
  const left = pkg.estimate.seconds;

  async function stop() {
    setBusy(true);
    try {
      const next = await stopGenerating(pkg.id);
      onChange(next);
      say(`Stopped. The ${next.partsReady} finished ${next.partsReady === 1 ? "part is" : "parts are"} kept; the rest can be written later.`);
    } catch (err) {
      say(`Couldn't stop: ${message(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function retry(part: PackageStep) {
    const r = await retryPart(pkg.id, part).catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
    onChange(r.package);
    say(r.changed ? "Writing it again…" : r.reason);
  }

  return (
    <>
      <Head pkg={pkg} title={pkg.generating ? "Preparing your package" : "Package parts"} extra={<span className="num">Started {hhmm(pkg.startedAt)}</span>} />
      {failed && (
        <div className="banner error" role="alert">
          <span className="text"><b>The {failed.label.toLowerCase()} wasn't written.</b> {failed.error ?? "The model didn't answer"}{failed.attempts > 1 ? `, ${failed.attempts} times` : ""}. Everything else is finished and saved; nothing was lost.</span>
          <button className="btn sm" type="button" onClick={() => void retry(failed.part)}>Try again</button>
        </div>
      )}
      {capped && (
        <div className="banner warning" role="status">
          <span className="text"><b>This month's AI budget would be crossed: {usd(budget.spentUsd)} of {usd(budget.capUsd)} spent.</b> The {capped.label.toLowerCase()} wasn't started. Everything finished so far is saved. The app never raises the cap by itself: raise it in Settings, or wait for next month.</span>
        </div>
      )}
      <div className="cols">
        <div className="col">
          <div className="panel">
            <div className="sec-head" aria-live="polite">
              <h2>{pkg.partsReady} of {pkg.parts.length} parts ready</h2>
              {pkg.generating && left > 0 && <span className="meta num">about {left} s left</span>}
            </div>
            <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={pkg.parts.length} aria-valuenow={pkg.partsReady} aria-valuetext={`${pkg.partsReady} of ${pkg.parts.length} parts ready`} aria-label="Package progress">
              <span style={{ width: `${(pkg.partsReady / pkg.parts.length) * 100}%` }} />
            </div>
            <Parts pkg={pkg} />
            <div className="row">
              <button className="btn primary" type="button" onClick={() => onGo("target")}>Start reviewing</button>
              <span className="meta">Begins at step 1; the CV comes next.</span>
            </div>
            {pkg.generating && (
              <>
                <p className="meta">You don't have to wait here. Go back to the Feed if you like: the job shows "Package ready" when it's done.</p>
                <div className="row">
                  <button className="btn" type="button" disabled={busy} onClick={() => void stop()}>Stop generating</button>
                  <span className="meta">Keeps the parts already finished.</span>
                </div>
              </>
            )}
            {!pkg.generating && stopped.map((part) => (
              <div className="row" key={part.part}>
                <button className="btn" type="button" onClick={() => void retry(part.part)}>Write the {part.label.toLowerCase()}</button>
                <span className="meta">About {usd(Math.max(pkg.estimate.costUsd, 0.01))}.</span>
              </div>
            ))}
          </div>
        </div>
        <aside className="col side" aria-label="This package">
          <div className="panel">
            <h2>Nothing is sent anywhere</h2>
            <p className="muted mini">Every part is a draft until you approve it. The application exists only after you press Submit in the portal.</p>
            <dl className="kv">
              <dt>Cost</dt><dd className="num">{usd(pkg.costUsd)} so far{pkg.estimate.costUsd > 0 && `, about ${usd(pkg.estimate.costUsd)} to go`}</dd>
              <dt>This month</dt><dd className="num">{usd(budget.spentUsd)} of {usd(budget.capUsd)}</dd>
            </dl>
          </div>
        </aside>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Steps

function StepIcon({ step }: { step: PackageStepView }) {
  if (step.state === "done") return <span className="ic"><Icon name="met" /></span>;
  if (step.state === "failed") return <span className="ic"><Icon name="gap" /></span>;
  if (step.state === "working") return <span className="ic"><span className="spin sm" aria-hidden="true" /></span>;
  return <span className="ic">{step.number}</span>;
}

function Stepper({ pkg, viewing, onGo }: { pkg: PackageView; viewing: PackageStep; onGo: (v: Viewing) => void }) {
  return (
    <nav aria-label="Package steps">
      <ol className="pk-steps">
        {pkg.steps.map((s) => (
          <li key={s.step} className={s.state}>
            <a href={`#${s.step}`} aria-current={s.step === viewing ? "step" : undefined} onClick={(e) => { e.preventDefault(); onGo(s.step); }}>
              <StepIcon step={s} />
              <span className="lbl">{s.label}</span>
              <span className="sub">{s.sub}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Steps({ pkg, viewing, jobPage, onChange, onGo, say }: {
  pkg: PackageView; viewing: PackageStep; jobPage: string; onChange: (p: PackageView) => void; onGo: (v: Viewing) => void; say: (m: string) => void;
}) {
  const step = pkg.steps.find((s) => s.step === viewing)!;
  const minutes = useMinutesSince(pkg.startedAt);
  const goal = 10;

  const content = viewing === "target" ? <TargetStep pkg={pkg} onChange={onChange} say={say} />
    : viewing === "cv" ? <CvStep pkg={pkg} onChange={onChange} onGo={onGo} say={say} />
    : <LaterStep pkg={pkg} step={step} onGo={onGo} />;

  return (
    <>
      <Head pkg={pkg} title={`Package for ${pkg.title}`} extra={<span className="num">Started {hhmm(pkg.startedAt)} · {minutes} min so far</span>} />
      <Stepper pkg={pkg} viewing={viewing} onGo={onGo} />
      {pkg.generating && (
        <div className="banner info" role="status">
          <span className="text">Some parts are still being written. <button className="link-btn" type="button" onClick={() => onGo("progress")}>See the progress</button></span>
        </div>
      )}
      <p className="meta">Steps are approved in order. You can read ahead; a step's Approve waits for the steps before it, so a later part never contradicts an earlier decision.</p>
      <div className="cols">
        <div className="col">
          {content}
          <ActionBar key={step.step} pkg={pkg} step={step} jobPage={jobPage} onChange={onChange} onGo={onGo} say={say} />
        </div>
        <aside className="col side" aria-label={viewing === "cv" ? "File and template" : "This package"}>
          {viewing === "cv" ? <CvSide pkg={pkg} onChange={onChange} say={say} /> : (
            <div className="panel">
              <h2>This package</h2>
              <dl className="kv">
                <dt>Angle</dt><dd>{pkg.angle.label} <span className="meta">closest of 3</span></dd>
                <dt>Why</dt><dd className="meta">{pkg.angle.reason}</dd>
                <dt>Template</dt><dd>{pkg.photo ? "Standard with photo" : "Standard, no photo"}</dd>
                <dt>Cost</dt><dd className="num">{usd(pkg.costUsd)} so far</dd>
              </dl>
              <div className="goal">
                <span className="meta">Time since the package started</span>
                <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(minutes, goal)} aria-valuetext={`${minutes} ${minutes === 1 ? "minute" : "minutes"} of a ${goal}-minute goal`} aria-label="Time against the 10-minute goal">
                  <span style={{ width: `${Math.min(100, (minutes / goal) * 100)}%` }} />
                </div>
                <span className="meta num">{minutes} of {goal} min</span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/** Whole minutes since a time, kept current (shown neutrally against the 10-minute goal). */
function useMinutesSince(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}

/** The step's one decision, in a sticky bar. An Approve that can't approve names why and moves focus there (PA-02, PA-10). */
function ActionBar({ pkg, step, jobPage, onChange, onGo, say }: {
  pkg: PackageView; step: PackageStepView; jobPage: string; onChange: (p: PackageView) => void; onGo: (v: Viewing) => void; say: (m: string) => void;
}) {
  const [refused, setRefused] = useState<string | null>(null);
  const why = useRef<HTMLParagraphElement>(null);
  const index = steps.indexOf(step.step);
  const next = steps[index + 1];
  const reason = refused ?? step.blocked;

  async function approve() {
    if (step.approvedAt) {
      if (next) onGo(next);
      return;
    }
    if (step.blocked) {
      why.current?.focus();
      say(`Can't approve yet: ${step.blocked}`);
      return;
    }
    try {
      const r = await approveStep(pkg.id, step.step);
      onChange(r.package);
      if (!r.approved) {
        setRefused(r.reason);
        window.setTimeout(() => why.current?.focus(), 0);
        say(`Can't approve yet: ${r.reason}`);
        return;
      }
      say(`${step.label} approved.${next ? ` Step ${index + 2}, ${r.package.steps[index + 1]!.label}.` : ""}`);
      if (next) onGo(next);
    } catch (err) {
      setRefused(`Couldn't approve: ${message(err)}`);
    }
  }

  const blockedBy = step.blocked ? steps.find((s) => pkg.steps.find((v) => v.step === s && !v.approvedAt) && steps.indexOf(s) < index) : undefined;
  const back = index === 0 ? null : steps[index - 1]!;
  return (
    <div className="actionbar">
      {back
        ? <button className="btn ghost" type="button" onClick={() => onGo(back)}>Back to step {index}</button>
        : <a className="btn ghost" href={jobPage}>Back to the job</a>}
      <span className="grow" />
      {reason && !step.approvedAt && (
        <p className="why-off" id={`why-${step.step}`} ref={why} tabIndex={-1}>
          {reason}{" "}
          {blockedBy && <button className="link-btn" type="button" onClick={() => onGo(blockedBy)}>Go to step {steps.indexOf(blockedBy) + 1}</button>}
        </p>
      )}
      {step.approvedAt
        ? <><span className="chip met"><Icon name="met" />Approved {hhmm(step.approvedAt)}</span>{next && <button className="btn primary" type="button" onClick={() => onGo(next)}>Next step</button>}</>
        : (
          <button className="btn primary" type="button" aria-disabled={step.blocked ? "true" : undefined} aria-describedby={reason ? `why-${step.step}` : undefined} onClick={() => void approve()}>
            Approve and continue
          </button>
        )}
    </div>
  );
}

function TargetStep({ pkg, onChange, say }: { pkg: PackageView; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const reopened = (before: PackageView, after: PackageView) => before.steps.some((s) => s.approvedAt) && !after.steps[0]!.approvedAt;

  async function choose(postingId: string) {
    const r = await setTargetPosting(pkg.id, postingId).catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
    onChange(r.package);
    setError(r.changed ? null : r.reason);
    const site = r.package.targetOptions.find((o) => o.postingId === postingId)?.site ?? "it";
    if (r.changed) say(`Applying through ${site}.${reopened(pkg, r.package) ? " Approved steps are open again for a look." : ""}`);
  }

  async function language(lang: "en" | "bg") {
    say(lang === "bg" ? "Switching to Bulgarian…" : "Switching to English…");
    const r = await setPackageLanguage(pkg.id, lang).catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
    onChange(r.package);
    setError(r.changed ? null : r.reason);
    if (r.changed) say(`The package is now in ${lang === "bg" ? "Bulgarian" : "English"}. The CV was printed again.`);
  }

  const fromPosting = (lang: "en" | "bg") => pkg.postingLanguage === lang;
  return (
    <>
      <div className="panel">
        <div className="step-title"><h2>Which posting will you apply through?</h2><p className="muted">The screening questions and the portal the extension fills come from this posting.</p></div>
        <fieldset className="choices">
          <legend className="sr-only">Target posting</legend>
          {pkg.targetOptions.map((o) => (
            <label className="choice" key={o.postingId}>
              <input type="radio" name="target" checked={pkg.targetPostingId === o.postingId} onChange={() => void choose(o.postingId)} />
              <b>{o.site} {o.recommended && <span className="chip met"><Icon name="met" />Recommended</span>}</b>
              <span className="muted">{o.consequence}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="panel">
        <div className="sec-head"><h2>Language</h2><span className="chip neutral">From the posting: {pkg.postingLanguage === "bg" ? "Bulgarian" : "English"}</span></div>
        <fieldset className="choices">
          <legend className="sr-only">Package language</legend>
          <label className="choice">
            <input type="radio" name="lang" checked={pkg.language === "en"} onChange={() => void language("en")} />
            <b>English</b>
            <span className="muted">{fromPosting("en") ? "The posting is in English. " : ""}The CV, cover letter and screening answers are all written in English.</span>
          </label>
          <label className="choice" lang="en">
            <input type="radio" name="lang" checked={pkg.language === "bg"} onChange={() => void language("bg")} />
            <b>Bulgarian</b>
            <span className="muted">{fromPosting("bg") ? "The posting is in Bulgarian. " : ""}The whole package in Bulgarian, not only the headings. For now switching prints the CV again with the Bulgarian section titles and your name as stored in Cyrillic; nothing is lost.</span>
          </label>
        </fieldset>
      </div>
      {error && <p className="why-off" role="alert">{error}</p>}
    </>
  );
}

function CvStep({ pkg, onChange, onGo, say }: { pkg: PackageView; onChange: (p: PackageView) => void; onGo: (v: Viewing) => void; say: (m: string) => void }) {
  const part = pkg.parts.find((p) => p.part === "cv")!;
  const retry = async () => {
    const r = await retryPart(pkg.id, "cv").catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
    onChange(r.package);
    say(r.changed ? "Writing the CV again…" : r.reason);
  };
  return (
    <div className="panel">
      <div className="step-title"><h2>CV version</h2><p className="muted">The exact PDF the extension uploads. For now it's your {pkg.angle.label.toLowerCase()} angle's pieces as they are in your profile; tailoring for this job comes with a later part of the rebuild.</p></div>
      {pkg.cv ? (
        <PdfPreview key={pkg.cv.sha256} url={packageCvUrl(pkg.id, pkg.cv.sha256)} name="CV" pages={pkg.cv.pages} overflow={pkg.cv.overflow !== null} />
      ) : part.state === "working" || part.state === "waiting" ? (
        <div className="stack" role="status"><p className="meta">Writing the CV…</p><span className="skel w70" /><span className="skel w90" /><span className="skel w50" /></div>
      ) : (
        <div className={`banner ${part.state === "failed" ? "error" : "warning"}`} role="alert">
          <span className="text"><b>The CV wasn't written.</b> {part.what} The target posting and everything else are saved.</span>
          {part.state === "not-written"
            ? <button className="btn sm" type="button" onClick={() => onGo("progress")}>See the budget</button>
            : <button className="btn sm" type="button" onClick={() => void retry()}>Try again</button>}
        </div>
      )}
    </div>
  );
}

const atsLabel: Record<string, string> = {
  "text-based": "Real text, fonts embedded", "single-column": "Single column", contact: "Contact details found", sections: "Sections found",
  dates: "Dates readable", pages: "Fits on one page", keywords: "Posting keywords found", bullets: "Bullets short enough",
  summary: "Summary short enough", "file-name": "File name",
};

function CvSide({ pkg, onChange, say }: { pkg: PackageView; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  async function photo(on: boolean) {
    const r = await setPackagePhoto(pkg.id, on).catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
    onChange(r.package);
    setError(r.changed ? null : r.reason);
    if (r.changed) say(on ? "Photo on. The CV was printed again." : "Photo off. The CV was printed again.");
  }
  const cv = pkg.cv;
  const failing = cv?.ats?.checks.filter((c) => !c.passed) ?? [];
  return (
    <>
      <div className="panel">
        <h2>This file</h2>
        {cv ? (
          <>
            <p className="mini file-name">{cv.fileName}</p>
            <ul className="checks">
              <li>{cv.overflow ? <span className="chip partly"><Icon name="partly" />{cv.pages}</span> : <span className="chip met"><Icon name="met" />OK</span>}<span>{cv.overflow ? `Runs onto ${cv.pages} pages` : "Fits on 1 page"}</span></li>
              {cv.ats && (failing.length === 0
                ? <li><span className="chip met"><Icon name="met" />OK</span><span>Parse check: all {cv.ats.checks.length} checks pass</span></li>
                : failing.map((c) => <li key={c.check}><span className="chip gap"><Icon name="gap" />Fails</span><span>{atsLabel[c.check] ?? c.check}: {c.problems.join(" ")}</span></li>))}
            </ul>
            <a className="btn sm" href={packageCvUrl(pkg.id, cv.sha256, true)} download>Download draft PDF</a>
            <p className="meta">Downloads say "draft" until the package is approved.</p>
          </>
        ) : <p className="meta">The file appears here once the CV is printed.</p>}
      </div>
      <div className="panel">
        <h2>Template</h2>
        <fieldset className="choices">
          <legend className="sr-only">Photo</legend>
          <label className="choice">
            <input type="radio" name="photo" checked={!pkg.photo} onChange={() => void photo(false)} />
            <b>Standard, no photo</b>
          </label>
          <label className="choice">
            <input type="radio" name="photo" checked={pkg.photo} aria-describedby="photo-help" onChange={() => void photo(true)} />
            <b>Standard with photo</b>
            <span className="meta" id="photo-help">
              Suggested for local Bulgarian employers that expect one. Same layout, photo top right.
              {!pkg.photoAvailable && <> Add a photo in <a href="/profile">Profile › Contact details</a> first.</>}
            </span>
          </label>
        </fieldset>
        {error && <p className="why-off" role="alert">{error}</p>}
        <p className="meta">Fixed layout from the design system. Only the words are written for this job.</p>
      </div>
    </>
  );
}

function LaterStep({ pkg, step, onGo }: { pkg: PackageView; step: PackageStepView; onGo: (v: Viewing) => void }) {
  const cvApproved = pkg.steps[1]!.approvedAt !== null;
  return (
    <div className="panel">
      <div className="step-title">
        <h2>{step.label}</h2>
        <p className="muted">
          {step.step === "ats"
            ? cvApproved ? "The ATS check reads the approved CV PDF the way a parser does, on this laptop. It arrives with a later part of the rebuild." : "Reads the CV PDF once you approve the CV. Runs on this laptop, no model needed."
            : `The ${step.label.toLowerCase()} arrives with a later part of the rebuild.`}
        </p>
      </div>
      <div className="row"><button className="btn" type="button" onClick={() => onGo("cv")}>Back to the CV</button></div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// No package yet

function NoPackage({ jobId, status, onStarted }: { jobId: string; status: PrepareStatus; onStarted: (p: PackageView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobPage = `/jobs/${encodeURIComponent(jobId)}`;
  const crumbs = (
    <nav className="crumbs" aria-label="Breadcrumb">
      <a href="/">Feed</a><span aria-hidden="true">/</span><a href={jobPage}>Job</a><span aria-hidden="true">/</span><span aria-current="page">Package</span>
    </nav>
  );
  if (!status.canStart && status.problem === "no-profile") {
    return (
      <section className="stack package-page" style={{ gap: "var(--s-6)" }}>
        {crumbs}
        <div className="empty">
          <h1 style={{ fontSize: "var(--fs-h3)" }}>A package needs your master profile first</h1>
          <p>Every CV, cover letter and screening answer is built from it, and nothing is ever written that it doesn't back. Setup imports your old CVs, lets a coach question them, and takes about 30–45 minutes; you can stop any time.</p>
          <div className="row">
            <a className="btn primary" href="/profile">Set up your profile</a>
            <a className="btn" href="/profile">Import one CV and start this package</a>
          </div>
          <p className="meta">The quick start works, but this first package will be thinner and ask you more questions.</p>
        </div>
      </section>
    );
  }
  async function start() {
    setBusy(true);
    try {
      const r = await startPackage(jobId);
      if (r.started) onStarted(r.package);
      else setError(r.reason);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stack package-page" style={{ gap: "var(--s-6)" }}>
      {crumbs}
      <div className="empty">
        <h1 style={{ fontSize: "var(--fs-h3)" }}>No package for this job yet</h1>
        {status.canStart
          ? <p>Start one here or from the job: it begins with the closest of your three angles and the company's own page.</p>
          : <p>{status.reason}</p>}
        <div className="row">
          {status.canStart && <button className="btn primary" type="button" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Prepare package"}</button>}
          <a className="btn" href={jobPage}>Back to the job</a>
        </div>
        {error && <p className="why-off" role="alert">{error}</p>}
      </div>
    </section>
  );
}
