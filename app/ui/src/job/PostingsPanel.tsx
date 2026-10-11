import type { JobDetail, JobPosting } from "@apply-kit/core";
import { useState } from "react";
import { fetchJob, makeTarget, splitPosting } from "../api.ts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** "Company's own page · Greenhouse" or "Board · dev.bg", then when it was first seen. */
function describe(p: JobPosting): string {
  const kind = p.source.category === "ats" ? "Company's own page" : p.source.category === "aggregator" ? "Board" : "Job site";
  const seen = new Date(p.firstSeenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${kind} · ${p.source.label} · seen ${seen}`;
}

/**
 * The Job page's Postings panel (from the Job hi-fi): every Posting merged into the Job, the target
 * marked with why, "Make target" on the others, and "Not the same job? Split" when there are several.
 */
export function PostingsPanel({ job, onChanged }: { job: JobDetail; onChanged: (job: JobDetail | null, note: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const several = job.postings.length > 1;

  async function act(run: () => Promise<{ job: JobDetail | null; note: string }>) {
    setBusy(true);
    setError(null);
    try {
      const out = await run();
      onChanged(out.job, out.note);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const target = (p: JobPosting) => act(async () => ({ job: await makeTarget(job.id, p.id), note: `${p.site} is now the target posting.` }));
  const split = (p: JobPosting) => act(async () => {
    const { jobIds: [kept] } = await splitPosting(job.id, p.id);
    return { job: await fetchJob(kept), note: `Split: ${p.site} is now a job of its own. Later checks won't merge them again.` };
  });

  return (
    <div className="panel" aria-labelledby="postings-h">
      <div className="sec-head">
        <h2 id="postings-h">Postings</h2>
        <span className="meta">{several ? `${job.postings.length} merged into this job · on ${job.siteCount} sites` : "Seen in 1 posting"}</span>
      </div>
      <div className="postings">
        {job.postings.map((p) => (
          <div key={p.id} className={`posting${p.isTarget ? " target" : ""}`}>
            <div className="row">
              <span className="name">{p.site}</span>
              {p.isTarget && <span className="chip target">Target posting</span>}
            </div>
            <span className="meta">{describe(p)}</span>
            {p.isTarget && <span className="note">{job.target.why}</span>}
            {p.mergedBecause && <span className="note">{p.mergedBecause}.</span>}
            <div className="row acts">
              {!p.isTarget && (
                <button className="btn ghost sm" type="button" disabled={busy} onClick={() => target(p)}>
                  Make target<span className="sr-only">: {p.site}</span>
                </button>
              )}
              {several && (
                <button className="btn ghost sm" type="button" disabled={busy} onClick={() => split(p)}>
                  Not the same job? Split<span className="sr-only"> {p.site} off</span>
                </button>
              )}
              <a className="btn ghost sm" href={p.url} target="_blank" rel="noopener noreferrer">
                Open<span className="sr-only"> the {p.site} posting</span><span aria-hidden="true"> ↗</span>
              </a>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="meta" role="alert">Couldn't change the postings: {error}</p>}
    </div>
  );
}
