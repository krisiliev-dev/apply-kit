import type { AddLinkResult, PastedPosting } from "@apply-kit/core";
import { useId, useRef, useState } from "react";
import { addJobLink } from "../api.ts";

type Unreadable = Extract<AddLinkResult, { outcome: "unreadable" }>;

type State =
  | { step: "idle" }
  | { step: "adding" }
  | { step: "invalid"; message: string }
  | { step: "error"; message: string };

/** Opens the Job a pasted link became (or already was), saying which on the Job page. */
function openJob(result: Extract<AddLinkResult, { jobId: string }>) {
  window.location.assign(`/jobs/${encodeURIComponent(result.jobId)}?link=${result.outcome}`);
}

/**
 * "Paste a job link": the Feed's first-run field and the toolbar's Add job. A link already in the
 * Feed opens its Job; a page that can't be read says why, keeps the link, and offers to paste the
 * job's text instead (the app never reads LinkedIn and other protected sites itself).
 */
export function PasteLink({ label, autoFocus = false }: { label: string; autoFocus?: boolean }) {
  const id = useId();
  const [link, setLink] = useState("");
  const [state, setState] = useState<State>({ step: "idle" });
  /** The page couldn't (or mustn't) be read: the link stays, and Kris can paste the text. */
  const [kept, setKept] = useState<Unreadable | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = (pasted?: PastedPosting) => {
    if (!link.trim()) {
      setState({ step: "invalid", message: "Paste a link to the job first." });
      input.current?.focus();
      return;
    }
    setState({ step: "adding" });
    addJobLink(link, pasted)
      .then((result) => {
        if (result.outcome === "invalid") {
          setState({ step: "invalid", message: result.message });
          input.current?.focus();
        } else if (result.outcome === "unreadable") {
          setState({ step: "idle" });
          setKept(result);
          setLink(result.link);
        } else {
          openJob(result);
        }
      })
      .catch((err: unknown) => setState({ step: "error", message: err instanceof Error ? err.message : String(err) }));
  };

  const adding = state.step === "adding";
  const problem = state.step === "invalid" || state.step === "error" ? state.message : null;
  return (
    <div className="stack paste-link" style={{ gap: "var(--s-4)" }}>
      <form className="field" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor={`${id}-link`}>{label}</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input
            ref={input}
            className="input"
            id={`${id}-link`}
            name="job-link"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste a job link…"
            value={link}
            autoFocus={autoFocus}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-err` : undefined}
            onChange={(e) => { setLink(e.target.value); setKept(null); if (!adding) setState({ step: "idle" }); }}
          />
          <button className="btn" type="submit" disabled={adding}>{adding ? "Adding…" : "Add"}</button>
        </div>
        {problem && <span className="err" id={`${id}-err`} role="alert">{problem}</span>}
        <span className="meta" role="status">{adding ? (kept ? "Adding the job…" : "Reading the page…") : ""}</span>
      </form>
      {kept && <PasteText key={kept.link} result={kept} busy={adding} onAdd={submit} />}
    </div>
  );
}

/** Shown when a page couldn't be read: why, and the posting's text pasted by hand instead. */
function PasteText({ result, busy, onAdd }: {
  result: Unreadable;
  busy: boolean;
  onAdd: (pasted: PastedPosting) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(result.pageTitle ?? "");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [text, setText] = useState("");
  const [missing, setMissing] = useState<string | null>(null);
  const heading = result.problem === "protected" || result.problem === "robots" || result.problem === "blocked"
    ? "apply-kit doesn't read this site" : "Couldn't read this page";

  return (
    <div className="panel stack paste-text" style={{ gap: "var(--s-4)" }}>
      <div className="banner error" role="alert">
        <span className="text"><b>{heading}.</b> {result.message} The link is kept: paste the job's text below and it's added with this link.</span>
      </div>
      <form
        className="stack"
        style={{ gap: "var(--s-4)" }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || !text.trim()) {
            setMissing(!title.trim() ? "Add the job's title." : "Paste the job's text.");
            return;
          }
          setMissing(null);
          onAdd({ title: title.trim(), company: company.trim() || null, location: location.trim() || null, text });
        }}
      >
        <div className="field">
          <label htmlFor={`${id}-title`}>Job title</label>
          <input className="input" id={`${id}-title`} name="title" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={missing && !title.trim() ? true : undefined} />
        </div>
        <div className="row paste-pair">
          <div className="field">
            <label htmlFor={`${id}-company`}>Company <span className="meta">(optional)</span></label>
            <input className="input" id={`${id}-company`} name="company" autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-location`}>Location <span className="meta">(optional)</span></label>
            <input className="input" id={`${id}-location`} name="location" autoComplete="off" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${id}-text`}>The job's text</label>
          <span className="help" id={`${id}-help`}>Select everything on the job's page from the title down, copy, and paste it here. It's read like any other posting.</span>
          <textarea className="input" id={`${id}-text`} name="text" rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={`${id}-help${missing ? ` ${id}-missing` : ""}`} aria-invalid={missing && !text.trim() ? true : undefined} />
          {missing && <span className="err" id={`${id}-missing`} role="alert">{missing}</span>}
        </div>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add this job"}</button>
        </div>
      </form>
    </div>
  );
}
