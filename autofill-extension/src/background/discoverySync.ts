import type { CapturedJob, JobSyncResult } from "../shared/types";
import { getConfig } from "../shared/config";
import { getPairing, updateLastSync } from "../shared/pairing";
import { putJob, unsyncedJobs } from "../store/db";

// Discovery sync: POST each un-synced CapturedJob to the CV-maker web app.
//
// Two modes, picked at sync time:
//   * Paired  — POST /api/pair/ingest with Authorization + x-device-id. The
//     web-app queues the capture in a server-side inbox that any
//     CV-maker page can pull (so no tab needs to be open). This is the
//     real goal.
//   * Unpaired — legacy POST /api/discover/ingest, kept for back-compat.
//     Still works but requires /discover to be open for the capture to
//     land in the user's persistent state.
//
// Either way, a 2xx marks the local job synced. A 4xx on paired mode means
// the device was revoked server-side — we surface the error so the popup
// can prompt re-pair.

const LEGACY_INGEST_PATH = "/api/discover/ingest";
const PAIR_INGEST_PATH = "/api/pair/ingest";
const PAIR_BATCH_SIZE = 25;

export interface SyncOneOutcome {
  synced: boolean;
  error?: string;
  /** True if the web-app said our token is no longer valid (401/403). */
  authExpired?: boolean;
}

function trim(url: string): string {
  return url.replace(/\/+$/, "");
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

  // Prefer the paired path if we're paired; fall back to legacy otherwise.
  const pairing = await getPairing();
  if (pairing) {
    return syncOnePaired(job, pairing.webAppUrl, pairing.deviceId, pairing.deviceToken);
  }

  const { cvMakerBaseUrl } = await getConfig();
  return syncOneLegacy(job, cvMakerBaseUrl);
}

async function syncOneLegacy(
  job: CapturedJob,
  baseUrl: string,
): Promise<SyncOneOutcome> {
  let res: Response;
  try {
    res = await fetch(`${trim(baseUrl)}${LEGACY_INGEST_PATH}`, {
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
    await putJob({ ...job, syncedToWebApp: true });
    return { synced: true };
  }
  return { synced: false, error: `HTTP ${res.status}` };
}

async function syncOnePaired(
  job: CapturedJob,
  baseUrl: string,
  deviceId: string,
  token: string,
): Promise<SyncOneOutcome> {
  let res: Response;
  try {
    res = await fetch(`${trim(baseUrl)}${PAIR_INGEST_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-device-id": deviceId,
      },
      body: JSON.stringify({ items: [jobPayload(job)] }),
    });
  } catch (err) {
    return {
      synced: false,
      error: err instanceof Error ? err.message : "network error",
    };
  }
  if (res.status >= 200 && res.status < 300) {
    await putJob({ ...job, syncedToWebApp: true });
    return { synced: true };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      synced: false,
      error: `HTTP ${res.status}`,
      authExpired: true,
    };
  }
  return { synced: false, error: `HTTP ${res.status}` };
}

export async function syncAll(): Promise<JobSyncResult> {
  const pending = await unsyncedJobs();
  if (pending.length === 0) {
    return { total: 0, synced: 0, failed: 0 };
  }

  const pairing = await getPairing();
  if (pairing) {
    return syncAllPaired(pending, pairing.webAppUrl, pairing.deviceId, pairing.deviceToken);
  }

  const { cvMakerBaseUrl } = await getConfig();
  let synced = 0;
  let failed = 0;
  let lastError: string | undefined;
  for (const job of pending) {
    const outcome = await syncOneLegacy(job, cvMakerBaseUrl);
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

// Paired sync batches captures into a single POST for efficiency. The server
// validates each item and returns {accepted, rejected}. We mark all pending
// jobs as synced only if the whole batch succeeded (2xx). Partial-accept
// isn't strictly needed because our validation is the same both sides, but
// if the server ever rejects a well-formed item we re-send it on the next
// alarm tick.
async function syncAllPaired(
  pending: CapturedJob[],
  baseUrl: string,
  deviceId: string,
  token: string,
): Promise<JobSyncResult> {
  let synced = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (let i = 0; i < pending.length; i += PAIR_BATCH_SIZE) {
    const batch = pending.slice(i, i + PAIR_BATCH_SIZE);
    let res: Response;
    try {
      res = await fetch(`${trim(baseUrl)}${PAIR_INGEST_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "x-device-id": deviceId,
        },
        body: JSON.stringify({ items: batch.map(jobPayload) }),
      });
    } catch (err) {
      failed += batch.length;
      lastError = err instanceof Error ? err.message : "network error";
      continue;
    }

    if (res.status < 200 || res.status >= 300) {
      failed += batch.length;
      lastError = `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        // Token is dead — short-circuit. Don't mark anything synced; popup
        // will surface the re-pair prompt on next user interaction.
        break;
      }
      continue;
    }

    // 2xx: mark everything in this batch synced.
    for (const job of batch) {
      await putJob({ ...job, syncedToWebApp: true });
      synced++;
    }
  }

  if (synced > 0) {
    await updateLastSync(Date.now());
  }

  const result: JobSyncResult = { total: pending.length, synced, failed };
  if (failed > 0 && lastError) result.error = lastError;
  return result;
}
