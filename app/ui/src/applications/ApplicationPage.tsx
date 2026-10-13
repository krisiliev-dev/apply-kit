// One Application (hi-fi: docs/design/hifi/application.html, states Applied · waiting, Added by hand,
// Loading and Not found): the header with company, dates, angle and Job page link; the status stepper
// (skipped steps struck through, derived from Events) with the Status select; the Next step box; the
// timeline, each Event naming its cause, with Undo where it applies and Add note; and beside it
// "What you sent" (Attach CV) for one added by hand, the target posting and the contacts.
// Follow-ups, interviews, offers and the Package as sent come with later Track tickets.
import type { ApplicationDetail, ApplicationSummary, HealthSummary, Status, TimelineEntry } from "@apply-kit/core";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  addApplicationContact, addApplicationNote, applicationCvUrl, attachApplicationCv, fetchApplication, fetchSources,
  setApplicationStatus, undoApplicationEvent,
} from "../api.ts";
import { useToaster, type Toaster } from "../feed/toast.tsx";
import { By, StatusSelect } from "./ApplicationsPage.tsx";
import { angleLabel, longDay, statusLabel, todaySofia } from "./words.ts";

type Load = { state: "loading" } | { state: "missing" } | { state: "error"; message: string } | { state: "ready"; app: ApplicationDetail };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** Bulgarian titles are marked as such, so screen readers read them in Bulgarian. */
const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);
const sep = (s: string) => s.replace("Sept", "Sep");

/** "Wed 7 Oct 18:02", or "today 08:40", in Sofia time. */
function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Sofia" });
  if (todaySofia(d) === todaySofia()) return `today ${time}`;
  return `${sep(d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Sofia" })).replace(",", "")} ${time}`;
}
/** "Fri 9 Oct" for a YYYY-MM-DD day. */
const shortLong = (day: string) => longDay(day).replace(",", "").replace(/ \d{4}$/, "");
/** "Fri 9 Oct" for an ISO time, in Sofia. */
const dayOf = (iso: string) => shortLong(todaySofia(new Date(iso)));

export function ApplicationPage({ id, onHealth }: { id: string; onHealth: (h: HealthSummary) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const toaster = useToaster();
  const contactRef = useRef<HTMLButtonElement>(null);

  // The top bar shows source health on every screen.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchApplication(id, ctrl.signal)
      .then((app) => setLoad({ state: "ready", app }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const m = message(err);
        setLoad(m === "No such application" ? { state: "missing" } : { state: "error", message: m });
      });
    return () => ctrl.abort();
  }, [id, attempt]);

  const titled = load.state === "ready" ? `${load.app.title} · ${load.app.company}` : load.state === "missing" ? "Not found" : null;
  useEffect(() => { document.title = `${titled ?? "Application"} · apply-kit`; }, [titled]);

  const refresh = useCallback(async () => {
    const app = await fetchApplication(id);
    setLoad({ state: "ready", app });
    return app;
  }, [id]);

  if (load.state === "loading") return <Loading />;
  if (load.state === "missing") return <NotFound />;
  if (load.state === "error") {
    return (
      <div className="banner error" role="alert">
        <span className="text"><b>Couldn't reach the apply-kit service.</b> {load.message}. Check that it is running, then try again.</span>
        <button className="btn sm" type="button" onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}>Try again</button>
      </div>
    );
  }

  const { app } = load;
  const focusStatus = () => requestAnimationFrame(() => document.getElementById(`st-${app.id}`)?.focus());

  async function changeStatus(a: ApplicationSummary, to: Status): Promise<boolean> {
    try {
      const { event } = await setApplicationStatus(a.id, to);
      await refresh();
      focusStatus();
      toaster.show({
        message: `${statusLabel[a.status]} → ${statusLabel[to]}. Logged by you.`,
        returnFocus: focusStatus,
        undo: () => {
          undoApplicationEvent(event.id)
            .then(refresh)
            .then(() => { focusStatus(); toaster.announce(`Undone. Back to ${statusLabel[a.status]}.`); })
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
      });
      return true;
    } catch (err) {
      await refresh().catch(() => {});
      toaster.show({ message: `Couldn't change the Status: ${message(err)}` });
      return false;
    }
  }

  const byHand = app.createdHow === "by-hand" || app.createdHow === "i-applied";

  return (
    <section className="stack app-page" style={{ gap: "var(--s-6)" }}>
      <Head app={app} onStatus={changeStatus} />
      <div className="cols">
        <div className="col">
          <NextStep app={app} onAddContact={() => contactRef.current?.click()} />
          <Timeline app={app} refresh={refresh} toaster={toaster} />
        </div>
        <div className="col">
          {byHand && <WhatYouSent app={app} refresh={refresh} toaster={toaster} />}
          <Posting app={app} />
          <Contacts app={app} refresh={refresh} toaster={toaster} addRef={contactRef} />
        </div>
      </div>
      {toaster.element}
    </section>
  );
}

