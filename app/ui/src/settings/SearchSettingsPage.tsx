import type { HealthSummary, RuleChange, SearchSettings } from "@apply-kit/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchFeed, fetchRuleChanges, fetchSearchSettings, saveSearchSettings, undoRuleChange } from "../api.ts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** "German, French" ↔ ["German", "French"]. */
const listText = (xs: string[]) => xs.join(", ");
const listOf = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);

interface Draft {
  minSalary: string;
  cities: string;
  remoteInEurope: boolean;
  relocation: string;
  languagesNotSpoken: string;
  maxYears: string;
  salaryBelowMinimum: boolean;
  outsideLocations: boolean;
}

const draftOf = (s: SearchSettings): Draft => ({
  minSalary: String(s.minMonthlySalaryEur),
  cities: listText(s.locations.cities),
  remoteInEurope: s.locations.remoteInEurope,
  relocation: listText(s.locations.relocation),
  languagesNotSpoken: listText(s.dealbreakers.languagesNotSpoken),
  maxYears: s.dealbreakers.maxYearsRequired == null ? "" : String(s.dealbreakers.maxYearsRequired),
  salaryBelowMinimum: s.dealbreakers.salaryBelowMinimum,
  outsideLocations: s.dealbreakers.outsideLocations,
});

/**
 * Dealbreakers & search: the minimal search-settings form (until onboarding builds the full
 * profile) and every rule changed from the Feed with "Not a dealbreaker for me", undoable.
 */
