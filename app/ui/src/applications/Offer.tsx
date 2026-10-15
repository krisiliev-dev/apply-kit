// An Application's offer and its close (hi-fi: application.html, states "Offer received", "Accepted ·
// withdraw others" and "Rejected"). At Offer the Next step box holds the note to self and the two
// decisions ("I accepted this offer…", "I declined it…"); Offer details are pre-filled from the offer
// email, editable, and the base salary is compared with the floor (Search settings). Accepted says how
// many withdrawals are left. A rejection shows its email, an optional one-line lesson and likely reason
// (nothing pre-selected) and what it changes in Stats; it is never a chore in Needs you.
import type { ApplicationDetail, OfferDetails, OfferView, RejectionReason, RejectionView } from "@apply-kit/core";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { saveOfferDetails, saveRejectionNote } from "../api.ts";
import type { Toaster } from "../feed/toast.tsx";
import { daysWord, longDay, shortDay, todaySofia, weekDay } from "./words.ts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);
const euros = (n: number) => `€${n.toLocaleString("en-GB")}`;
const dayOf = (iso: string) => weekDay(todaySofia(new Date(iso)));

/** The Next step box at Offer: the note to self (`note`, when due) and the two decisions. */
export function OfferNext({ app, note, onAccept, onDecline }: {
  app: ApplicationDetail;
  /** The note to self's writer, when it is due. */
  note: ReactNode;
  onAccept: (opener: HTMLElement) => void;
  onDecline: (opener: HTMLElement) => void;
}) {
  const f = app.followUp;
  return (
    <div className="panel next-step ask">
      <span className="kicker">Offer · {dayOf(app.statusSince)}</span>
      <h2 id="next-h" tabIndex={-1}>Decide when you're ready. apply-kit records it; you reply to them.</h2>
      {note}
      {!note && f?.kind === "offer-note" && f.state === "pending" && (
        <p className="muted mini">Note to self due {weekDay(f.dueOn)}: the deadline, one question to answer, one action.</p>
      )}
      <div className="offer-acts">
        <button className="btn primary" type="button" onClick={(e) => onAccept(e.currentTarget)}>I accepted this offer…</button>
        <button className="btn" type="button" onClick={(e) => onDecline(e.currentTarget)}>I declined it…</button>
      </div>
      <p className="meta">
        Accepting moves this to Accepted and then offers polite withdrawal drafts for your other open Applications. Declining moves it to Withdrawn (reason: declined offer).
      </p>
    </div>
  );
}

/** The Next step box once accepted: how many withdrawals are left, and the dialog to send them. */
export function AcceptedNext({ app, withdrawals, onOpen }: { app: ApplicationDetail; withdrawals: number; onOpen: (opener: HTMLElement) => void }) {
  const start = app.offer?.details.startDate;
  return (
    <div className={`panel next-step${withdrawals ? " ask" : ""}`}>
      <span className="kicker">Accepted · {dayOf(app.statusSince)}{start && ` · starts ${weekDay(start)}`}</span>
      <h2 id="next-h" tabIndex={-1}>
        {withdrawals ? `${withdrawals === 1 ? "One withdrawal" : `${withdrawals} withdrawals`} to send to your other applications.` : "Congratulations. Nothing left to withdraw."}
      </h2>
      <p className="muted mini">
        {withdrawals
          ? "Each one moves to Withdrawn only when you mark its note sent. Keep any open you like."
          : "Your other Applications are withdrawn or kept open. Everything stays here for your records."}
      </p>
      {withdrawals > 0 && (
        <div className="row"><button className="btn primary" type="button" onClick={(e) => onOpen(e.currentTarget)}>Withdraw from the others…</button></div>
      )}
    </div>
  );
}

function floorWords(offer: OfferView): string | null {
  const f = offer.floor;
  if (!f) return null;
  const floor = `Your floor is ${euros(f.floorEur)} a month (Search settings).`;
  if (f.verdict === "unknown") {
    return offer.details.baseSalary
      ? `${floor} Write the salary with its currency and period, like "€3,100 gross / month", to compare.`
      : floor;
  }
  // Said per month in euros when it was written another way (leva, or a year).
  const written = offer.details.baseSalary ?? "";
  const plain = /€|eur/i.test(written) && !/year|annual|годишн/i.test(written);
  const per = f.monthlyEur !== null && !plain ? ` (${euros(f.monthlyEur)} a month)` : "";
  return `${floor} This is ${f.verdict === "at" ? "at" : f.verdict} it${per}.`;
}