function Head({ app, onStatus }: { app: ApplicationDetail; onStatus: (a: ApplicationSummary, to: Status) => Promise<boolean> }) {
  const closed = app.status === "rejected" || app.status === "withdrawn";
  const lang = langOf(app.title);
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/applications">Applications</a><span aria-hidden="true">/</span><span aria-current="page" lang={lang}>{app.title}</span>
      </nav>
      <div className="app-head">
        <h1 lang={lang}>{app.title}</h1>
        <div className="app-meta">
          <b>{app.company}</b>
          <span>Applied {shortLong(app.appliedOn)}</span>
          {app.status !== "applied" && <span>{statusLabel[app.status]} {dayOf(app.statusSince)}</span>}
          {app.createdHow === "by-hand" && <span>added by hand</span>}
          {app.createdHow === "i-applied" && <span>applied without apply-kit</span>}
          {app.angle && <span className="chip neutral">{angleLabel[app.angle]} angle</span>}
          {app.posting?.jobId && <a className="mini" href={`/jobs/${encodeURIComponent(app.posting.jobId)}`}>Job page</a>}
        </div>
        <div className="stepper" role="group" aria-label={`Status: ${statusLabel[app.status]}`}>
          <ol aria-label="Status steps">
            {app.steps.map((s) => (
              <li key={s.status} className={s.state === "current" ? `now${s.status === "offer" || s.status === "accepted" ? " win" : ""}` : s.state === "todo" ? undefined : s.state} aria-current={s.state === "current" ? "step" : undefined}>
                <span className="dot">{(s.state === "done" || s.state === "current") && <Check />}</span>
                {statusLabel[s.status]}
                {s.state === "done" && <span className="sr-only"> (done)</span>}
                {s.state === "skipped" && <span className="sr-only"> (skipped)</span>}
              </li>
            ))}
          </ol>
          <span className="or">or</span>
          <span className="branch">
            {(["rejected", "withdrawn"] as const).map((s) => (
              <span key={s} className={`status ${s}${app.status === s ? " is-current" : ""}`} aria-current={app.status === s ? "step" : undefined}>
                <i />{statusLabel[s]}{app.status === s && <span className="sr-only"> (current)</span>}
              </span>
            ))}
          </span>
          <div className="set"><StatusSelect key={app.status} app={app} onStatus={onStatus} label="Status" /></div>
        </div>
        {closed && <p className="meta">Closed Applications are kept, never deleted. Change the Status if it opens again.</p>}
      </div>
    </>
  );
}

