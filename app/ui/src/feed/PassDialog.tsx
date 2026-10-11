import type { FeedJob, PassInput, PassReason } from "@apply-kit/core";
import { useEffect, useRef, useState } from "react";

export const reasonLabels: Record<PassReason, string> = {
  "skills-gap": "Skills gap too big",
  salary: "Salary too low",
  location: "Location or remote rules",
  company: "Not interested in this company",
  other: "Other",
};

const NOT_STATED = "Location not stated";
const unique = (xs: string[]) => [...new Set(xs)];

/**
 * What "rank lower" would learn from this reason, as the checkbox says it, or null when nothing
 * can be learned (Other, a place no posting states, a skills gap on several jobs at once).
 * Mirrors the engine's rules (PassInput.learn).
 */
function lesson(reason: PassReason | null, jobs: FeedJob[]): { label: string; requirements?: string[] } | null {
  if (!reason || jobs.length === 0) return null;
  switch (reason) {
    case "company":
    case "salary": {
      const companies = unique(jobs.map((j) => j.company));
      return { label: companies.length === 1 ? `Rank jobs at ${companies[0]} lower from now on` : "Rank jobs at these companies lower from now on" };
    }
    case "location": {
      const places = unique(jobs.map((j) => j.fit.place.label).filter((p) => p !== NOT_STATED));
      if (places.length === 0) return null;
      return { label: places.length === 1 ? `Rank jobs in ${places[0]} lower from now on` : "Rank jobs at these places lower from now on" };
    }
    case "skills-gap": {
      if (jobs.length !== 1) return null;
      const required = unique(jobs[0]!.requirements.filter((r) => r.kind === "required").map((r) => r.text));
      return required.length === 0 ? null : { label: "Rank jobs that require this lower from now on", requirements: required };
    }
    case "other":
      return null;
  }
}

/**
 * "Pass with reason" from the Job hi-fi, as a modal over the Feed. No reason is selected when it
 * opens, and none is needed: Enter passes straight away. Esc cancels and focus goes back where it was.
 * The ranking learns from a pass only when Kris ticks "rank lower", which is off every time it opens.
 */
export function PassDialog({ what, jobs, onPass, onCancel }: {
  /** "Associate Product Manager at Payhawk", or "3 jobs". */
  what: string;
  /** The jobs being passed, for what "rank lower" would learn. */
  jobs: FeedJob[];
  onPass: (input: PassInput) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<PassReason | null>(null);
  const [note, setNote] = useState("");
  const [learn, setLearn] = useState(false);
  const [requirement, setRequirement] = useState("");
  const learnable = lesson(reason, jobs);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const choose = (r: PassReason) => {
    setReason(r);
    // A new reason means a new question: the box starts unticked again.
    setLearn(false);
    setRequirement(lesson(r, jobs)?.requirements?.[0] ?? "");
  };

  // Close the modal before handing back, so the page is no longer inert and focus can move.
  const done = (fn: () => void) => { ref.current?.close(); fn(); };
  const input = (): PassInput => ({
    reason,
    note: note.trim() || null,
    ...(learn && learnable && { learn: true, ...(learnable.requirements && { requirement }) }),
  });

  return (
    <dialog ref={ref} className="pass-dialog" aria-labelledby="pass-h" aria-describedby="pass-desc" onCancel={(e) => { e.preventDefault(); done(onCancel); }}>
      <form
        className="stack"
        onSubmit={(e) => { e.preventDefault(); done(() => onPass(input())); }}
        // Enter on a reason passes too, so X then Enter is a quick pass.
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type === "radio") {
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }
        }}
      >
        <div className="stack" style={{ gap: "var(--s-2)" }}>
          <h2 id="pass-h">Pass on {what}</h2>
          <p className="meta" id="pass-desc">It moves to Passed &amp; closed with your reason. Nothing is deleted, and you can undo it there. The reason changes the ranking only if you tick the box below it.</p>
        </div>
        <fieldset className="field">
          <legend>Why? <span className="meta" style={{ fontWeight: 400 }}>(optional)</span></legend>
          {(Object.keys(reasonLabels) as PassReason[]).map((r, i) => (
            <label key={r} className="check">
              <input type="radio" name="pass-reason" value={r} checked={reason === r} onChange={() => choose(r)} autoFocus={i === 0} />
              {reasonLabels[r]}
            </label>
          ))}
        </fieldset>
        {learnable && (
          <div className="field">
            <label className="check">
              <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} aria-describedby="learn-help" />
              {learnable.label}
            </label>
            {learnable.requirements && learn && (
              <>
                <label htmlFor="learn-requirement" className="sr-only">Requirement to rank lower</label>
                <select className="input" id="learn-requirement" value={requirement} onChange={(e) => setRequirement(e.target.value)}>
                  {learnable.requirements.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </>
            )}
            <span className="help" id="learn-help">Off unless you tick it. If you do, it's listed under Profile › Dealbreakers and search, where you can undo it, and why-lines say when it moved a job.</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="pass-note">Note <span className="meta" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input className="input" id="pass-note" name="pass-note" type="text" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: revisit after the CKS course" />
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn primary" type="submit">Pass</button>
          <button className="btn ghost" type="button" onClick={() => done(onCancel)}>Cancel</button>
          <span className="grow" />
          <span className="meta"><kbd>Esc</kbd> cancels</span>
        </div>
      </form>
    </dialog>
  );
}
