// Settings · Follow-ups: the delays follow-ups come due after (spec #24 "Follow-up rules"; defaults 7
// days for a nudge, 1 day for the note to self after an Offer, 3 days of snooze, 7 days for a check-in
// after the last interview; the thank-you note's 24 hours are fixed by decision). Pending follow-ups
// follow the new delays at once. Same form pattern as Dealbreakers and search.
import type { FollowUpSettings, HealthSummary } from "@apply-kit/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchFollowUpSettings, fetchSources, needsYouChanged, saveFollowUpSettings } from "../api.ts";
import { SettingsRail } from "./SettingsRail.tsx";

/** The defaults (core's defaultFollowUpSettings; the UI imports only types from core). */
const defaultFollowUpSettings: FollowUpSettings = { nudgeAfterDays: 7, offerNoteAfterDays: 1, snoozeDays: 3, checkInAfterDays: 7 };
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
type Draft = Record<keyof FollowUpSettings, string>;
const draftOf = (s: FollowUpSettings): Draft => ({
  nudgeAfterDays: String(s.nudgeAfterDays), offerNoteAfterDays: String(s.offerNoteAfterDays), snoozeDays: String(s.snoozeDays),
  checkInAfterDays: String(s.checkInAfterDays),
});

const fields: { key: keyof FollowUpSettings; label: string; help: string }[] = [
  { key: "nudgeAfterDays", label: "Follow-up after applying, in days", help: "With no reply, a follow-up comes due this many days after the date applied (and after moving to Screening). Only one per stage." },
  { key: "checkInAfterDays", label: "Check-in after the last interview, in days", help: "While Interviewing with no news, a polite check-in comes due this many days after your last interview ends. A thank-you note is always due within 24 hours of an interview's start." },
  { key: "offerNoteAfterDays", label: "Note to self after an offer, in days", help: "A short note on the deadline, one question and one action, so you decide deliberately." },
  { key: "snoozeDays", label: "Snooze, in days", help: "How far \"Snooze\" moves a follow-up from today." },
];

export function FollowUpSettingsPage({ onHealth }: { onHealth: (h: HealthSummary) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { document.title = "Follow-ups · Settings · apply-kit"; }, []);
  // The top bar shows source health on every screen.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchFollowUpSettings(ctrl.signal).then((s) => setDraft(draftOf(s)))
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setLoadError(message(err)); });
    return () => ctrl.abort();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const settings = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim() === "" ? NaN : Number(v)])) as unknown as FollowUpSettings;
    setSaving(true);
    try {
      const saved = await saveFollowUpSettings(settings);
      setDraft(draftOf(saved));
      setError(null);
      setStatus("Saved. Follow-ups still to come follow the new delays.");
      needsYouChanged();
    } catch (err) {
      setError(message(err));
      window.setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="set">
      <SettingsRail current="/settings/follow-ups" />
      <section className="stack" style={{ gap: "var(--s-7)" }}>
        <div className="page-head">
          <div className="lead">
            <h1>Follow-ups</h1>
            <p className="meta">When follow-ups come due on Applications. apply-kit never sends anything: you write and send each one from your own mail.</p>
          </div>
        </div>
        {loadError && (
          <div className="banner error" role="alert">
            <span className="text"><b>Couldn't reach the apply-kit service.</b> {loadError}. Check that it is running, then reload.</span>
          </div>
        )}
        {!draft && !loadError && <p className="meta" role="status">Loading…</p>}
        {draft && (
          <form className="settings-form" onSubmit={(e) => void submit(e)} noValidate>
            <fieldset>
              <legend>Delays</legend>
              {fields.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`fu-${f.key}`}>{f.label}</label>
                  <input
                    className="input" id={`fu-${f.key}`} type="number" min={1} max={60} step={1} inputMode="numeric" style={{ maxWidth: "12ch" }}
                    value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} aria-describedby={`fu-${f.key}-help`}
                  />
                  <span className="help" id={`fu-${f.key}-help`}>{f.help} Default: {defaultFollowUpSettings[f.key]}.</span>
                </div>
              ))}
              <p className="meta">A thank-you note after an interview is always due within 24 hours of its start; it isn't a setting.</p>
            </fieldset>
            {error && <p className="err" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
            <div className="row">
              <button className="btn primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
              <button className="btn ghost" type="button" onClick={() => { setDraft(draftOf(defaultFollowUpSettings)); setStatus("Defaults filled in. Save to use them."); }}>Use the defaults</button>
              <span className="meta" role="status" aria-live="polite">{status}</span>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
