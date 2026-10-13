// "Add an application" (hi-fi: docs/design/hifi/applications.html, state "Add application"). For
// applications made outside apply-kit: a Job in apply-kit (any state) or one made elsewhere (company,
// title and an optional posting link, read like a pasted job), the date applied, the Status now and
// an optional contact. "I applied without apply-kit…" on a Job page opens it with that Job chosen.
import type { AddApplicationResult, AddField, ApplicationSummary, JobChoice, Status } from "@apply-kit/core";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { addApplication, findJobsToApply } from "../api.ts";
import { longDay, shortDay, statusLabel, todaySofia } from "./words.ts";

/** Statuses an Application can be added in. Accepted goes through the offer step instead. */
const addable: Status[] = ["applied", "screening", "interviewing", "offer", "rejected", "withdrawn"];

const stateWord: Record<JobChoice["state"], string> = { new: "Found", saved: "Saved", passed: "Passed", closed: "Closed" };

/** A Job already chosen (from its Job page). */
export interface ChosenJob {
  id: string;
  title: string;
  company: string;
}

export type Added = Extract<AddApplicationResult, { outcome: "added" }>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function AddApplicationDialog({ chosen, onAdded, onCancel, onOpenExisting }: {
  chosen?: ChosenJob;
  onAdded: (result: Added) => void;
  onCancel: () => void;
  /** Opens the existing Application in place (on the Applications page); otherwise its link is followed. */
  onOpenExisting?: (application: ApplicationSummary) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const today = todaySofia();
  const [from, setFrom] = useState<"job" | "other">("job");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<JobChoice[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(chosen?.id ?? null);
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [appliedOn, setAppliedOn] = useState(today);
  const [status, setStatus] = useState<Status>("applied");
  const [contact, setContact] = useState("");
  const [error, setError] = useState<{ field: AddField | "form"; message: string } | null>(null);
  const [existing, setExisting] = useState<{ application: ApplicationSummary; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Jobs matching the search, as Kris types (passed and closed ones too).
  useEffect(() => {
    if (chosen || from !== "job") return;
    const words = q.trim();
    if (!words) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      findJobsToApply(words, ctrl.signal).then(setFound).catch(() => { if (!ctrl.signal.aborted) setFound([]); });
    }, 200);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q, from, chosen]);

  const close = (fn: () => void) => { ref.current?.close(); fn(); };
  const id = (field: string) => `${uid}-${field}`;
  const errorFor = (field: AddField) => (error?.field === field ? error.message : null);
  const invalid = (field: AddField) => (error?.field === field ? true : undefined);

  // Puts the error under its field and moves focus there.
  const fail = (field: AddField | "form", msg: string) => {
    setError({ field, message: msg });
    const target = field === "job" ? (chosen ? null : `${uid}-q`) : field === "form" ? null : `${uid}-${field}`;
    requestAnimationFrame(() => { if (target) document.getElementById(target)?.focus(); });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setExisting(null);
    if (from === "job" && !jobId) { fail("job", "Choose a job from the search, or choose Somewhere else to type it in."); return; }
    if (from === "other" && !company.trim()) { fail("company", "Enter the company, so replies can be matched to it."); return; }
    setBusy(true);
    try {
      const result = await addApplication({
        job: from === "job" ? { jobId: jobId! } : { company, title, link: link.trim() || null },
        appliedOn, status, contact: contact.trim() || null, how: chosen ? "i-applied" : "by-hand",
      });
      if (result.outcome === "invalid") fail(result.field, result.message);
      else if (result.outcome === "already-open") {
        setExisting({ application: result.application, message: result.message });
        requestAnimationFrame(() => document.getElementById(id("existing"))?.focus());
      } else close(() => onAdded(result));
    } catch (err) {
      fail("form", `Couldn't add it: ${message(err)}. Check that the apply-kit service is running, then try again.`);
    } finally {
      setBusy(false);
    }
  }

  // Results only for what is in the box now.
  const results = q.trim() ? found : null;
  const reading = busy && from === "other" && link.trim();

  return (
    <dialog ref={ref} className="dlg" aria-labelledby={id("h")} onCancel={(e) => { e.preventDefault(); close(onCancel); }}>
      <form onSubmit={submit} noValidate>
        <div className="dlg-head">
          <h2 id={id("h")} tabIndex={-1}>Add an application</h2>
          <button className="btn ghost sm x" type="button" aria-label="Close" onClick={() => close(onCancel)}>✕</button>
        </div>
        <p className="meta">
          {chosen
            ? "For a job you applied to without apply-kit, on the company's site or through a recruiter, so it's tracked like any other."
            : "For applications made outside apply-kit, so they're tracked with the rest."}
        </p>

        {chosen ? (
          <p>Job: <b>{chosen.title}</b> · {chosen.company}</p>
        ) : (
          <>
            <fieldset>
              <legend>Which job?</legend>
              <div className="choice">
                <label>
                  <input type="radio" name="from" value="job" checked={from === "job"} onChange={() => { setFrom("job"); setError(null); }} autoFocus />
                  <span><b>A job in apply-kit</b><span className="meta">Search the Feed, including passed and closed jobs</span></span>
                </label>
                <label>
                  <input type="radio" name="from" value="other" checked={from === "other"} onChange={() => { setFrom("other"); setError(null); }} />
                  <span><b>Somewhere else</b><span className="meta">Type the company and title, or paste a link</span></span>
                </label>
              </div>
            </fieldset>

            {from === "job" ? (
              <div className="stack">
                <div className="field">
                  <label htmlFor={id("q")}>Search jobs</label>
                  <div className="search">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    <input
                      className="input" id={id("q")} type="search" autoComplete="off" value={q} placeholder="Job title or company"
                      aria-invalid={invalid("job")} aria-describedby={errorFor("job") ? id("job-err") : undefined}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                  {errorFor("job") && <span className="err" id={id("job-err")}>{errorFor("job")}</span>}
                </div>
                {results && results.length > 0 && (
                  <ul className="results" aria-label="Matching jobs">
                    {results.map((j) => (
                      <li key={j.id}>
                        <label>
                          <input type="radio" name="job" value={j.id} checked={jobId === j.id} onChange={() => setJobId(j.id)} />
                          <span>
                            <b>{j.title}</b> · {j.company}
                            <span className="meta" style={{ display: "block" }}>
                              {[
                                j.stateChangedAt ? `${stateWord[j.state]} ${shortDay(todaySofia(new Date(j.stateChangedAt)))}` : stateWord[j.state],
                                j.location,
                                j.application && `you have an open Application (${statusLabel[j.application.status]})`,
                              ].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {results && results.length === 0 && <p className="meta" role="status">No jobs match. Choose Somewhere else to type it in.</p>}
              </div>
            ) : (
              <div className="stack">
                <div className="field-row">
                  <div className="field">
                    <label htmlFor={id("company")}>Company</label>
                    <input className="input" id={id("company")} autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} aria-invalid={invalid("company")} aria-describedby={errorFor("company") ? id("company-err") : undefined} />
                    {errorFor("company") && <span className="err" id={id("company-err")}>{errorFor("company")}</span>}
                  </div>
                  <div className="field">
                    <label htmlFor={id("title")}>Job title</label>
                    <input className="input" id={id("title")} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={invalid("title")} aria-describedby={errorFor("title") ? id("title-err") : undefined} />
                    {errorFor("title") && <span className="err" id={id("title-err")}>{errorFor("title")}</span>}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor={id("link")}>Link to the posting <span className="meta">(optional)</span></label>
                  <span className="help" id={id("link-help")}>apply-kit reads it like a pasted job, so the Application has a Job page with the posting.</span>
                  <input
                    className="input" id={id("link")} type="url" inputMode="url" spellCheck={false} autoComplete="off" placeholder="https://" value={link}
                    onChange={(e) => setLink(e.target.value)} aria-invalid={invalid("link")}
                    aria-describedby={`${id("link-help")}${errorFor("link") ? ` ${id("link-err")}` : ""}`}
                  />
                  {errorFor("link") && <span className="err" id={id("link-err")}>{errorFor("link")}</span>}
                </div>
              </div>
            )}
          </>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor={id("appliedOn")}>Applied on</label>
            <input
              className="input" id={id("appliedOn")} type="date" max={today} value={appliedOn} onChange={(e) => setAppliedOn(e.target.value)}
              aria-invalid={invalid("appliedOn")} aria-describedby={`${id("day")}${errorFor("appliedOn") ? ` ${id("appliedOn-err")}` : ""}`}
            />
            <span className="help" id={id("day")}>{longDay(appliedOn)}</span>
            {errorFor("appliedOn") && <span className="err" id={id("appliedOn-err")}>{errorFor("appliedOn")}</span>}
          </div>
          <div className="field">
            <label htmlFor={id("status")}>Status now</label>
            <select className="input" id={id("status")} value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-invalid={invalid("status")} aria-describedby={errorFor("status") ? id("status-err") : undefined}>
              {addable.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
            </select>
            {errorFor("status") && <span className="err" id={id("status-err")}>{errorFor("status")}</span>}
          </div>
        </div>

        <div className="field">
          <label htmlFor={id("contact")}>Their email address or domain <span className="meta">(optional)</span></label>
          <span className="help" id={id("contact-help")}>A recruiter's address, for example, so replies can be matched to this Application.</span>
          <input
            className="input" id={id("contact")} autoComplete="off" spellCheck={false} placeholder="jobs@company.com" value={contact}
            onChange={(e) => setContact(e.target.value)} aria-invalid={invalid("contact")}
            aria-describedby={`${id("contact-help")}${errorFor("contact") ? ` ${id("contact-err")}` : ""}`}
          />
          {errorFor("contact") && <span className="err" id={id("contact-err")}>{errorFor("contact")}</span>}
        </div>

        {existing && (
          <div className="banner info" role="alert">
            <span className="text">{existing.message} Nothing was added.</span>
            <a
              className="btn sm" id={id("existing")} href={`/applications#app-${encodeURIComponent(existing.application.id)}`}
              onClick={(e) => { if (onOpenExisting) { e.preventDefault(); close(() => onOpenExisting(existing.application)); } }}
            >
              Open it in Applications
            </a>
          </div>
        )}
        {error?.field === "form" && <div className="banner error" role="alert"><span className="text">{error.message}</span></div>}

        <div className="dlg-foot">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy && <span className="spin" aria-hidden="true" />}
            {reading ? "Reading the posting…" : busy ? "Adding…" : "Add application"}
          </button>
          <button className="btn ghost" type="button" onClick={() => close(onCancel)}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}