const fields: { key: keyof OfferDetails; label: string; type?: "date" }[] = [
  { key: "baseSalary", label: "Base salary" },
  { key: "startDate", label: "Start date", type: "date" },
  { key: "workPattern", label: "Work pattern" },
  { key: "contract", label: "Contract" },
  { key: "other", label: "Other" },
];

/** Offer details: pre-filled from the offer email, checked and saved by the user, the salary against the floor. */
export function OfferDetailsPanel({ app, offer, refresh, toaster }: {
  app: ApplicationDetail; offer: OfferView; refresh: () => Promise<ApplicationDetail>; toaster: Toaster;
}) {
  const [values, setValues] = useState<OfferDetails>(offer.details);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const floor = floorWords(offer);
  const changed = fields.some((f) => (values[f.key] ?? "") !== (offer.details[f.key] ?? ""));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { offer: saved } = await saveOfferDetails(app.id, values);
      setValues(saved.details);
      await refresh();
      toaster.show({ message: `Offer details saved.${saved.floor && saved.floor.verdict !== "unknown" ? ` The base salary is ${saved.floor.verdict} your floor.` : ""}` });
    } catch (err) {
      setError(message(err));
      firstRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const from = offer.from === "email" ? "Pre-filled from the offer email · check against the written offer"
    : offer.from === "you" ? "Saved by you" : "From the written offer";
  return (
    <section className="panel" aria-labelledby={`${uid}-h`}>
      <div className="sec-head"><h2 id={`${uid}-h`}>Offer details</h2><span className="meta">{from}</span></div>
      {offer.email && (
        <p className="meta">
          From {offer.email.from}, {dayOf(offer.email.receivedAt)}
          {offer.email.attachments.length > 0 && ` · ${offer.email.attachments.map((a) => a.name).join(", ")} kept in the job mailbox`}
        </p>
      )}
      <form className="stack" onSubmit={save} noValidate>
        <div className="field-row">
          {fields.map((f, i) => (
            <div className="field" key={f.key}>
              <label htmlFor={`${uid}-${f.key}`}>{f.label}</label>
              <input
                className="input" id={`${uid}-${f.key}`} ref={i === 0 ? firstRef : undefined} type={f.type ?? "text"}
                value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                lang={langOf(values[f.key] ?? "")}
                aria-describedby={f.key === "baseSalary" && floor ? `${uid}-floor` : f.key === "startDate" && values.startDate ? `${uid}-start` : undefined}
              />
              {f.key === "baseSalary" && floor && <span className="help" id={`${uid}-floor`}>{floor}</span>}
              {f.key === "startDate" && values.startDate && <span className="help" id={`${uid}-start`}>{longDay(values.startDate)}</span>}
            </div>
          ))}
        </div>
        {error && <span className="err" role="alert">{error}</span>}
        <div className="row"><button className="btn sm" type="submit" disabled={busy || !changed}>Save details</button></div>
      </form>
    </section>
  );
}

/** "Comparing and negotiating offers isn't part of this version." */
export function OfferNonGoal() {
  return (
    <div className="banner info">
      <span className="text"><b>Comparing and negotiating offers isn't part of this version.</b> apply-kit records the offer so nothing is lost; weighing it is up to you.</span>
    </div>
  );
}

