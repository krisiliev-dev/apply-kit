// Interviews and the prep sheet on the Application page (hi-fi: application.html, states "Interview ·
// prep sheet" and "Thank-you due"). The Next step box holds the coming interview: its time in its own
// time zone, format, people, round and notes, "Read from the invite email" while the details are the
// invite's, Add to calendar (.ics) and Edit details. The Interviews panel lists every interview with
// Add interview. The prep sheet is built once through the assistant: company facts tagged with their
// source, likely questions per requirement with a true story from the Master profile or "No story yet"
// (never one written for you), practised marks, and Add a story (it goes to the Master profile as an
// unconfirmed piece).
import type { ApplicationDetail, FollowUp, Interview, InterviewFormat, InterviewInput, PrepQuestion, PrepSheet } from "@apply-kit/core";
import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { addPrepStory, buildPrepSheet, fetchPrepSheet, interviewIcsUrl, markPractised, saveInterview } from "../api.ts";
import type { Toaster } from "../feed/toast.tsx";
import { dueByWords, interviewWhen, longDay, sofiaClock, weekDay } from "./words.ts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);
const formatLabel: Record<InterviewFormat, string> = { video: "Video call", phone: "Phone call", onsite: "On site" };

/** Format, people, round, place and notes as a definition list. */
function Details({ i }: { i: Interview }) {
  const rows: [string, string][] = [];
  if (i.format || i.place) rows.push(["Format", [i.format && formatLabel[i.format], i.place].filter(Boolean).join(", ")]);
  if (i.people.length) rows.push(["With", i.people.join(" · ")]);
  if (i.round) rows.push(["Round", i.round]);
  if (i.timeZone !== "Europe/Sofia" && i.startAt) rows.push(["Your time", `${weekDay(new Date(i.startAt).toLocaleDateString("en-CA", { timeZone: "Europe/Sofia" }))}, ${sofiaClock(i.startAt)} Sofia time`]);
  if (i.notes) rows.push(["Notes", i.notes]);
  if (!rows.length) return null;
  return <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd lang={langOf(v)}>{v}</dd></Fragment>)}</dl>;
}

/** Where the details came from: the invite email (until you edit them), or you. */
function Source({ i }: { i: Interview }) {
  if (i.readFrom) return <p className="meta">Read from the invite email ("<span lang={langOf(i.readFrom.subject)}>{i.readFrom.subject}</span>"). Check it against the email itself, and edit anything that's off.</p>;
  return <p className="meta">{i.editedAt ? "Edited by you." : "Added by you."}</p>;
}

/** The coming interview, in the Next step box. */
export function InterviewNext({ app, interview, onEdit }: { app: ApplicationDetail; interview: Interview; onEdit: (i: Interview, opener: HTMLElement) => void }) {
  const thanks = app.thankYous.find((f) => f.interviewId === interview.id);
  return (
    <div className="panel next-step">
      <span className="kicker">Next step · interview</span>
      <h2 id="next-h" tabIndex={-1}>{interviewWhen(interview)}</h2>
      <Details i={interview} />
      <Source i={interview} />
      <div className="row">
        {interview.start && <a className="btn sm" href={interviewIcsUrl(interview.id)} download>Add to calendar (.ics)</a>}
        <button className="btn ghost sm" type="button" onClick={(e) => onEdit(interview, e.currentTarget)}>Edit details</button>
      </div>
      {thanks?.dueAt && interview.endAt && (
        <p className="mini muted">After it: a thank-you note is ready at {sofiaClock(interview.endAt)} and <b>{dueByWords(thanks.dueAt)}</b> Sofia time (within 24 hours of the start).</p>
      )}
    </div>
  );
}

/** The kicker of a thank-you note's Next step box. */
export function thankYouKicker(f: FollowUp): string {
  return `Thank-you note · ${f.dueAt ? dueByWords(f.dueAt) : `due ${weekDay(f.dueOn)}`} · 24 hours after the interview`;
}

