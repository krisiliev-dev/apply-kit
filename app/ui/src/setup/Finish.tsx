// The rest of Setup (hi-fi: onboarding.html): "Your search" (the search settings, filled from the profile), "Done" (the summary and the
// "keeps learning" note), and "Welcome back" for Kris returning mid-setup, with "Skip setup".
import type { SearchSettings, SearchSuggestion, SetupStep, SetupSummary } from "@apply-kit/core";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { fetchSearchSuggestion, fetchSetupSummary, saveSearchSettings, setSetupStep, skipSetup } from "../api.ts";
import { angleLabel } from "../profile/common.tsx";
import { message, plural, stepPath, Steps, useNavLink, useSetup, whenLabel } from "./common.tsx";

const months = (n: number) => {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [y > 0 && plural(y, "year", "years"), m > 0 && plural(m, "month", "months")].filter(Boolean).join(" ") || "less than a month";
};
const euros = (n: number) => `€${n.toLocaleString("en-GB")}`;
const list = (xs: string[]) => (xs.length > 0 ? xs.join(", ") : "None");

export function YourSearch({ imported }: { imported: number | null }) {
  const { go, refresh, announce } = useSetup();
  const nav = useNavLink();
  const [suggestion, setSuggestion] = useState<SearchSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSearchSuggestion(ctrl.signal).then(setSuggestion).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, []);

  const finish = async () => {
    if (!suggestion) return;
    setBusy(true);
    setError(null);
    try {
      // The filled-in settings become Kris's own; ones she saved before stay as they are.
      if (!suggestion.saved) await saveSearchSettings(suggestion.settings);
      await setSetupStep("done");
      refresh();
      announce("Setup finished.");
      go(stepPath.done);
    } catch (err) {
      setError(message(err));
      setBusy(false);
      window.setTimeout(() => errorRef.current?.focus(), 0);
    }
  };

  return (
    <div className="stack">
      <Steps current="search" imported={imported} />
      <div className="head">
        <h1 id="setup-h" tabIndex={-1}>What should the Feed show you?</h1>
        <p className="muted">The same settings as Profile › Search and dealbreakers{suggestion?.saved ? ", as you saved them" : ", already filled in from your profile"}. Jobs outside them are hidden with a reason, never dropped.</p>
      </div>
      {error && <div className="banner error" role="alert" tabIndex={-1} ref={errorRef}><span className="text"><b>That didn't work.</b> {error}</span></div>}
      {!suggestion ? (!error && <p className="meta" role="status">Loading…</p>) : (
        <>
          <div className="panel">
            <SettingsList settings={suggestion.settings} experience={suggestion.experience} />
            <div className="row"><a className="btn" href="/profile/search">Change any of these</a></div>
          </div>
          <div className="row">
            <button className="btn primary" type="button" disabled={busy} onClick={finish}>{busy ? "Saving…" : "Save and finish"}</button>
            <a className="btn ghost" href={stepPath.interview} onClick={nav}>Back</a>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsList({ settings: s, experience }: { settings: SearchSettings; experience: SearchSuggestion["experience"] }) {
  const d = s.dealbreakers;
  const where = [s.locations.cities.length > 0 && `${s.locations.cities.join(", ")} (on-site or hybrid)`, s.locations.remoteInEurope && "remote within ±2 h of Sofia"]
    .filter(Boolean).join(" and ");
  return (
    <dl className="kv">
      <dt>Where</dt>
      <dd>{where ? `${where}${s.locations.cities.length > 0 && s.locations.remoteInEurope ? ", ranked equally" : ""}` : "Anywhere"}{d.outsideLocations ? "" : " · jobs elsewhere aren't hidden"}</dd>
      <dt>Relocation</dt>
      <dd>{s.locations.relocation.length > 0 ? `${s.locations.relocation.join(", ")} · ranked after the places above` : "None"}</dd>
      <dt>Languages you don't speak</dt>
      <dd>{list(d.languagesNotSpoken)}{d.languagesNotSpoken.length > 0 ? " · jobs requiring one are hidden" : ""}</dd>
      <dt>Years asked</dt>
      <dd>
        {d.maxYearsRequired == null ? "No limit" : `Hide jobs asking for more than ${d.maxYearsRequired}`}
        {experience && <span className="meta"> · your profile shows {months(experience.months)}{experience.angle ? ` (mostly ${angleLabel[experience.angle].toLowerCase()})` : " of work"}</span>}
      </dd>
      <dt>Minimum salary</dt>
      <dd>{euros(s.minMonthlySalaryEur)} gross a month{d.salaryBelowMinimum ? " · jobs without a salary stay visible" : " · not used to hide jobs"}</dd>
    </dl>
  );
}

export function Done() {
  const nav = useNavLink();
  const [summary, setSummary] = useState<SetupSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchSetupSummary(ctrl.signal).then(setSummary).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, []);
  const p = summary?.pieces;
  return (
    <div className="stack">
      <div className="head">
        <h1 id="setup-h" tabIndex={-1}>Your master profile is ready</h1>
        <p className="muted">Packages can now be tailored from it.</p>
      </div>
      {error && <div className="banner error" role="alert"><span className="text"><b>Couldn't load the summary.</b> {error}</span></div>}
      {summary && p && (
        <>
          <div className="tally">
            <div className="panel">
              <span className="meta">Pieces</span><span className="big">{p.pieces}</span>
              <span className="mini">{p.confirmed} confirmed{p.toCheck > 0 && <> · <a href={stepPath.review} onClick={nav}>{plural(p.toCheck, "needs", "need")} your OK</a></>}</span>
            </div>
            <div className="panel">
              <span className="meta">Angles</span><span className="big">{summary.angles.count}</span>
              <span className="mini">{summary.angles.thinnest ? <><a href="/profile/angles">{summary.angles.thinnest}</a> is the thinnest</> : "Developer, security and design"}</span>
            </div>
            <div className="panel">
              <span className="meta">Answer bank</span><span className="big">{summary.answerBank}</span>
              <span className="mini">Standard answers for application forms · <a href="/profile/answers">check them</a></span>
            </div>
            <div className="panel">
              <span className="meta">Voice</span><span className="big">{summary.voice.samples}</span>
              <span className="mini">
                {summary.voice.samples === 1 ? "voice sample" : "voice samples"}
                {summary.voice.rules > 0 ? `, ${plural(summary.voice.rules, "rule", "rules")} learned` : ""} · <a href="/profile/voice">{summary.voice.samples > 0 ? "add more" : "add some"}</a>
              </span>
            </div>
          </div>
          <div className="panel learning">
            <h2>It keeps learning</h2>
            <p className="muted mini">When a package needs something your profile doesn't have, you get one short question inside that package. Your answer is used for that job and saved to Profile as an unconfirmed piece, so you decide whether it stays.</p>
          </div>
          <div className="row">
            <a className="btn primary" href="/">Open your Feed</a>
            {p.toCheck > 0 && <a className="btn" href={stepPath.review} onClick={nav}>Review {plural(p.toCheck, "piece", "pieces")} first</a>}
          </div>
        </>
      )}
      {!summary && !error && <p className="meta" role="status">Loading…</p>}
    </div>
  );
}

const stoppedWhile: Record<Exclude<SetupStep, "import" | "done">, [string, string]> = {
  review: ["checking pieces", "Continue checking"],
  interview: ["at the interview", "Continue to the interview"],
  search: ["checking your search", "Continue with your search"],
};

/** Welcome back: Kris left mid-setup; she lands where she stopped, with nothing lost. */
export function Returning({ step }: { step: Exclude<SetupStep, "import" | "done"> }) {
  const { progress } = useSetup();
  const nav = useNavLink();
  const c = progress?.counts;
  const [doing, cont] = stoppedWhile[step];
  return (
    <div className="empty">
      <h1 id="setup-h" tabIndex={-1}>Welcome back</h1>
      <p>
        You stopped while {doing}{progress?.updatedAt ? ` ${whenLabel(progress.updatedAt)}` : ""}.
        {c && c.pieces > 0 ? ` ${c.confirmed} of ${c.pieces} pieces are confirmed; nothing was lost.` : " Nothing was lost."}
      </p>
      <div className="row">
        <a className="btn primary" href={stepPath[step]} onClick={nav}>{cont}</a>
        {step === "review" && <a className="btn" href={stepPath.interview} onClick={nav}>Go straight to the interview</a>}
      </div>
      <SkipSetup />
    </div>
  );
}

/** "Skip setup": a quick start to the Feed; Setup keeps its place to come back to. */
export function SkipSetup() {
  const [error, setError] = useState<string | null>(null);
  const skip = async (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    try {
      await skipSetup();
      window.location.assign("/");
    } catch (err) {
      setError(message(err));
    }
  };
  return (
    <>
      <p className="meta">Want to apply today instead? <a href="/" onClick={skip}>Skip setup</a>: your profile has enough for a first package, and the coach asks the rest as you go. Setup keeps your place.</p>
      {error && <p className="err-line" role="alert">{error}</p>}
    </>
  );
}
