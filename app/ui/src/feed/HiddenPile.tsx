import type { FeedJob, FeedResult, HiddenReason } from "@apply-kit/core";
import { useRef } from "react";
import { notADealbreaker, undoDecision, undoRuleChange, unhideJobs } from "../api.ts";
import type { Toaster } from "./toast.tsx";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const titleOf = (j: FeedJob) => j.titleTranslation ?? j.title;
const named = (j: FeedJob) => `${titleOf(j)} at ${j.company}`;

/**
 * The hidden pile: New jobs kept out of the Feed by a dealbreaker, never deleted. Each row says why
 * in plain words. "Show this job" brings back one job and changes nothing else; "Not a dealbreaker
 * for me" changes the rule behind one reason, for this job and future ones. Both can be undone.
 */
export function HiddenPile({ feed, toaster, onChanged }: { feed: FeedResult; toaster: Toaster; onChanged: (touched?: string[]) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const jobs = feed.jobs;

  /** After a row leaves, focus the next row's first button, else the heading. */
  const focusAfter = (id: string) => {
    const root = rootRef.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLTableRowElement>("tr[data-id]")];
    const i = rows.findIndex((r) => r.dataset.id === id);
    const next = rows[i + 1] ?? rows[i - 1];
    (next?.querySelector<HTMLElement>("button") ?? root.querySelector<HTMLElement>("#hidden-h"))?.focus();
  };

  async function show(job: FeedJob) {
    try {
      const d = await unhideJobs([job.id]);
      focusAfter(job.id);
      onChanged();
      toaster.show({
        message: `Shown in New · ${named(job)}. Your dealbreakers are unchanged.`,
        undo: () => {
          undoDecision(d.id)
            .then(() => { onChanged(); toaster.announce("Hidden again."); })
            .catch((err: unknown) => toaster.show({ message: `Couldn't hide it again: ${message(err)}` }));
        },
      });
    } catch (err) {
      toaster.show({ message: `Couldn't show the job: ${message(err)}` });
    }
  }

  async function relax(job: FeedJob, reason: HiddenReason) {
    try {
      const { change } = await notADealbreaker(job.id, reason.key);
      focusAfter(job.id);
      onChanged();
      toaster.show({
        message: `Rule changed: ${change.text}. Jobs it no longer hides are back in New.`,
        undo: () => {
          undoRuleChange(change.id)
            .then(() => { onChanged(); toaster.announce("Rule put back. Jobs it hides are hidden again."); })
            .catch((err: unknown) => toaster.show({ message: `Couldn't put the rule back: ${message(err)}` }));
        },
      });
    } catch (err) {
      toaster.show({ message: `Couldn't change the rule: ${message(err)}` });
    }
  }

  return (
    <div className="stack" style={{ gap: "var(--s-5)" }} ref={rootRef}>
      <div className="page-head">
        <p className="meta" style={{ maxWidth: "72ch" }}>
          Hidden by your dealbreakers, never deleted. <b>Show this job</b> brings back one job and changes nothing else.
          {" "}<b>Not a dealbreaker for me</b> changes that rule for this job and future ones, and can be undone in your search settings.
        </p>
        <span className="grow" />
        <a className="btn sm" href="/profile/search">Edit dealbreakers</a>
      </div>
      <section className="panel flush" aria-labelledby="hidden-h">
        <h2 className="sr-only" id="hidden-h" tabIndex={-1}>Hidden jobs</h2>
        {jobs.length === 0 ? <p className="meta sec-pad">Nothing is hidden. Jobs that break one of your dealbreakers will be listed here with the reason.</p> : (
          <div className="table-wrap">
            <table className="table" aria-label="Hidden jobs">
              <thead><tr><th scope="col">Job</th><th scope="col">Where</th><th scope="col">Why it's hidden</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} data-id={j.id} className="is-hidden">
                    <td>
                      <a className="t" href={`/jobs/${encodeURIComponent(j.id)}`}>{titleOf(j)}</a>
                      <span className="co">{j.company}</span>
                    </td>
                    <td>{j.fit.place.label}</td>
                    <td>
                      <ul className="hidden-reasons">
                        {j.dealbreakers.map((d) => (
                          <li key={d.key}>
                            <span className="chip hidden-reason">{d.text}</span>
                            <button className="linkish" type="button" title={d.relax} onClick={() => void relax(j, d)}>
                              Not a dealbreaker for me<span className="sr-only">: {d.text}. {d.relax}.</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="acts">
                      <button className="btn sm" type="button" onClick={() => void show(j)}>Show this job<span className="sr-only">: {named(j)}</span></button>
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
