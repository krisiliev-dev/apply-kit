import type { FeedJob, FeedResult } from "@apply-kit/core";
import { useRef } from "react";
import { passJobs, reopenJobs, undoDecision } from "../api.ts";
import { reasonLabels } from "./PassDialog.tsx";
import type { Toaster } from "./toast.tsx";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const named = (j: FeedJob) => `${j.title} at ${j.company}`;

/** "Today, 08:02" or "10 Oct". */
function when(iso: string, asOf: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date(asOf).toDateString();
  return sameDay
    ? `Today, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Passed & closed: every passed job with Kris's reason (Undo pass), every closed job with how it
 * closed (Reopen). Nothing here is deleted. This is the lasting undo path behind the 15 s toast.
 */
export function PassedClosed({ feed, toaster, onChanged }: { feed: FeedResult; toaster: Toaster; onChanged: (touched?: string[]) => void }) {
  const passed = feed.jobs.filter((j) => j.state === "passed");
  const closed = feed.jobs.filter((j) => j.state === "closed");
  const rootRef = useRef<HTMLDivElement>(null);

  /** After a row leaves, focus the next row's button in the same table, else the section heading. */
  const focusAfter = (table: "passed" | "closed", id: string) => {
    const root = rootRef.current;
    if (!root) return;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(`[data-table="${table}"] button[data-id]`)];
    const i = buttons.findIndex((b) => b.dataset.id === id);
    const next = buttons[i + 1] ?? buttons[i - 1];
    (next ?? root.querySelector<HTMLElement>(`#pc-${table}-h`))?.focus();
  };

  async function undoPass(job: FeedJob) {
    const p = job.passed!;
    try {
      await undoDecision(p.decisionId, [job.id]);
      focusAfter("passed", job.id);
      onChanged();
      toaster.show({
        message: `Pass undone · ${named(job)}. It's back in All open.`,
        undo: () => {
          passJobs([job.id], { reason: p.reason, note: p.note })
            .then((d) => { onChanged(d.jobIds); toaster.announce("Passed again."); })
            .catch((err: unknown) => toaster.show({ message: `Couldn't pass again: ${message(err)}` }));
        },
      });
    } catch (err) {
      toaster.show({ message: `Couldn't undo the pass: ${message(err)}` });
    }
  }

  async function reopen(job: FeedJob) {
    try {
      const d = await reopenJobs([job.id]);
      focusAfter("closed", job.id);
      onChanged();
      toaster.show({
        message: `Reopened · ${named(job)}. It's back in All open.`,
        undo: () => {
          undoDecision(d.id)
            .then((r) => { onChanged(r.jobIds); toaster.announce("Undone. The job is closed again."); })
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
      });
    } catch (err) {
      toaster.show({ message: `Couldn't reopen: ${message(err)}` });
    }
  }

  return (
    <div className="stack" style={{ gap: "var(--s-6)" }} ref={rootRef}>
      <p className="meta">{passed.length} you passed, {closed.length} that closed · nothing here is deleted, and each one can come back</p>
      <section className="panel flush" aria-labelledby="pc-passed-h" data-table="passed">
        <div className="sec-pad">
          <h2 id="pc-passed-h" tabIndex={-1}>Passed <span className="num meta">{passed.length}</span></h2>
          <p className="meta">Your reason is kept with each job.</p>
        </div>
        {passed.length === 0 ? <p className="meta sec-pad">No passed jobs.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Job</th><th scope="col">Passed</th><th scope="col">Your reason</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {passed.map((j) => (
                  <tr key={j.id} className="is-hidden">
                    <td><a className="t" href={j.url} target="_blank" rel="noopener noreferrer">{j.title}<span className="sr-only"> (opens the posting in a new tab)</span></a><span className="co">{j.company}</span></td>
                    <td className="num">{when(j.passed!.at, feed.asOf)}</td>
                    <td>
                      <span className="reason">{j.passed!.reason ? reasonLabels[j.passed!.reason] : "No reason given"}</span>
                      {j.passed!.note && <span className="learned">{j.passed!.note}</span>}
                    </td>
                    <td className="acts">
                      <button className="btn sm" type="button" data-id={j.id} onClick={() => void undoPass(j)}>Undo pass<span className="sr-only">: {named(j)}</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel flush" aria-labelledby="pc-closed-h" data-table="closed">
        <div className="sec-pad">
          <h2 id="pc-closed-h" tabIndex={-1}>Closed <span className="num meta">{closed.length}</span></h2>
          <p className="meta">How each one closed. A job only closes when its sources stop listing it or when you close it.</p>
        </div>
        {closed.length === 0 ? <p className="meta sec-pad">No closed jobs.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Job</th><th scope="col">Closed</th><th scope="col">How it closed</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {closed.map((j) => (
                  <tr key={j.id} className="is-hidden">
                    <td><a className="t" href={j.url} target="_blank" rel="noopener noreferrer">{j.title}<span className="sr-only"> (opens the posting in a new tab)</span></a><span className="co">{j.company}</span></td>
                    <td className="num">{when(j.closed!.at, feed.asOf)}</td>
                    <td><span className="reason">{j.closed!.how}</span></td>
                    <td className="acts">
                      <button className="btn sm" type="button" data-id={j.id} onClick={() => void reopen(j)}>Reopen<span className="sr-only">: {named(j)}</span></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