/** Every interview of the Application, with Add interview. */
export function InterviewsPanel({ app, onEdit, onAdd }: {
  app: ApplicationDetail;
  onEdit: (i: Interview, opener: HTMLElement) => void;
  onAdd: (opener: HTMLElement) => void;
}) {
  const closed = app.status === "rejected" || app.status === "withdrawn";
  if (closed && !app.interviews.length) return null;
  return (
    <section className="panel" aria-labelledby="iv-h">
      <div className="sec-head">
        <h2 id="iv-h">Interviews</h2><span className="grow" />
        {!closed && <button className="btn sm" type="button" id="add-interview" onClick={(e) => onAdd(e.currentTarget)}>Add interview</button>}
      </div>
      {app.interviews.length ? (
        <ul className="iv-list">
          {app.interviews.map((i) => {
            const thanks = app.thankYous.find((f) => f.interviewId === i.id);
            const held = app.timeline.some((e) => e.id === `interview-held:${i.id}`);
            return (
              <li key={i.id}>
                <div className="stack tight">
                  <b>{interviewWhen(i)}</b>
                  <span className="meta">
                    {[i.round, i.format && formatLabel[i.format], i.people.join(", ")].filter(Boolean).join(" · ") || "No details yet"}
                    {held && thanks && ` · thank-you note ${thanks.state === "pending" ? (thanks.dueAt ? dueByWords(thanks.dueAt) : "due") : thanks.state === "sent" ? "sent" : "skipped"}`}
                    {i.readFrom ? " · read from the invite email" : ""}
                  </span>
                </div>
                <div className="row">
                  {i.start && <a className="btn ghost sm" href={interviewIcsUrl(i.id)} download>.ics<span className="sr-only">: {interviewWhen(i)}</span></a>}
                  <button className="btn ghost sm" type="button" onClick={(e) => onEdit(i, e.currentTarget)}>Edit<span className="sr-only">: {interviewWhen(i)}</span></button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted mini">An interview invitation matched from the job mailbox fills this in. Add one yourself for a call arranged by phone.</p>
      )}
    </section>
  );
}

const zones = [
  "Europe/Sofia", "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Berlin", "Europe/Paris", "Europe/Amsterdam", "Europe/Stockholm",
  "Europe/Warsaw", "Europe/Athens", "Europe/Istanbul", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Singapore", "UTC",
];
const zoneLabel = (z: string) => (z === "UTC" ? "UTC" : `${(z.split("/").at(-1) ?? z).replace(/_/g, " ")} (${z})`);

type Form = { day: string; from: string; to: string; timeZone: string; format: "" | InterviewFormat; place: string; people: string; round: string; notes: string };
const formOf = (i: Interview | null): Form => ({
  day: i?.start?.slice(0, 10) ?? "", from: i?.start?.slice(11, 16) ?? "", to: i?.end?.slice(11, 16) ?? "",
  timeZone: i?.timeZone ?? "Europe/Sofia", format: i?.format ?? "", place: i?.place ?? "", people: i?.people.join("\n") ?? "",
  round: i?.round ?? "", notes: i?.notes ?? "",
});

/** Add or edit an interview: a modal dialog; Esc or Cancel keeps things as they were; focus returns to the opener. */
export function InterviewDialog({ app, interview, onSaved, onClose }: {
  app: ApplicationDetail;
  /** null: a new one. */
  interview: Interview | null;
  onSaved: (i: Interview) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<Form>(() => formOf(interview));
  const [error, setError] = useState<{ field: keyof Form | null; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    document.getElementById(id("day"))?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = () => { ref.current?.close(); onClose(); };
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const fail = (field: keyof Form | null, text: string) => { setError({ field, text }); document.getElementById(id(field ?? "day"))?.focus(); };
    if ((f.from || f.to) && !f.day) return fail("day", "Enter the day, or clear the times.");
    if (f.day && !f.from) return fail("from", "Enter the time it starts.");
    const input: InterviewInput & { interviewId?: string } = {
      interviewId: interview?.id,
      start: f.day && f.from ? `${f.day}T${f.from}` : null, end: f.day && f.to ? `${f.day}T${f.to}` : null, timeZone: f.timeZone,
      format: f.format || null, place: f.place || null, people: f.people.split("\n").map((p) => p.trim()).filter(Boolean),
      round: f.round || null, notes: f.notes || null,
    };
    setBusy(true);
    try {
      const { interview: saved } = await saveInterview(app.id, input);
      ref.current?.close();
      onSaved(saved);
    } catch (err) {
      fail(null, message(err));
    } finally {
      setBusy(false);
    }
  }

  const errFor = (k: keyof Form | null) => (error && error.field === k ? <span className="err" id={id(`${k}-err`)} role="alert">{error.text}</span> : null);
  const described = (k: keyof Form, help?: string) => [help && id(`${k}-help`), error?.field === k && id(`${k}-err`)].filter(Boolean).join(" ") || undefined;
  const zoneList = zones.includes(f.timeZone) ? zones : [f.timeZone, ...zones];
  return (
    <dialog ref={ref} className="dlg" aria-labelledby={id("h")} onCancel={(e) => { e.preventDefault(); close(); }}>
      <form className="body" onSubmit={(e) => { submit(e).catch(() => {}); }} noValidate>
        <div className="dlg-head">
          <div className="stack tight">
            <span className="meta" lang={langOf(app.title)}>{app.title} · {app.company}</span>
            <h2 id={id("h")} tabIndex={-1}>{interview ? "Edit interview" : "Add interview"}</h2>
          </div>
          <button className="btn ghost sm x" type="button" aria-label="Close" onClick={close}>✕</button>
        </div>
        {interview?.readFrom && <p className="meta">Read from the invite email. Your edits replace what was read.</p>}
        <div className="iv-when">
          <div className="field">
            <label htmlFor={id("day")}>Day</label>
            <input className="input" id={id("day")} type="date" value={f.day} onChange={set("day")} aria-describedby={described("day", "help")} aria-invalid={error?.field === "day" || undefined} />
            <span className="help" id={id("day-help")}>{f.day ? longDay(f.day) : "Leave empty while no time is agreed."}</span>
            {errFor("day")}
          </div>
          <div className="field">
            <label htmlFor={id("from")}>Starts</label>
            <input className="input" id={id("from")} type="time" value={f.from} onChange={set("from")} aria-describedby={described("from")} aria-invalid={error?.field === "from" || undefined} />
            {errFor("from")}
          </div>
          <div className="field">
            <label htmlFor={id("to")}>Ends <span className="meta">(optional)</span></label>
            <input className="input" id={id("to")} type="time" value={f.to} onChange={set("to")} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={id("timeZone")}>Time zone of these times</label>
          <select className="input" id={id("timeZone")} value={f.timeZone} onChange={set("timeZone")} aria-describedby={id("timeZone-help")}>
            {zoneList.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
          </select>
          <span className="help" id={id("timeZone-help")}>As the invite states it. The calendar file keeps it, so your calendar shows your own time.</span>
        </div>
        <div className="iv-when">
          <div className="field">
            <label htmlFor={id("format")}>Format</label>
            <select className="input" id={id("format")} value={f.format} onChange={set("format")}>
              <option value="">Not stated</option>
              <option value="video">Video call</option>
              <option value="phone">Phone call</option>
              <option value="onsite">On site</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={id("place")}>Link, number or address <span className="meta">(optional)</span></label>
            <input className="input" id={id("place")} value={f.place} onChange={set("place")} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={id("people")}>With <span className="meta">(one person per line)</span></label>
          <textarea className="input" id={id("people")} value={f.people} onChange={set("people")} style={{ minHeight: "72px" }} lang={langOf(f.people)} />
        </div>
        <div className="field">
          <label htmlFor={id("round")}>Round <span className="meta">(optional)</span></label>
          <input className="input" id={id("round")} value={f.round} onChange={set("round")} placeholder="1 of 2: technical conversation" />
        </div>
        <div className="field">
          <label htmlFor={id("notes")}>Notes <span className="meta">(only you see these)</span></label>
          <textarea className="input" id={id("notes")} value={f.notes} onChange={set("notes")} style={{ minHeight: "72px" }} lang={langOf(f.notes)} />
        </div>
        {errFor(null)}
        <div className="dlg-foot">
          <span className="grow" />
          <button className="btn ghost" type="button" onClick={close}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}>{interview ? "Save interview" : "Add interview"}</button>
        </div>
      </form>
    </dialog>
  );
}

const tagWords = { posting: "[posting]", notes: "[your notes]", unverified: "[unverified]" } as const;

/** The prep sheet: build it once, then facts, likely questions with stories, practised marks and Add a story. */
export function PrepSheetPanel({ app, toaster }: { app: ApplicationDetail; toaster: Toaster }) {
  const [sheet, setSheet] = useState<PrepSheet | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchPrepSheet(app.id, ctrl.signal).then(setSheet).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, [app.id]);

  const closed = app.status === "rejected" || app.status === "withdrawn";
  if (sheet === undefined && !error) return null;
  if (!sheet && (closed || (!app.interviews.length && app.status !== "interviewing"))) return null;

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const built = await buildPrepSheet(app.id);
      setSheet(built);
      toaster.announce(`Prep sheet ready: ${built.questions.length} likely questions.`);
      requestAnimationFrame(() => document.getElementById("prep-h")?.focus());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function practise(q: PrepQuestion, on: boolean) {
    try {
      setSheet(await markPractised(app.id, q.id, on));
    } catch (err) {
      toaster.show({ message: `Couldn't save that: ${message(err)}` });
    }
  }

  if (!sheet) {
    return (
      <article className="panel prep" id="prep" aria-labelledby="prep-h">
        <div className="sec-head"><h2 id="prep-h" tabIndex={-1}>Prep sheet</h2><span className="meta">Light prep, not coaching</span></div>
        <p className="muted mini">Company facts from the posting and your notes, and likely questions mapped to the posting's requirements and to true stories from your Master profile. Built once for this Application, within your monthly AI budget.</p>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row"><button className="btn primary sm" type="button" onClick={() => { build().catch(() => {}); }} disabled={busy}>{busy ? "Building the prep sheet…" : "Build prep sheet"}</button></div>
      </article>
    );
  }

  const withStory = sheet.questions.filter((q) => q.story || q.yourStory).length;
  const toPrepare = sheet.questions.length - withStory;
  return (
    <article className="panel prep" id="prep" aria-labelledby="prep-h">
      <div className="sec-head"><h2 id="prep-h" tabIndex={-1}>Prep sheet</h2><span className="meta">Light prep, not coaching · from the posting, your notes and your Master profile</span></div>
      {sheet.facts.length > 0 && (
        <div className="stack tight">
          <span className="mini" style={{ fontWeight: 600 }}>Company facts</span>
          <ul className="facts-list">
            {sheet.facts.map((f) => <li key={f.text} lang={langOf(f.text)}>{f.text} <span className="tag">{tagWords[f.tag]}</span></li>)}
          </ul>
        </div>
      )}
      <div className="sec-head">
        <span className="mini" style={{ fontWeight: 600 }}>Likely questions · {sheet.questions.length}</span>
        {withStory > 0 && <span className="chip met">{withStory} {withStory === 1 ? "has" : "have"} a story</span>}
        {toPrepare > 0 && <span className="chip gap">{toPrepare} to prepare</span>}
      </div>
      <div className="table-wrap">
        <table className="table" aria-label="Likely questions with your stories">
          <thead><tr><th scope="col">Requirement</th><th scope="col">Likely question</th><th scope="col">Your story</th><th scope="col">Practised</th></tr></thead>
          <tbody>
            {sheet.questions.map((q) => (
              <tr key={q.id} className={q.story || q.yourStory ? undefined : "gap-row"}>
                <td lang={langOf(q.requirement)}>{q.requirement}</td>
                <td lang={langOf(q.question)} data-label="Likely question">"{q.question}"</td>
                <td data-label="Your story">
                  {q.story ? <>{q.story.text} <span className="tag">[profile{q.story.where ? ` · ${q.story.where}` : ""}]</span></>
                    : q.yourStory ? <>{q.yourStory.text} <span className="tag">[yours · unconfirmed in your Master profile]</span></>
                    : writing === q.id ? <StoryForm app={app} q={q} onDone={(s) => { if (s) setSheet(s); setWriting(null); }} toaster={toaster} />
                    : <>
                        <span className="chip gap">No story yet</span>
                        <div className="meta">Prepare one from real work, or say honestly how you'd approach it.</div>
                        <button className="btn ghost sm" type="button" id={`story-${q.id}`} onClick={() => setWriting(q.id)}>Add a story<span className="sr-only">: {q.question}</span></button>
                      </>}
                </td>
                <td data-label="Practised">
                  <label className="sr-only" htmlFor={`pr-${q.id}`}>Practised: {q.question}</label>
                  <input type="checkbox" id={`pr-${q.id}`} checked={q.practised} onChange={(e) => { practise(q, e.target.checked).catch(() => {}); }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta">When no true story exists, the sheet says so and never writes one for you. Stories you add here go into your Master profile as unconfirmed pieces, until you confirm them there.</p>
    </article>
  );
}

function StoryForm({ app, q, onDone, toaster }: { app: ApplicationDetail; q: PrepQuestion; onDone: (s: PrepSheet | null) => void; toaster: Toaster }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const uid = useId();
  useEffect(() => { ref.current?.focus(); }, []);
  const back = () => requestAnimationFrame(() => document.getElementById(`pr-${q.id}`)?.focus());
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) { setError("Write the story first: what happened, what you did, how it turned out."); ref.current?.focus(); return; }
    try {
      const s = await addPrepStory(app.id, q.id, text);
      onDone(s);
      toaster.announce("Story added. It waits in your Master profile as unconfirmed until you confirm it there.");
      back();
    } catch (err) {
      setError(message(err));
    }
  }
  return (
    <form className="stack tight" onSubmit={(e) => { save(e).catch(() => {}); }} noValidate>
      <label className="mini" htmlFor={`${uid}-t`} style={{ fontWeight: 600 }}>Your story, in your words</label>
      <textarea ref={ref} className="input" id={`${uid}-t`} value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: "88px" }}
        aria-describedby={error ? `${uid}-e` : undefined} aria-invalid={!!error || undefined} lang={langOf(text)} />
      {error && <span className="err" id={`${uid}-e`} role="alert">{error}</span>}
      <div className="row">
        <button className="btn sm" type="submit">Add to my profile</button>
        <button className="btn ghost sm" type="button" onClick={() => { onDone(null); requestAnimationFrame(() => document.getElementById(`story-${q.id}`)?.focus()); }}>Cancel</button>
      </div>
    </form>
  );
}
