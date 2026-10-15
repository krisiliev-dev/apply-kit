// The Package (hi-fi: docs/design/hifi/package.html, ticket #62): generating with per-part progress,
// time estimate and cost, Stop generating and Retry; the stepper (done, current, flagged, working,
// failed, upcoming) with steps approved in order and reading ahead free; step 1, the target posting
// and language; step 2, the CV as the exact PDF with Fit / 100%, the photo switch, the file name and
// the draft download; the empty state without a master profile. The sticky action bar holds the
// step's Approve, which explains itself when it can't approve and moves focus to the reason.
// Ticket #63: the CV step's Changes view (requirements → evidence, every change with Undo, every
// line and its pieces; beside it the honesty check and tailoring notes) and Preview (the exact PDF
// with the parse check), and a CV that runs onto page 2 with the ways to tighten it.
// Ticket #64: flags (near the line, gaps, lines from Kris's answers) listed with jump links at the
// top of the step and sitting inside their requirement, none pre-selected; resolved ones stay with
// the choice; Approve with an open flag moves focus to an alert naming it, linking to the flag.
// Ticket #65: step 3, the cover letter (LetterStep.tsx), and "Write the letter myself" where it failed or the cap stopped it.
// Ticket #66: step 4, screening answers (AnswersStep.tsx); Approve with an answer that needs Kris
// moves focus to that question.
import type {
  BudgetInfo, CvFlagView, CvLineView, CvVersionView, EvidenceRow, HealthSummary, HonestyCheckView, PackagePart, PackageStep, PackageStepView, PackageView, PieceLink, PrepareStatus,
} from "@apply-kit/core";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  answerGap, approveStep, decideFlag, fetchPackage, fetchPrepareStatus, fetchSources, fitCv, packageCvUrl, redoCvChange, retryPart, setPackageLanguage, setPackagePhoto,
  setTargetPosting, startPackage, stopGenerating, undoCvChange,
} from "../api.ts";
import { useToaster } from "../feed/toast.tsx";
import { Icon } from "../icons.tsx";
import { LetterSide, LetterStep, writeOwnLetter, type LetterViewMode } from "./LetterStep.tsx";
import { AnswersStep, questionElementId } from "./AnswersStep.tsx";
// pdf.js is large: it loads only when a document is shown.
const PdfPreview = lazy(() => import("./PdfPreview.tsx").then((m) => ({ default: m.PdfPreview })));

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

  // Back, forward and links to a step (#target, #cv) move between steps.
  useEffect(() => {
    const onHash = () => { const s = fromHash(); if (s) setViewing(s); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  async function writeOwn() {
    if (await writeOwnLetter(pkg, onChange, say)) onGo("letter");
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
          {failed.part === "letter" && <button className="btn sm" type="button" onClick={() => void writeOwn()}>Write the letter myself</button>}
        </div>
      )}
      {capped && (
        <div className="banner warning" role="status">
          <span className="text"><b>This month's AI budget would be crossed: {usd(budget.spentUsd)} of {usd(budget.capUsd)} spent.</b> The {capped.label.toLowerCase()} wasn't started. Everything finished so far is saved. The app never raises the cap by itself: raise it in Settings, or wait for next month.</span>
          {capped.part === "letter" && <button className="btn sm" type="button" onClick={() => void writeOwn()}>Write the letter myself</button>}
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
  // The CV step shows its changes, or the exact PDF; a CV on two pages opens on the PDF.
  const [cvView, setCvView] = useState<CvView>(() => (pkg.cvVersion?.fit.choices.length ? "preview" : "changes"));
  // Approve pressed while a flag is open: an alert names it, and focus moves there (PA-02).
  const [flagAlert, setFlagAlert] = useState(false);
  const onFlagBlock = () => {
    setCvView("changes");
    setFlagAlert(true);
    window.setTimeout(() => document.getElementById("flag-alert")?.focus(), 0);
  };

  const [letterView, setLetterView] = useState<LetterViewMode>("edit");
  const content = viewing === "target" ? <TargetStep pkg={pkg} onChange={onChange} say={say} />
    : viewing === "cv" ? <CvStep pkg={pkg} view={cvView} onView={setCvView} flagAlert={flagAlert} onChange={onChange} onGo={onGo} say={say} />
    : viewing === "letter" ? <LetterStep pkg={pkg} view={letterView} onView={setLetterView} onChange={onChange} onGo={onGo} say={say} />
    : viewing === "answers" ? <AnswersStep pkg={pkg} onChange={onChange} say={say} />
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
          <ActionBar key={step.step} pkg={pkg} step={step} jobPage={jobPage} onChange={onChange} onGo={onGo} onFlagBlock={onFlagBlock} say={say} />
        </div>
        <aside className="col side" aria-label={viewing === "cv" ? (cvView === "changes" ? "Honesty check" : "File and template") : viewing === "letter" && pkg.letter ? "Checks and voice" : "This package"}>
          {viewing === "letter" && pkg.letter ? <LetterSide letter={pkg.letter} /> : viewing === "cv" ? (cvView === "changes" && pkg.cvVersion ? <CvHonesty cv={pkg.cvVersion} onPreview={() => setCvView("preview")} /> : <CvSide pkg={pkg} onChange={onChange} say={say} />) : (
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
function ActionBar({ pkg, step, jobPage, onChange, onGo, onFlagBlock, say }: {
  pkg: PackageView; step: PackageStepView; jobPage: string; onChange: (p: PackageView) => void; onGo: (v: Viewing) => void; onFlagBlock: () => void; say: (m: string) => void;
}) {
  const [refused, setRefused] = useState<string | null>(null);
  const why = useRef<HTMLParagraphElement>(null);
  const openFlags = step.step === "cv" ? pkg.cvVersion?.flags.filter((f) => !f.decision) ?? [] : [];
  const before = steps.slice(0, steps.indexOf(step.step)).some((s) => !pkg.steps.find((v) => v.step === s)?.approvedAt);
  const flagBlocked = openFlags.length > 0 && !before;
  // An answer that needs Kris: Approve moves focus to that question.
  const waiting = step.step === "answers" && !before ? pkg.answers?.waiting ?? null : null;
  const goToAnswer = () => {
    const el = waiting && document.getElementById(questionElementId(waiting.questionId));
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  };
  // What blocks it gets focus: the alert naming an open flag, the "how to fit one page" choices for a two-page CV, the answer that needs Kris, else the reason.
  const focusBlocker = () => {
    if (flagBlocked) return onFlagBlock();
    if (waiting) return goToAnswer();
    const legend = step.step === "cv" && pkg.cvVersion?.fit.choices.length ? document.getElementById("tighten-legend") : null;
    (legend ?? why.current)?.focus();
  };
  const index = steps.indexOf(step.step);
  const next = steps[index + 1];
  // With flags open, the bar says how many are left; the alert above has the whole reason.
  const reason = flagBlocked ? (openFlags.length === 1 ? `1 flag left: ${openFlags[0]!.title}` : `${openFlags.length} flags left to decide`) : refused ?? step.blocked;

  async function approve() {
    if (step.approvedAt) {
      if (next) onGo(next);
      return;
    }
    if (step.blocked) {
      focusBlocker();
      say(`Can't approve yet: ${step.blocked}`);
      return;
    }
    try {
      const r = await approveStep(pkg.id, step.step);
      onChange(r.package);
      if (!r.approved) {
        setRefused(r.reason);
        if (r.flagId) { onFlagBlock(); say(`Can't approve yet: ${r.reason}`); return; }
        window.setTimeout(focusBlocker, 0);
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
          {waiting && reason === step.blocked
            ? <a href={`#${questionElementId(waiting.questionId)}`} onClick={(e) => { e.preventDefault(); goToAnswer(); }}>{reason}</a>
            : reason}{" "}
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
            <span className="muted">{fromPosting("bg") ? "The posting is in Bulgarian. " : ""}The whole package in Bulgarian, not only the headings. For now switching prints the CV and the cover letter again with the Bulgarian titles and your name as stored in Cyrillic (the letter keeps its words: ask for a new draft in Bulgarian), and writes the screening answers again; nothing is lost.</span>
          </label>
        </fieldset>
      </div>
      {error && <p className="why-off" role="alert">{error}</p>}
    </>
  );
}

type CvView = "changes" | "preview";

function CvStep({ pkg, view, onView, flagAlert, onChange, onGo, say }: {
  pkg: PackageView; view: CvView; onView: (v: CvView) => void; flagAlert: boolean; onChange: (p: PackageView) => void; onGo: (v: Viewing) => void; say: (m: string) => void;
}) {
  const part = pkg.parts.find((p) => p.part === "cv")!;
  const cv = pkg.cvVersion;
  const retry = async () => {
    const r = await retryPart(pkg.id, "cv").catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
    onChange(r.package);
    say(r.changed ? "Writing the CV again…" : r.reason);
  };
  const lead = view === "changes"
    ? `Tailored from your ${pkg.angle.label} angle: what the CV uses for each requirement, and every change from your master profile.`
    : "The exact PDF the extension uploads. Undoing a change prints it again.";
  return (
    <>
      {cv && flagAlert && <FlagAlert pkg={pkg} cv={cv} />}
      <div className="panel">
        <div className="sec-head">
          <div className="step-title grow"><h2 id="cv-title" tabIndex={-1}>CV version</h2><p className="muted">{lead}</p></div>
          {cv && (
            <div className="segmented" role="group" aria-label="View">
              <button type="button" aria-pressed={view === "changes"} onClick={() => onView("changes")}>Changes</button>
              <button type="button" aria-pressed={view === "preview"} onClick={() => onView("preview")}>Preview</button>
            </div>
          )}
        </div>
        {cv && view === "changes" && <FlagList cv={cv} />}
        {cv && cv.fit.choices.length > 0 && <FitChoices pkg={pkg} cv={cv} onChange={onChange} say={say} />}
        {cv && cv.fit.keepTwoPages && <KeptTwo pkg={pkg} onChange={onChange} say={say} />}
        {pkg.cv && (view === "preview" || !cv) ? (
          <Suspense fallback={<p className="meta" role="status">Opening the PDF…</p>}>
            <PdfPreview key={pkg.cv.sha256} url={packageCvUrl(pkg.id, pkg.cv.sha256)} name="CV" pages={pkg.cv.pages} overflow={pkg.cv.overflow !== null} linesOnPage2={pkg.cv.overflow?.linesAfterFirstPage} />
          </Suspense>
        ) : pkg.cv ? null : part.state === "working" || part.state === "waiting" ? (
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
      {cv && view === "changes" && (
        <>
          <LoneFlags pkg={pkg} cv={cv} must={flagAlert} onChange={onChange} say={say} />
          <Evidence pkg={pkg} cv={cv} must={flagAlert} onChange={onChange} say={say} />
          <Changes pkg={pkg} cv={cv} onChange={onChange} say={say} />
          <Lines cv={cv} />
        </>
      )}
    </>
  );
}

const pieceHref = (id: string) => `/profile/pieces/${encodeURIComponent(id)}`;

function PieceLinks({ pieces }: { pieces: PieceLink[] }) {
  return <>{pieces.map((p, i) => <span key={p.id}>{i > 0 && " · "}<a href={pieceHref(p.id)}>{p.label}</a></span>)}</>;
}

const statusChip: Record<EvidenceRow["status"], [string, string, string]> = {
  met: ["met", "met", "Met"], partly: ["partly", "partly", "Partly"], gap: ["gap", "gap", "Gap"], "not-held": ["partly", "partly", "Not held"], unknown: ["neutral", "unknown", "Unknown"],
};

function Evidence({ pkg, cv, must, onChange, say }: { pkg: PackageView; cv: CvVersionView; must: boolean; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  const rows = cv.evidence;
  if (rows.length === 0) return null;
  const count = (st: EvidenceRow["status"]) => rows.filter((r) => r.status === st).length;
  const summary = [`${rows.length} from the posting`, ...(["met", "partly", "gap", "not-held"] as const).filter((st) => count(st)).map((st) => `${count(st)} ${statusChip[st][2].toLowerCase()}`)].join(" · ");
  return (
    <div className="panel">
      <div className="sec-head"><h2>Requirements → evidence</h2><span className="meta">{summary}</span></div>
      <div className="evmap">
        {rows.map((r, i) => {
          const [cls, icon, label] = statusChip[r.status];
          return (
            <div className="ev-row" key={i} id={`req-${i}`}>
              <div className="req">
                <b>{r.requirement}{r.kind === "preferred" && <> <span className="meta">preferred</span></>}</b>
                <span className={`chip ${cls}`}><Icon name={icon as "met"} />{label}</span>
              </div>
              <div className="used">
                <span className="piece-ref">
                  {r.pieces.length > 0 ? <>Evidence: <PieceLinks pieces={r.pieces} /></> : r.status === "gap" ? "No piece in your profile backs it." : "Nothing in your profile claims it."}
                  {r.note && r.pieces.length > 0 && <span className="meta block">{r.note}</span>}
                </span>
                <span className="cvline">{r.onCv.join(" · ")}</span>
              </div>
              {cv.flags.filter((f) => f.requirement === i).map((f) => <Flag key={f.id} pkg={pkg} flag={f} must={must} onChange={onChange} say={say} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Flags (#64)

/** Moves to a flag: scrolls it into view and focuses its heading. */
function goToFlag(id: string) {
  const h = document.getElementById(`flag-h-${id}`);
  h?.scrollIntoView({ block: "center" });
  h?.focus({ preventScroll: true });
}

/** The flags at the top of the step, each a jump link to where it sits. */
function FlagList({ cv }: { cv: CvVersionView }) {
  const open = cv.flags.filter((f) => !f.decision);
  if (cv.flags.length === 0) return null;
  if (open.length === 0) {
    return <p className="meta"><span className="chip met"><Icon name="met" />Flags decided</span> {cv.flags.length === 1 ? "The flag is decided" : `All ${cv.flags.length} flags are decided`}; each stays below with your choice.</p>;
  }
  return (
    <div className="banner warning" role="note">
      <span className="text">
        <b>{open.length === 1 ? "1 flag" : `${open.length} flags`} to decide before you can approve.</b>{" "}
        {open.map((f, i) => (
          <span key={f.id}>{i > 0 && " · "}<a href={`#flag-${f.id}`} onClick={(e) => { e.preventDefault(); goToFlag(f.id); }}>{f.title}</a></span>
        ))}
      </span>
    </div>
  );
}

/** Approve pressed with a flag open: the reason, focused, with a link to the flag (PA-02). */
function FlagAlert({ pkg, cv }: { pkg: PackageView; cv: CvVersionView }) {
  const first = cv.flags.find((f) => !f.decision);
  const reason = pkg.steps[1]!.blocked;
  if (!first || !reason) return null;
  const cut = reason.indexOf(". ");
  return (
    <div className="banner error" role="alert" id="flag-alert" tabIndex={-1}>
      <span className="text"><b>{cut === -1 ? reason : reason.slice(0, cut + 1)}</b>{cut === -1 ? "" : reason.slice(cut + 1)}</span>
      <a className="btn sm" href={`#flag-${first.id}`} onClick={(e) => { e.preventDefault(); goToFlag(first.id); }}>Go to the flag</a>
    </div>
  );
}

/** Flags that don't sit inside a requirement (a summary's wording, a line no requirement asks for). */
function LoneFlags({ pkg, cv, must, onChange, say }: { pkg: PackageView; cv: CvVersionView; must: boolean; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  const lone = cv.flags.filter((f) => f.requirement === null || f.requirement >= cv.evidence.length);
  if (lone.length === 0) return null;
  return (
    <div className="panel">
      <div className="sec-head"><h2>Lines to decide</h2><span className="meta">not tied to one requirement</span></div>
      <div className="stack">{lone.map((f) => <Flag key={f.id} pkg={pkg} flag={f} must={must} onChange={onChange} say={say} />)}</div>
    </div>
  );
}

const flagKind: Record<CvFlagView["kind"], [string, "line" | "gap", string]> = {
  "near-the-line": ["line", "line", "NEAR THE LINE"],
  gap: ["gap", "gap", "GAP"],
  learned: ["line", "line", "NEW LINE · FROM YOUR ANSWER"],
};

/**
 * One flag: its options (none pre-selected), Kris's own wording (checked first), a gap's question.
 * Follow-up fields show from the checked option, never from clicks (PA-01). Decided, it stays with
 * the choice and a Change button.
 */
function Flag({ pkg, flag, must, onChange, say }: { pkg: PackageView; flag: CvFlagView; must: boolean; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [own, setOwn] = useState("");
  const [answer, setAnswer] = useState(flag.answer ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cls, icon, kind] = flagKind[flag.kind];
  const h = `flag-h-${flag.id}`;
  // Focus moves once the element is on the page (a new flag appears after the package is read back).
  const focusSoon = (id: string, tries = 10) => window.setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.focus();
    else if (tries > 0) focusSoon(id, tries - 1);
  }, 50);

  async function send(act: () => Promise<{ changed: boolean; reason?: string; package: PackageView }>, done: (p: PackageView) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await act();
      onChange(r.package);
      if (!r.changed) { setError(r.reason ?? "That didn't work."); return; }
      setChanging(false);
      setPicked(null);
      done(r.package);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const decide = (option: string) => send(() => decideFlag(pkg.id, flag.id, { option }), (p) => {
    const d = p.cvVersion?.flags.find((f) => f.id === flag.id)?.decision;
    say(`Decided: ${d?.label ?? option}.${p.cv?.sha256 !== pkg.cv?.sha256 ? " The CV was printed again." : ""}`);
    focusSoon(h);
  });
  const chooseOwn = () => send(() => decideFlag(pkg.id, flag.id, { own }), () => { say("Your wording is used. The CV was printed again."); focusSoon(h); });
  const tellCoach = () => {
    say("Thanks. The coach is reading your answer.");
    return send(() => answerGap(pkg.id, flag.id, answer), (p) => {
      const learned = p.cvVersion?.flags.find((f) => f.kind === "learned" && f.requirement === flag.requirement);
      say("The coach wrote a line from your answer. It's below as a new flag; the CV changes only once you decide.");
      if (learned) focusSoon(`flag-h-${learned.id}`);
    });
  };

  if (flag.decision && !changing) {
    return (
      <div className={`flag ${cls} resolved`} role="group" aria-labelledby={h} id={`flag-${flag.id}`}>
        <span className="kind"><Icon name="met" />{kind} · DECIDED</span>
        <h3 id={h} tabIndex={-1}>{flag.title}: {lowerFirst(flag.decision.label)}</h3>
        {flag.kind === "gap" && flag.decision.option === "experience" && <p className="muted mini">The line the coach wrote from your answer is the next flag.</p>}
        <div className="row"><button className="btn ghost sm" type="button" onClick={() => { setChanging(true); setPicked(flag.decision!.option); focusSoon(`${h}-legend`); }}>Change<span className="sr-only"> {flag.title}</span></button></div>
      </div>
    );
  }

  const open = !flag.decision;
  const name = `flag-${flag.id}-option`;
  return (
    <div className={`flag ${cls}${must && open ? " must" : ""}`} role="group" aria-labelledby={h} id={`flag-${flag.id}`}>
      <span className="kind"><Icon name={icon} />{kind}{must && open ? " · STILL OPEN" : ""}</span>
      <h3 id={h} tabIndex={-1}>{flag.heading}</h3>
      <p className="muted mini">{flag.detail}</p>
      <fieldset className="choices" disabled={busy}>
        <legend className="sr-only" id={`${h}-legend`} tabIndex={-1}>{flag.title}</legend>
        {flag.options.map((o) => (
          <label className="opt" key={o.id}>
            <input
              type="radio" name={name} value={o.id} checked={picked === o.id}
              aria-controls={o.id === "experience" ? `${h}-question` : undefined}
              onChange={() => setPicked(o.id)}
            />
            <span><b>{flag.kind === "near-the-line" || o.id === "use" ? `"${o.label}"` : o.label}</b><span className="meta">{o.holdsUp}</span></span>
          </label>
        ))}
        {flag.ownWording && (
          <label className="opt">
            <input type="radio" name={name} value="own" checked={picked === "own"} aria-controls={`${h}-own`} onChange={() => setPicked("own")} />
            <span><b>Write my own wording</b><span className="meta">Checked against your profile before it's used.</span></span>
          </label>
        )}
      </fieldset>
      {picked && picked !== "own" && picked !== "experience" && (
        <div className="row">
          <button className="btn sm" type="button" disabled={busy} onClick={() => void decide(picked)}>Save this choice<span className="sr-only"> for {flag.title}</span></button>
          <span className="meta">You can change it until the CV is approved, and after: changing reopens the step.</span>
        </div>
      )}
      {picked === "own" && (
        <div className="field" id={`${h}-own`}>
          <label htmlFor={`${h}-own-text`}>Your wording</label>
          <span className="help" id={`${h}-own-help`}>Only what your profile backs. Numbers and names are checked against the pieces this line relies on.</span>
          <textarea
            className="textarea short" id={`${h}-own-text`} value={own} onChange={(e) => setOwn(e.target.value)}
            aria-describedby={`${h}-own-help${error ? ` ${h}-error` : ""}`} aria-invalid={error ? "true" : undefined}
          />
          <div className="row"><button className="btn sm" type="button" disabled={busy || !own.trim()} onClick={() => void chooseOwn()}>Use this wording</button></div>
        </div>
      )}
      {picked === "experience" && flag.question && (
        <div className="field" id={`${h}-question`}>
          <label htmlFor={`${h}-answer`}>{flag.question.text}</label>
          <span className="help" id={`${h}-answer-help`}>{flag.question.help}</span>
          <textarea
            className="textarea" id={`${h}-answer`} value={answer} onChange={(e) => setAnswer(e.target.value)}
            aria-describedby={`${h}-answer-help${error ? ` ${h}-error` : ""}`} aria-invalid={error ? "true" : undefined}
          />
          <div className="row">
            <button className="btn sm" type="button" disabled={!answer.trim()} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => { if (!busy) void tellCoach(); }}>{busy ? "The coach is reading…" : "Send to the coach"}</button>
            <span className="meta">The piece is used for this job only until you confirm it in Profile.</span>
          </div>
        </div>
      )}
      {flag.notOffered && <p className="meta">{flag.notOffered}</p>}
      {error && <p className="why-off" role="alert" id={`${h}-error`}>{error}</p>}
      {changing && <div className="row"><button className="btn ghost sm" type="button" onClick={() => { setChanging(false); setError(null); focusSoon(h); }}>Keep "{lowerFirst(flag.decision!.label)}"</button></div>}
    </div>
  );
}

const lowerFirst = (t: string) => (/^(Kept|Used|Your|Named|Left|Told)\b/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

function Changes({ pkg, cv, onChange, say }: { pkg: PackageView; cv: CvVersionView; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function toggle(id: string, undo: boolean, label: string) {
    if (busy) return;
    setBusy(id);
    try {
      const r = await (undo ? undoCvChange : redoCvChange)(pkg.id, id);
      onChange(r.package);
      say(r.changed ? `${undo ? "Undone" : "Redone"}: ${label.toLowerCase()}. The CV is printed again.` : r.reason);
    } catch (err) {
      say(`Couldn't ${undo ? "undo" : "redo"} it: ${message(err)}`);
    } finally {
      setBusy(null);
    }
  }
  const live = cv.changes.filter((c) => !c.undone).length;
  return (
    <div className="panel">
      <div className="sec-head"><h2>Changes from your master profile</h2><span className="meta">{cv.changes.length === 0 ? "None: the CV is your profile as it is" : `${live} of ${cv.changes.length} in use · each can be undone, decisions through their flag`}</span></div>
      {(cv.changes.length > 0 || cv.flags.some((f) => f.kind === "near-the-line" && !f.decision)) && (
        <ol className="edits">
          {cv.changes.map((c) => (
            <li key={c.id} className={`edit${c.undone ? " undone" : ""}`}>
              <div className="what">
                <b>{c.label}{c.undone && <span className="meta"> · undone</span>}</b>
                {c.was && <del>{c.was}</del>}
                {c.is && <ins>{c.is}</ins>}
                {c.detail && <span>{c.detail}</span>}
                <span className="why">{c.why}</span>
              </div>
              {c.flagId
                ? <a className="btn ghost sm" href={`#flag-${c.flagId}`} onClick={(e) => { e.preventDefault(); goToFlag(c.flagId!); }}>Change decision<span className="sr-only"> on {c.label.toLowerCase()}</span></a>
                : (
                  <button className="btn ghost sm" type="button" aria-busy={busy === c.id || undefined} onClick={() => void toggle(c.id, !c.undone, c.label)}>
                    {c.undone ? "Redo" : "Undo"}<span className="sr-only"> {c.label.toLowerCase()}</span>
                  </button>
                )}
            </li>
          ))}
          {cv.flags.filter((f) => f.kind === "near-the-line" && !f.decision).map((f) => (
            <li key={f.id} className="edit">
              <div className="what">
                <b>{f.title}</b>
                {f.piece && <del>{f.piece}</del>}
                {f.draft && <ins>{f.draft}</ins>}
                <span className="why"><span className="chip partly"><Icon name="line" />Flagged</span> near the line: decide it above. Until then your profile's wording is used.</span>
              </div>
              <a className="btn ghost sm" href={`#flag-${f.id}`} onClick={(e) => { e.preventDefault(); goToFlag(f.id); }}>Decide<span className="sr-only"> {f.title}</span></a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function LineRow({ line }: { line: CvLineView }) {
  return <li><span>{line.text}</span> <span className="meta">· <PieceLinks pieces={line.pieces} /></span></li>;
}

/** Every line on the CV with the pieces it relies on: nothing on it that the profile doesn't back. */
function Lines({ cv }: { cv: CvVersionView }) {
  return (
    <div className="panel">
      <details className="cv-lines">
        <summary><h2>Every line and its pieces</h2> <span className="meta">each line on the CV, linked to the pieces it relies on</span></summary>
        <div className="stack">
          {cv.summary && <section><h3>Summary</h3><ul><LineRow line={cv.summary} /></ul></section>}
          {cv.roles.map((r) => (
            <section key={r.roleId}><h3>{r.heading}</h3>{r.bullets.length ? <ul>{r.bullets.map((b, i) => <LineRow key={i} line={b} />)}</ul> : <p className="meta">Title and dates only.</p>}</section>
          ))}
          {cv.skills.length > 0 && <section><h3>Skills</h3><ul>{cv.skills.map((l, i) => <LineRow key={i} line={l} />)}</ul></section>}
          {cv.education.length > 0 && <section><h3>Education</h3><ul>{cv.education.map((l, i) => <LineRow key={i} line={l} />)}</ul></section>}
        </div>
      </details>
    </div>
  );
}

/** A CV that runs onto page 2: the ways to tighten it, none pre-selected; type and margins never shrink. */
function FitChoices({ pkg, cv, onChange, say }: { pkg: PackageView; cv: CvVersionView; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  async function choose(id: string, label: string) {
    const r = await fitCv(pkg.id, id).catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
    onChange(r.package);
    setError(r.changed ? null : r.reason);
    if (!r.changed) return;
    const fits = r.package.cv?.pages === 1;
    say(id === "keep-two-pages" ? "Kept 2 pages." : `${label}. ${fits ? "The CV fits on one page now." : "It still runs onto page 2: choose again."} Undo it under Changes.`);
    window.setTimeout(() => (document.getElementById(fits || id === "keep-two-pages" ? "cv-title" : "tighten-legend"))?.focus(), 0);
  }
  const n = cv.fit.linesOnPage2;
  return (
    <>
      <div className="banner warning" role="note">
        <span className="text"><b>This CV runs onto a second page: {n} {n === 1 ? "line spills" : "lines spill"} over.</b> One page is the rule for your template. Pick what to tighten; each choice shows as a change you can undo. Type and margins never shrink.</span>
      </div>
      <fieldset className="choices">
        <legend id="tighten-legend" tabIndex={-1}>How to fit it on one page</legend>
        {cv.fit.choices.map((c) => (
          <label className="choice" key={c.id}>
            <input type="radio" name="tighten" checked={false} onChange={() => void choose(c.id, c.label)} />
            <b>{c.label}</b>
            <span className="meta">{c.meta}</span>
          </label>
        ))}
      </fieldset>
      {error && <p className="why-off" role="alert">{error}</p>}
    </>
  );
}

function KeptTwo({ pkg, onChange, say }: { pkg: PackageView; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  async function again() {
    const r = await fitCv(pkg.id, "choose-again").catch((err: unknown) => ({ changed: false as const, reason: message(err), package: pkg }));
    onChange(r.package);
    say(r.changed ? "Choose how to fit one page, or keep 2." : r.reason);
    if (r.changed) window.setTimeout(() => document.getElementById("tighten-legend")?.focus(), 0);
  }
  return (
    <div className="banner info" role="note">
      <span className="text">You kept 2 pages. Some recruiters skip page 2; the ATS check will say so.</span>
      <button className="btn sm" type="button" onClick={() => void again()}>Choose again</button>
    </div>
  );
}

const checkChip: Record<HonestyCheckView["state"], [string, "met" | "line" | "gap", string]> = {
  ok: ["met", "met", "OK"], fixed: ["met", "met", "Fixed"], line: ["partly", "line", "Open"], gap: ["gap", "gap", "Gap"],
};

function CvHonesty({ cv, onPreview }: { cv: CvVersionView; onPreview: () => void }) {
  return (
    <>
      <div className="panel">
        <h2>Honesty check</h2>
        <ul className="checks">
          {cv.honesty.map((c) => {
            const [cls, icon, label] = checkChip[c.state];
            return (
              <li key={c.id}>
                <span className={`chip ${cls}`}><Icon name={icon} />{label}</span>
                <span>{c.label}{c.detail && <span className="meta block">{c.detail}</span>}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="panel">
        <h2>Tailoring notes</h2>
        <ul className="notes">{cv.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        <div className="row"><button className="btn ghost sm" type="button" onClick={onPreview}>See the exact PDF</button></div>
      </div>
    </>
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
            <a className="btn primary" href="/setup">Set up your profile</a>
            <a className="btn" href="/setup">Import one CV and start this package</a>
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