export function SearchSettingsPage({ onHealth }: { onHealth: (h: HealthSummary) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [changes, setChanges] = useState<RuleChange[]>([]);
  const [hidden, setHidden] = useState<number | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const refreshFeedCounts = () => {
    fetchFeed("new", { sort: "fit", relocation: false })
      .then((f) => { setHidden(f.counts.hidden); onHealth(f.health); })
      .catch(() => {});
  };

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([fetchSearchSettings(ctrl.signal), fetchRuleChanges(ctrl.signal)])
      .then(([s, c]) => { setDraft(draftOf(s)); setChanges(c); })
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setLoadError(message(err)); });
    fetchFeed("new", { sort: "fit", relocation: false }, ctrl.signal)
      .then((f) => { setHidden(f.counts.hidden); onHealth(f.health); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);

  if (loadError) {
    return <div className="banner error" role="alert"><span className="text"><b>Couldn't load your search settings.</b> {loadError}</span></div>;
  }
  if (!draft) return <p className="meta" role="status">Loading your search settings…</p>;

  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setStatus(""); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (draft.minSalary.trim() === "") {
      setError("Enter your minimum monthly salary in euros (0 if you have none).");
      window.setTimeout(() => errorRef.current?.focus(), 0);
      return;
    }
    const min = Number(draft.minSalary);
    const years = draft.maxYears.trim() === "" ? null : Number(draft.maxYears);
    if (Number.isNaN(min) || (years !== null && Number.isNaN(years))) {
      setError("Salary and years must be numbers.");
      window.setTimeout(() => errorRef.current?.focus(), 0);
      return;
    }
    const settings: SearchSettings = {
      minMonthlySalaryEur: min,
      locations: { cities: listOf(draft.cities), remoteInEurope: draft.remoteInEurope, relocation: listOf(draft.relocation) },
      dealbreakers: {
        languagesNotSpoken: listOf(draft.languagesNotSpoken),
        maxYearsRequired: years,
        salaryBelowMinimum: draft.salaryBelowMinimum,
        outsideLocations: draft.outsideLocations,
      },
    };
    setSaving(true);
    try {
      const saved = await saveSearchSettings(settings);
      setDraft(draftOf(saved));
      setError(null);
      setStatus("Saved. The Feed and the hidden pile follow your new settings.");
      refreshFeedCounts();
    } catch (err) {
      setError(message(err));
      window.setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setSaving(false);
    }
  }

  async function undo(change: RuleChange) {
    try {
      const { settings } = await undoRuleChange(change.id);
      setDraft(draftOf(settings));
      setChanges(await fetchRuleChanges());
      setStatus(`Put back: ${change.text}.`);
      refreshFeedCounts();
    } catch (err) {
      setStatus(`Couldn't put the rule back: ${message(err)}`);
    }
  }

  return (
    <section className="stack" style={{ gap: "var(--s-7)" }}>
      <div className="page-head">
        <div className="lead">
          <h1>Dealbreakers and search</h1>
          <p className="meta">What the Feed ranks by and what it hides. Hidden jobs always keep their reason and are never deleted.</p>
        </div>
        <span className="grow" />
        {hidden != null && <a className="btn sm" href="/?view=hidden">See the {hidden} hidden {hidden === 1 ? "job" : "jobs"}</a>}
      </div>

      <form className="settings-form" onSubmit={(e) => void submit(e)} noValidate>
        <fieldset>
          <legend>Where</legend>
          <div className="field">
            <label htmlFor="ss-cities">Cities, ranked first</label>
            <input className="input" id="ss-cities" value={draft.cities} onChange={(e) => set({ cities: e.target.value })} autoComplete="off" aria-describedby="ss-cities-help" />
            <span className="help" id="ss-cities-help">On-site or hybrid. Separate several with commas. Cyrillic names are matched too.</span>
          </div>
          <label className="check">
            <input type="checkbox" checked={draft.remoteInEurope} onChange={(e) => set({ remoteInEurope: e.target.checked })} />
            <span>Remote within European time zones, ranked equally first</span>
          </label>
          <div className="field">
            <label htmlFor="ss-relocation">Countries you'd relocate to</label>
            <input className="input" id="ss-relocation" value={draft.relocation} onChange={(e) => set({ relocation: e.target.value })} autoComplete="off" aria-describedby="ss-relocation-help" />
            <span className="help" id="ss-relocation-help">A separate, lower-priority list, shown with the Relocation filter.</span>
          </div>
        </fieldset>

        <fieldset>
          <legend>Salary</legend>
          <div className="field">
            <label htmlFor="ss-salary">Your minimum, € gross a month</label>
            <input className="input" id="ss-salary" type="number" min={0} step={100} inputMode="numeric" value={draft.minSalary} onChange={(e) => set({ minSalary: e.target.value })} style={{ maxWidth: "12ch" }} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Dealbreakers</legend>
          <p className="meta">Only requirements a posting clearly states as required count. Preferred ones, and anything still waiting for you to confirm, never hide a job.</p>
          <div className="field">
            <label htmlFor="ss-languages">Languages you don't speak</label>
            <input className="input" id="ss-languages" value={draft.languagesNotSpoken} onChange={(e) => set({ languagesNotSpoken: e.target.value })} autoComplete="off" placeholder="e.g. German, French" aria-describedby="ss-languages-help" />
            <span className="help" id="ss-languages-help">A job that requires one of these is hidden. Separate several with commas.</span>
          </div>
          <div className="field">
            <label htmlFor="ss-years">Most years of experience you'll accept being asked for</label>
            <input className="input" id="ss-years" type="number" min={0} step={1} inputMode="numeric" value={draft.maxYears} onChange={(e) => set({ maxYears: e.target.value })} style={{ maxWidth: "12ch" }} aria-describedby="ss-years-help" />
            <span className="help" id="ss-years-help">A job asking for more is hidden. Leave empty to turn this rule off.</span>
          </div>
          <label className="check">
            <input type="checkbox" checked={draft.salaryBelowMinimum} onChange={(e) => set({ salaryBelowMinimum: e.target.checked })} />
            <span>Hide jobs whose stated salary is below your minimum<span className="help"> · jobs without a salary, or with a net one, stay visible</span></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.outsideLocations} onChange={(e) => set({ outsideLocations: e.target.checked })} />
            <span>Hide jobs outside your locations<span className="help"> · relocation jobs and places the posting doesn't make clear stay visible</span></span>
          </label>
        </fieldset>

        {error && <p className="err" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        <div className="row">
          <button className="btn primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
          <span className="meta" role="status" aria-live="polite">{status}</span>
        </div>
      </form>

      <section className="stack" style={{ gap: "var(--s-4)" }} aria-labelledby="rule-changes-h">
        <h2 id="rule-changes-h">Rules changed from the Feed</h2>
        {changes.length === 0
          ? <p className="meta">None yet. When you mark a hidden reason "Not a dealbreaker for me", the change is listed here so you can undo it.</p>
          : (
            <ul className="rule-changes">
              {changes.map((c) => (
                <li key={c.id}>
                  <span>
                    <b>{c.text}</b>
                    <span className="meta"> · from {c.job.title} at {c.job.company} ({c.reason}) · {new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                  </span>
                  {c.undoneAt
                    ? <span className="chip closed">Undone</span>
                    : <button className="btn sm" type="button" onClick={() => void undo(c)}>Undo<span className="sr-only">: {c.text}</span></button>}
                </li>
              ))}
            </ul>
          )}
      </section>
    </section>
  );
}
