import type { HealthSummary, JobDetail } from "@apply-kit/core";
import { useEffect, useState } from "react";
import { fetchJob, fetchSources } from "../api.ts";
import { PostingsPanel } from "./PostingsPanel.tsx";

/** The Job's id from a /jobs/<id> path. */
export function jobIdFromPath(path: string): string | null {
  const m = /^\/jobs\/(.+)$/.exec(path);
  return m ? decodeURIComponent(m[1]!) : null;
}

export const jobPath = (jobId: string) => `/jobs/${encodeURIComponent(jobId)}`;

/**
 * A Job: what it is and every Posting merged into it. Fit, requirements and key facts arrive with
 * their own tickets; this page starts with the Postings panel.
 */
export function JobPage({ jobId, onHealth }: { jobId: string; onHealth: (h: HealthSummary) => void }) {
  const [job, setJob] = useState<JobDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    fetchJob(jobId, ctrl.signal).then((j) => {
      setJob(j);
      // A Job merged into another lives on under that Job's id.
      if (j && j.id !== jobId) window.history.replaceState(null, "", jobPath(j.id));
    }).catch((err: unknown) => {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    });
    return () => ctrl.abort();
  }, [jobId, onHealth]);

  if (error) return <div className="empty"><h1>Couldn't load this job</h1><p>{error}</p><a className="btn" href="/">Back to the Feed</a></div>;
  if (job === undefined) return <p className="meta" role="status">Loading the job…</p>;
  if (job === null) return <div className="empty"><h1>No such job</h1><p>It may have been split or removed.</p><a className="btn" href="/">Back to the Feed</a></div>;

  return (
    <section className="stack job-page">
      <nav className="crumbs" aria-label="Breadcrumb"><a href="/">Feed</a><span aria-hidden="true">/</span><span aria-current="page">{job.title}</span></nav>
      <div className="job-head">
        <h1>{job.title}</h1>
        <div className="job-meta">
          <b>{job.company}</b>
          <span>{job.location ?? "Location not stated"}</span>
          <span className="num">{job.salary ?? "Salary not stated"}</span>
        </div>
        <div className="chips"><span className="chip neutral">{job.postingCount > 1 ? `On ${job.siteCount} sites` : "Seen in 1 posting"}</span></div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{note}</p>
      {note && <p className="meta" aria-hidden="true">{note}</p>}
      <PostingsPanel job={job} onChanged={(j, n) => { setJob(j); setNote(n); }} />
    </section>
  );
}