/** A rejection: its email, an optional one-line lesson and likely reason (nothing pre-selected), and Undo. */
export function RejectionPanel({ app, rejection, refresh, toaster, onUndo }: {
  app: ApplicationDetail; rejection: RejectionView; refresh: () => Promise<ApplicationDetail>; toaster: Toaster;
  /** "Not a rejection? Undo": the move to Rejected, while it can be undone. */
  onUndo: (() => void) | null;
}) {
  const [lesson, setLesson] = useState(rejection.lesson ?? "");
  const [reason, setReason] = useState<RejectionReason | null>(rejection.reason);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const lessonRef = useRef<HTMLInputElement>(null);
  const e = rejection.email;
  const closed = app.timeline.find((t) => t.to === "rejected" && !t.undoneAt);
  const how = e ? "" : " · set by you";
  const changed = (lesson.trim() || null) !== rejection.lesson || reason !== rejection.reason;

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { rejection: saved } = await saveRejectionNote(app.id, { lesson: lesson.trim() || null, reason });
      setLesson(saved.lesson ?? "");
      await refresh();
      toaster.show({ message: saved.lesson || saved.reason ? "Saved. It counts in What's working as a reply." : "Saved, with no lesson or reason. That's fine." });
    } catch (err) {
      setError(message(err));
      lessonRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby={`${uid}-h`}>
      <div className="sec-head"><h2 id={`${uid}-h`}>Rejected {closed ? relative(closed.at) : ""}{how}</h2></div>
      {e && (
        <div className="quote">
          <span className="where">{e.from} · {dayOf(e.receivedAt)}</span>
          <span lang={e.language && e.language !== "en" ? e.language : langOf(e.quote)}>"{e.quote}"</span>
          {e.summary && <span className="tr">In English: {e.summary}</span>}
        </div>
      )}
      <form className="stack" style={{ gap: "var(--s-4)" }} onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor={`${uid}-lesson`}>One-line lesson <span className="meta">(optional)</span></label>
          <span className="help" id={`${uid}-lesson-help`}>Specific to this one. Lines like "tailor your CV" don't count.</span>
          <input
            className="input" id={`${uid}-lesson`} ref={lessonRef} value={lesson} onChange={(ev) => setLesson(ev.target.value)}
            placeholder="e.g. They wanted a shipped design system, not components"
            aria-invalid={error ? true : undefined} aria-describedby={`${uid}-lesson-help${error ? ` ${uid}-err` : ""}`}
          />
          {error && <span className="err" id={`${uid}-err`} role="alert">{error}</span>}
        </div>
        <fieldset aria-describedby={`${uid}-why-help`}>
          <legend>Likely reason <span className="meta">(optional, a guess for form letters)</span></legend>
          <div className="chips">
            {rejection.reasons.map((r) => (
              <label className="check" key={r.key}>
                <input type="radio" name={`${uid}-why`} checked={reason === r.key} onChange={() => setReason(r.key)} /> {r.label}
              </label>
            ))}
          </div>
          <span className="help" id={`${uid}-why-help`}>Nothing is pre-selected.</span>
          {reason && <div className="row"><button className="btn ghost sm" type="button" onClick={() => setReason(null)}>Clear the reason</button></div>}
        </fieldset>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !changed}>Save</button>
          {onUndo && <button className="btn ghost" type="button" onClick={onUndo}>Not a rejection? Undo</button>}
        </div>
      </form>
    </section>
  );
}

/** "What this changes in Stats": a rejection is a reply, so the response rate goes up, not down. */
export function RejectionStats({ app, rejection }: { app: ApplicationDetail; rejection: RejectionView }) {
  const s = rejection.stats;
  const uid = useId();
  return (
    <section className="panel" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>What this changes in Stats</h2>
      <dl className="kv">
        <dt>Response rate</dt>
        <dd>
          {s.counts
            ? `Up, not down: a rejection is a reply. Now ${s.replied} of ${s.counted}.`
            : `A rejection is a reply. It counts from ${shortDay(s.countsFrom!)}, once it's 14 days old (now ${s.replied} of ${s.counted}).`}
        </dd>
        {s.angle && app.angle && (
          <>
            <dt>{s.angle.name} angle</dt>
            <dd>{s.angle.replied} of {s.angle.sent} replied.{s.angle.tooFew ? " Too few to tell yet." : ""}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

/** "yesterday", "today", or "Mon 12 Oct". */
function relative(iso: string): string {
  const day = todaySofia(new Date(iso));
  const today = todaySofia();
  if (day === today) return "today";
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  return d === 1 ? "yesterday" : d < 7 ? `${daysWord(d)} ago` : weekDay(day);
}
