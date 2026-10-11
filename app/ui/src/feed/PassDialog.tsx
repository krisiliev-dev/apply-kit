import type { PassInput, PassReason } from "@apply-kit/core";
import { useEffect, useRef, useState } from "react";

export const reasonLabels: Record<PassReason, string> = {
  "skills-gap": "Skills gap too big",
  salary: "Salary too low",
  location: "Location or remote rules",
  company: "Not interested in this company",
  other: "Other",
};

/**
 * "Pass with reason" from the Job hi-fi, as a modal over the Feed. No reason is selected when it
 * opens, and none is needed: Enter passes straight away. Esc cancels and focus goes back where it was.
 */
export function PassDialog({ what, onPass, onCancel }: {
  /** "Associate Product Manager at Payhawk", or "3 jobs". */
  what: string;
  onPass: (input: PassInput) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<PassReason | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Close the modal before handing back, so the page is no longer inert and focus can move.
  const done = (fn: () => void) => { ref.current?.close(); fn(); };

  return (
    <dialog ref={ref} className="pass-dialog" aria-labelledby="pass-h" aria-describedby="pass-desc" onCancel={(e) => { e.preventDefault(); done(onCancel); }}>
      <form
        className="stack"
        onSubmit={(e) => { e.preventDefault(); done(() => onPass({ reason, note: note.trim() || null })); }}
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
          <p className="meta" id="pass-desc">It moves to Passed &amp; closed with your reason. Nothing is deleted, and you can undo it there.</p>
        </div>
        <fieldset className="field">
          <legend>Why? <span className="meta" style={{ fontWeight: 400 }}>(optional)</span></legend>
          {(Object.keys(reasonLabels) as PassReason[]).map((r, i) => (
            <label key={r} className="check">
              <input type="radio" name="pass-reason" value={r} checked={reason === r} onChange={() => setReason(r)} autoFocus={i === 0} />
              {reasonLabels[r]}
            </label>
          ))}
        </fieldset>
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