function Check() {
  return <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function NextStep({ app, onAddContact }: { app: ApplicationDetail; onAddContact: () => void }) {
  const n = app.nextStep;
  const byHand = app.createdHow === "by-hand" || app.createdHow === "i-applied";
  const matched = app.contacts.map((c) => c.value);
  return (
    <div className="panel next-step">
      <span className="kicker">Next step</span>
      <h2>{n.kind === "wait" ? `${n.text.replace(/\.$/, "")} from ${app.company}.` : n.text}</h2>
      {n.kind === "note" && <p className="muted mini">From your latest note, {when(n.at)}. Add a newer note when it changes.</p>}
      {n.kind === "wait" && (
        <p className="muted mini">
          {matched.length
            ? `Replies from ${matched.join(", ")} are matched to this Application once email matching arrives. Change the Status yourself when you hear back.`
            : "Change the Status when you hear back. Add a recruiter's address or the company's domain so their replies can be matched here."}
        </p>
      )}
      {n.kind !== "closed" && byHand && (
        <div className="row"><button className="btn sm" type="button" onClick={onAddContact}>Add a contact address</button></div>
      )}
    </div>
  );
}

const causeWords = { you: "by you", email: "by email", "apply-kit": "by apply-kit" } as const;

function entryTitle(e: TimelineEntry): string {
  if (e.kind === "status" && e.from && e.to) return `${statusLabel[e.from]} → ${statusLabel[e.to]}`;
  if (e.kind === "note") return "Note";
  return e.text;
}

function Timeline({ app, refresh, toaster }: { app: ApplicationDetail; refresh: () => Promise<ApplicationDetail>; toaster: Toaster }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const errId = useId();

  // The field takes focus when it opens; "Add note" gets it back once it is rendered again.
  const opened = useRef(false);
  useEffect(() => {
    if (writing) fieldRef.current?.focus();
    else if (opened.current) addRef.current?.focus();
    opened.current = writing;
  }, [writing]);

  const cancel = () => { setWriting(false); setText(""); setError(null); };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) { setError("Write the note first."); fieldRef.current?.focus(); return; }
    setBusy(true);
    try {
      const { event } = await addApplicationNote(app.id, text);
      await refresh();
      cancel();
      toaster.show({
        message: "Note added to the timeline.",
        returnFocus: () => addRef.current?.focus(),
        undo: () => {
          undoApplicationEvent(event.id).then(refresh).then(() => toaster.announce("Note removed."))
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
      });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function undo(e: TimelineEntry) {
    undoApplicationEvent(e.id)
      .then(refresh)
      .then((after) => {
        toaster.announce(e.kind === "status" ? `Undone. Back to ${statusLabel[after.status]}.` : "Undone.");
        requestAnimationFrame(() => document.getElementById(`st-${app.id}`)?.focus());
      })
      .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
  }

  // Undo records and the Events they undid stay on the timeline; the undone ones say so.
  return (
    <section className="panel" aria-labelledby="tl-h">
      <div className="sec-head">
        <h2 id="tl-h">Timeline</h2><span className="grow" />
        {!writing && <button className="btn sm" type="button" ref={addRef} onClick={() => setWriting(true)}>Add note</button>}
      </div>
      {writing && (
        <form className="stack note-form" onSubmit={save} noValidate>
          <div className="field">
            <label htmlFor={fieldId}>Note <span className="meta">(only you see it)</span></label>
            <textarea
              className="input" id={fieldId} ref={fieldRef} value={text} onChange={(e) => setText(e.target.value)}
              aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } }}
            />
            {error && <span className="err" id={errId} role="alert">{error}</span>}
          </div>
          <div className="row">
            <button className="btn primary sm" type="submit" disabled={busy}>Save note</button>
            <button className="btn ghost sm" type="button" onClick={cancel}>Cancel</button>
          </div>
        </form>
      )}
      <ol className="timeline">
        {app.timeline.map((e) => (
          <li key={e.id} className={e.undoneAt ? "undone" : undefined}>
            <time dateTime={e.at}>{when(e.at)}</time>
            <div className="ev">
              <div className="line">
                <b>{entryTitle(e)}</b>
                <By cause={e.cause} />
                {e.undoneAt && <span className="meta">Undone {when(e.undoneAt)}</span>}
                {e.undoable && (
                  <button className="btn ghost sm" type="button" onClick={() => undo(e)}>
                    Undo<span className="sr-only">: {entryTitle(e)}, {causeWords[e.cause]}</span>
                  </button>
                )}
              </div>
              {e.kind === "note" && <span className="muted" lang={langOf(e.text)}>{e.text}</span>}
              {e.detail && <span className="muted">{e.detail}</span>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const thumb = (
  <span className="doc-thumb" aria-hidden="true">
    <i className="h" /><i /><i className="s" /><i /><i /><i className="s" /><i /><i /><i className="s" />
  </span>
);

function WhatYouSent({ app, refresh, toaster }: { app: ApplicationDetail; refresh: () => Promise<ApplicationDetail>; toaster: Toaster }) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const errId = useId();

  const choose = (f: File | null) => {
    setError(null);
    if (!f) return;
    setFile(f);
    setLabel(f.name.replace(/\.pdf$/i, ""));
  };
  // The label takes focus when a file is chosen; the Attach button gets it back after.
  const chosen = useRef(false);
  useEffect(() => {
    if (file) labelRef.current?.focus();
    else if (chosen.current) pickRef.current?.focus();
    chosen.current = !!file;
  }, [file]);
  const cancel = () => {
    setFile(null); setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  async function attach(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const { cv } = await attachApplicationCv(app.id, file, label);
      await refresh();
      cancel();
      toaster.show({ message: `CV attached · it counts as "${cv.label}" under CV version.` });
    } catch (err) {
      setError(message(err));
      labelRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="sent-h">
      <h2 id="sent-h">What you sent</h2>
      {app.cv ? (
        <div className="pkg">
          <div className="item">
            <span className="row cv-row">{thumb}<span><b>CV · {app.cv.label}</b><br /><span className="meta">{app.cv.fileName} · {sizeOf(app.cv.bytes)} · attached {dayOf(app.cv.attachedAt)}</span></span></span>
            <a className="btn sm" href={applicationCvUrl(app.id)} target="_blank" rel="noreferrer">View PDF<span className="sr-only"> (opens in a new tab)</span></a>
          </div>
        </div>
      ) : (
        <p className="muted mini">
          Applied outside apply-kit, so there's no Package. Attach the CV you sent if you'd like it shown here and counted under "CV version" in What's working.
        </p>
      )}
      <input
        ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(e) => choose(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <form className="stack" onSubmit={attach} noValidate>
          <p className="mini"><b>{file.name}</b> <span className="meta">· {sizeOf(file.size)}</span></p>
          <div className="field">
            <label htmlFor={labelId}>CV version</label>
            <span className="help">The name it counts under in What's working, like "Design v2".</span>
            <input
              className="input" id={labelId} ref={labelRef} value={label} onChange={(e) => setLabel(e.target.value)}
              aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
            />
            {error && <span className="err" id={errId} role="alert">{error}</span>}
          </div>
          <div className="row">
            <button className="btn primary sm" type="submit" disabled={busy}>Attach CV</button>
            <button className="btn ghost sm" type="button" onClick={cancel}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="row">
          <button className="btn sm" type="button" ref={pickRef} onClick={() => inputRef.current?.click()}>
            {app.cv ? "Replace CV (PDF)…" : "Attach CV (PDF)…"}
          </button>
        </div>
      )}
    </section>
  );
}

const sizeOf = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function Posting({ app }: { app: ApplicationDetail }) {
  const p = app.posting;
  const host = p ? (() => { try { return new URL(p.url).host; } catch { return p.url; } })() : null;
  return (
    <section className="panel" aria-labelledby="posting-h">
      <h2 id="posting-h">Target posting</h2>
      {p ? (
        <>
          <p className="mini muted"><span lang={langOf(p.title)}>{p.title}</span> · {p.company} · {host}</p>
          {p.closed && <p className="meta">Closed {dayOf(p.closed.at)}: {p.closed.how}. The Job page keeps a saved copy.</p>}
          {!p.jobId && <p className="meta">The posting couldn't be read when you added it, so there's no saved copy; the link is kept.</p>}
          <div className="row">
            {p.jobId && <a className="btn ghost sm" href={`/jobs/${encodeURIComponent(p.jobId)}`}>Job page · saved copy</a>}
            <a className="btn ghost sm" href={p.url} target="_blank" rel="noreferrer">Open posting<span className="sr-only"> on {host} (opens in a new tab)</span></a>
          </div>
        </>
      ) : (
        <p className="mini muted">Added without a posting link, so there's no saved copy.</p>
      )}
    </section>
  );
}

function Contacts({ app, refresh, toaster, addRef }: {
  app: ApplicationDetail; refresh: () => Promise<ApplicationDetail>; toaster: Toaster; addRef: RefObject<HTMLButtonElement | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const errId = useId();

  const opened = useRef(false);
  useEffect(() => {
    if (adding) fieldRef.current?.focus();
    else if (opened.current) addRef.current?.focus();
    opened.current = adding;
  }, [adding]);
  const cancel = () => { setAdding(false); setValue(""); setError(null); };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await addApplicationContact(app.id, value);
      await refresh();
      const added = value.trim();
      cancel();
      toaster.show({ message: `Added ${added}. Mail from it belongs to this Application.` });
    } catch (err) {
      setError(message(err));
      fieldRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="contacts-h">
      <h2 id="contacts-h">Contacts</h2>
      {app.contacts.length ? (
        <>
          <p className="mini muted">Mail from these is matched here:</p>
          <ul className="facts-list">
            {app.contacts.map((c) => <li key={c.value}>{c.value} <span className="meta">{c.kind === "domain" ? "domain" : "address"}</span></li>)}
          </ul>
        </>
      ) : (
        <p className="mini muted">No contacts yet. Add the company's domain or a recruiter's address so their mail is matched here.</p>
      )}
      {adding ? (
        <form className="stack" onSubmit={save} noValidate>
          <div className="field">
            <label htmlFor={fieldId}>Email address or domain</label>
            <input
              className="input" id={fieldId} ref={fieldRef} value={value} onChange={(e) => setValue(e.target.value)}
              placeholder="mira@company.com or company.com" autoComplete="off" spellCheck={false}
              aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } }}
            />
            {error && <span className="err" id={errId} role="alert">{error}</span>}
          </div>
          <div className="row">
            <button className="btn primary sm" type="submit" disabled={busy}>Add</button>
            <button className="btn ghost sm" type="button" onClick={cancel}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn ghost sm add-contact" type="button" ref={addRef} onClick={() => setAdding(true)}>Add address</button>
      )}
    </section>
  );
}

function Loading() {
  return (
    <section className="stack app-page" style={{ gap: "var(--s-6)" }} aria-busy="true">
      <nav className="crumbs" aria-label="Breadcrumb"><a href="/applications">Applications</a><span aria-hidden="true">/</span><span>Loading…</span></nav>
      <div className="app-head" aria-hidden="true"><span className="skel w40 h-title" /><span className="skel w60" /><span className="skel w80 h-step" /></div>
      <p className="sr-only" role="status">Loading the application…</p>
      <div className="cols">
        <div className="col">
          <div className="panel" aria-hidden="true"><span className="skel w30" /><span className="skel w80" /><span className="skel w60" /></div>
          <div className="panel" aria-hidden="true"><span className="skel w20" /><span className="skel w90" /><span className="skel w90" /><span className="skel w80" /></div>
        </div>
        <div className="col"><div className="panel" aria-hidden="true"><span className="skel w40" /><span className="skel tall" /></div></div>
      </div>
    </section>
  );
}

function NotFound() {
  return (
    <section className="stack app-page" style={{ gap: "var(--s-6)" }}>
      <nav className="crumbs" aria-label="Breadcrumb"><a href="/applications">Applications</a><span aria-hidden="true">/</span><span aria-current="page">Not found</span></nav>
      <div className="empty solid">
        <h1>This application doesn't exist any more</h1>
        <p>It may have been removed when its adding was undone, or the link is from an old backup. Applications are never deleted by apply-kit itself.</p>
        <div className="row"><a className="btn primary" href="/applications">All applications</a></div>
      </div>
    </section>
  );
}
