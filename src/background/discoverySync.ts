import type { CapturedJob, JobSyncResult } from "../shared/types";
import { getConfig } from "../shared/config";
import { putJob, unsyncedJobs } from "../store/db";

// Discovery sync: POST each un-synced CapturedJob to the CV-maker web app.
// The endpoint is owned by a parallel agent; if it's absent (404, network
// error, 5xx), we leave the record un-synced and try again later. The
// extension stays fully functional offline.

const INGEST_PATH = "/api/discover/ingest";

export interface SyncOneOutcome {
  synced: boolean;
  error?: string;
}

function ingestUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${INGEST_PATH}`;
}

function jobPayload(job: CapturedJob): Record<string, unknown> {
  return {
    id: job.id,
    source: job.source,
    url: job.url,
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    description: job.description,
    postedAt: job.postedAt,
    capturedAt: job.capturedAt,
  };
}

export async function syncOne(job: CapturedJob): Promise<SyncOneOutcome> {
  if (job.syncedToWebApp) return { synced: true };
  const { cvMakerBaseUrl } = await getConfig();

  let res: Response;
  try {
    res = await fetch(ingestUrl(cvMakerBaseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(jobPayload(job)),
    });
  } catch (err) {
    return {
      synced: false,
      error: err instanceof Error ? err.message : "network error",
    };
  }

  if (res.status >= 200 && res.status < 300) {
    const updated: CapturedJob = { ...job, syncedToWebApp: true };
    await putJob(updated);
    return { synced: true };
  }

  // 404 means the endpoint doesn't exist yet (parallel agent hasn't shipped it).
  // 5xx means the server is unhappy. Both are transient — leave un-synced.
  return {
    synced: false,
    error: `HTTP ${res.status}`,
  };
}

export async function syncAll(): Promise<JobSyncResult> {
  const pending = await unsyncedJobs();
  if (pending.length === 0) {
    return { total: 0, synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;
  let lastError: string | undefined;
  for (const job of pending) {
    const outcome = await syncOne(job);
    if (outcome.synced) synced++;
    else {
      failed++;
      if (outcome.error) lastError = outcome.error;
    }
  }

  const result: JobSyncResult = { total: pending.length, synced, failed };
  if (failed > 0 && lastError) result.error = lastError;
  return result;
}
