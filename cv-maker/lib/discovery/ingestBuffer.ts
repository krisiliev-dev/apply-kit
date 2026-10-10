// In-memory buffer for extension-ingested postings.
//
// Why in-memory (and not, e.g., the file system)?
//   * The project ships with zero server-side storage — `/jobs`, `/applications`,
//     and everything else live in the browser's localStorage. Adding a file
//     store would contradict that architecture.
//   * The extension is a browser context; it cannot write to the web app's
//     localStorage directly (origin isolation). So the POST → in-memory buffer
//     → client-pull dance is a necessary bridge.
//
// Tradeoff & rationale:
//   * Module state is reset on every server restart and isn't shared between
//     serverless function instances. For a single-user dev/local workflow
//     this is acceptable — the `/discover` page pulls on mount and merges
//     captures into the canonical client-side `DiscoveryState`, where they
//     persist forever.
//   * When deployed behind multiple instances, any given poll might miss
//     captures routed to another instance. That's a TODO worth solving with
//     a tiny KV (Vercel KV / Upstash) later.
//   * The `/discover` page must be open when the extension syncs. The task
//     brief flags this explicitly as a known v1 constraint.

import type { IngestPayload, JobPosting } from "./types";
import { stableId } from "./id";

const MAX_BUFFER = 200;
const BUFFER_KEY = "__cv_maker_discovery_ingest_buffer__";

type BufferEntry = {
  posting: JobPosting;
  receivedAt: number;
};

// Module-level singleton, but tolerant to HMR and multiple imports of this
// file in the same Node process by parking the buffer on `globalThis`.
function getBuffer(): BufferEntry[] {
  const g = globalThis as typeof globalThis & {
    [BUFFER_KEY]?: BufferEntry[];
  };
  if (!g[BUFFER_KEY]) g[BUFFER_KEY] = [];
  return g[BUFFER_KEY];
}

// Normalize a captured payload into a JobPosting. Shared by the buffer and the
// pair-ingest route so both feed the same shape into the server pool.
export function payloadToPosting(payload: IngestPayload): JobPosting {
  const source =
    payload.source === "capture"
      ? { kind: "capture" as const, site: payload.site }
      : { kind: payload.source };
  return {
    id: stableId([payload.source, payload.url, payload.capturedAt]),
    source,
    url: payload.url,
    title: payload.title,
    company: payload.company,
    location: payload.location,
    salary: payload.salary,
    description: payload.description,
    postedAt: payload.capturedAt,
    fetchedAt: Date.now(),
  };
}

export function pushIngest(payload: IngestPayload): JobPosting {
  const posting = payloadToPosting(payload);

  const buf = getBuffer();
  // Replace any earlier entry with the same posting id so repeated captures
  // don't bloat the buffer.
  const filtered = buf.filter((e) => e.posting.id !== posting.id);
  filtered.push({ posting, receivedAt: Date.now() });
  // Keep the last N by recency.
  while (filtered.length > MAX_BUFFER) filtered.shift();
  const g = globalThis as typeof globalThis & {
    [BUFFER_KEY]?: BufferEntry[];
  };
  g[BUFFER_KEY] = filtered;
  return posting;
}

/** Returns captures received since `sinceMs` (inclusive). */
export function readIngestSince(sinceMs: number): JobPosting[] {
  return getBuffer()
    .filter((e) => e.receivedAt >= sinceMs)
    .map((e) => e.posting);
}

/** All buffered captures, newest first. */
export function readAllIngest(): JobPosting[] {
  return [...getBuffer()].reverse().map((e) => e.posting);
}
