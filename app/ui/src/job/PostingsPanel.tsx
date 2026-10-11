import type { JobDetail, JobPosting } from "@apply-kit/core";
import { useState } from "react";
import { fetchJob, makeTarget, splitPosting } from "../api.ts";
import { Icon } from "../icons.tsx";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** "Company's own page · Greenhouse · seen 9 Oct", "Board · dev.bg · seen 10 Oct", "Alert email · …". */
function describe(p: JobPosting): string {
  const kind = { ats: "Company's own page", aggregator: "Board", email: "Alert email" }[p.source.category as string] ?? "Job site";
  return `${kind} · ${p.source.label} · seen ${day(p.firstSeenAt)}`;
}

/**
 * The Job page's Postings panel (hi-fi: docs/design/hifi/job.html): every Posting merged into the
 * Job, the target marked with why, "Make target" on the others, and on each Posting that was merged
 * in, why and "Not the same job? Split".
 */
export function PostingsPanel({ job, onChanged }: { job: JobDetail; onChanged: (job: JobDetail, said: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(run: () => Promise<{ job: JobDetail; said: string }>) {
    setBusy(true);
    setError(null);
    try {
      const out = await run();
      onChanged(out.job, out.said);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const target = (p: JobPosting) => act(async () => ({ job: await makeTarget(job.id, p.id), said: `${p.site} is now the target posting.` }));
  const split = (p: JobPosting) => act(async () => {
    const { jobIds: [kept] } = await splitPosting(job.id, p.id);
    return { job: await fetchJob(kept), said: `Split: the ${p.site} posting is now a job of its own. Later checks won't merge them again.` };
  });

  const n = job.postings.length;
  return (
    <div className="panel o4" role="region" aria-labelledby="postings-h">
      <div className="sec-head">
        <h2 id="postings-h">Postings</h2>
        <span className="meta">{n > 1 ? `${n} merged into this job · on ${job.siteCount} ${job.siteCount === 1 ? "site" : "sites"}` : "1"}</span>
      </div>
      <div className="postings">
        {job.postings.map((p) => (
          <div key={p.id} className={`posting${p.isTarget ? " target" : ""}`}>
            <div className="row">
              <span className="name">{p.site}</span>
              {p.isTarget && <span className="chip target"><Icon name="target" />Target posting</span>}
            </div>
            <span className="meta">{describe(p)}</span>
            {p.isTarget && <span className="note">{job.target.why}.</span>}
            {p.mergedBecause && <span className="note">{p.mergedBecause}.</span>}
            <div className="row acts">
              {!p.isTarget && (
                <button className="btn ghost sm" type="button" disabled={busy} onClick={() => target(p)}>
                  Make target<span className="sr-only">: {p.site}</span>
                </button>
              )}
              {p.mergedBecause && (
                <button className="btn ghost sm" type="button" disabled={busy} onClick={() => split(p)}>
                  Not the same job? Split<span className="sr-only"> the {p.site} posting off</span>
                </button>
              )}
              <a className="btn ghost sm" href={p.url} target="_blank" rel="noopener noreferrer">
                Open<span className="sr-only"> the {p.site} posting (new tab)</span><span aria-hidden="true"> ↗</span>
              </a>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="meta" role="alert">Couldn't change the postings: {error}</p>}
    </div>
  );
}
