// Step 5 of a package, the ATS check (ticket #67; hi-fi: docs/design/hifi/package.html, state
// "5 · ATS check"): the CV's PDF read back the way a parser reads it, in reading order with lost
// fields marked; pass or fail per check, no score; a fix that asks for the missing fact (and can
// save it to the master profile) and checks again; and, for a check Kris can't fix, approving
// knowing it fails. "Approve package" is in the action bar and moves focus to what blocks it.
import type { AtsStepView, PackageView } from "@apply-kit/core";
import { useState } from "react";
import { fixAts } from "../api.ts";
import { Icon } from "../icons.tsx";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The first thing "Approve package" moves focus to when a check fails: the fix's first field, else "approve knowing". */
export const atsBlockerId = (ats: AtsStepView | null) => (ats?.fixes.length ? "ats-fix-0" : "ats-accept");

export function AtsStep({ pkg, accept, onAccept, onChange, say }: {
  pkg: PackageView; accept: boolean; onAccept: (on: boolean) => void; onChange: (p: PackageView) => void; say: (m: string) => void;
}) {
  const ats = pkg.ats;
  if (!ats) {
    return (
      <div className="panel">
        <div className="step-title">
          <h2>ATS check</h2>
          <p className="muted">Reads the CV PDF the way an applicant tracking system does, once you approve the CV. Runs on this laptop, no model needed.</p>
        </div>
      </div>
    );
  }
  const failing = ats.checks.filter((c) => !c.passed);
  const open = failing.filter((c) => !ats.accepted.includes(c.check));
  const total = ats.checks.length;
  return (
    <div className="panel">
      <div className="sec-head">
        <div className="step-title grow">
          <h2>ATS check</h2>
          <p className="muted">Your CV PDF read back the way an applicant tracking system reads it: plain text, in reading order. Runs on this laptop.</p>
        </div>
        <span className={`chip ${failing.length ? "partly" : "met"}`}><Icon name={failing.length ? "partly" : "met"} />{ats.passing} of {total} pass</span>
      </div>
      <div className="two">
        <div className="stack">
          <h3>What the parser reads</h3>
          <pre className="parse" tabIndex={0} aria-label="Parsed text of the CV">
            {ats.lines.map((l, i) => (
              <span key={i}>{l.text}{l.lost && <> <span className="lost">{l.lost}</span></>}{"\n"}</span>
            ))}
            {ats.lost.map((l) => <span key={l}><span className="lost">{l}</span>{"\n"}</span>)}
          </pre>
        </div>
        <div className="stack">
          <h3>Checks</h3>
          <ul className="checks">
            {ats.checks.map((c) => (
              <li key={c.check}>
                <span className={`chip ${c.passed ? "met" : "gap"}`}><Icon name={c.passed ? "met" : "gap"} />{c.passed ? "Pass" : "Fail"}</span>
                <span>
                  {c.passed ? c.label : <b>{c.label}</b>}
                  {c.problems.length > 0 && <span className="meta block">{c.problems.join(". ")}</span>}
                  {c.notes.length > 0 && <span className="meta block">Deliberate: {c.notes.join("; ")}</span>}
                </span>
              </li>
            ))}
          </ul>
          {ats.fixes.map((f) => <Fix key={f.id} pkg={pkg} fix={f} onChange={onChange} say={say} />)}
          {open.length > 0 && (
            <label className="check">
              <input type="checkbox" id="ats-accept" checked={accept} onChange={(e) => onAccept(e.target.checked)} />
              {" "}Approve knowing {open.length === 1 ? "this check fails" : `these ${open.length} checks fail`}: a parser may drop what it can't read.
            </label>
          )}
          {ats.accepted.length > 0 && <p className="meta">Approved knowing these fail: {failing.filter((c) => ats.accepted.includes(c.check)).map((c) => c.label.toLowerCase()).join(", ")}.</p>}
        </div>
      </div>
    </div>
  );
}

/** A fix that asks for the facts the CV lacks; nothing is guessed. Ticked, they go into the master profile too. */
function Fix({ pkg, fix, onChange, say }: { pkg: PackageView; fix: AtsStepView["fixes"][number]; onChange: (p: PackageView) => void; say: (m: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [toProfile, setToProfile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    say("Re-checking the CV…");
    try {
      const r = await fixAts(pkg.id, { values, updateProfile: toProfile });
      onChange(r.package);
      if (!r.changed) { setError(r.reason); say(r.reason); return; }
      const ats = r.package.ats;
      say(`Checked again: ${ats ? `${ats.passing} of ${ats.checks.length} pass` : "done"}.${toProfile ? " Saved to your master profile." : ""}`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flag gap" role="group" aria-labelledby="ats-fix-h">
      <span className="kind"><Icon name="gap" />FIX</span>
      <h3 id="ats-fix-h">{fix.title}</h3>
      <p className="mini muted">{fix.detail}</p>
      <div className="selects">
        {fix.fields.map((f, i) => (
          <div className="field" key={f.field}>
            <label htmlFor={`ats-fix-${i}`}>{f.label}</label>
            <input
              className="input" id={`ats-fix-${i}`} value={values[f.field] ?? ""} autoComplete={f.field === "phone" ? "tel" : f.field === "city" ? "address-level2" : "country-name"}
              aria-invalid={error ? "true" : undefined} aria-describedby={error ? "ats-fix-error" : undefined}
              onChange={(e) => setValues({ ...values, [f.field]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={toProfile} onChange={(e) => setToProfile(e.target.checked)} /> Also update my master profile, so it doesn't come back</label>
      <div className="row"><button className="btn sm" type="button" disabled={busy} onClick={() => void apply()}>{busy ? "Re-checking…" : "Apply and re-check"}</button></div>
      {error && <p className="why-off" role="alert" id="ats-fix-error">{error}</p>}
      <p className="meta">The CV is printed again with it; the CV stays approved.</p>
    </div>
  );
}
