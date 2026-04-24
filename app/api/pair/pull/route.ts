import { drainInbox } from "@/lib/pairing/server";
import { readAllIngest } from "@/lib/discovery/ingestBuffer";
import type { JobPosting } from "@/lib/discovery/types";

// POST /api/pair/pull
// Called by the web-app UI (home / discover) to drain the pair inbox and
// merge captures into the client-side `DiscoveryState` in localStorage.
//
// No auth: same-origin web-app call. The response is write-once per
// capture — once pulled, the inbox is emptied.
//
// Back-compat: we also snapshot the older `/api/discover/ingest` in-memory
// buffer so unpaired extensions continue to work. The legacy buffer is
// read-only here; the existing /discover mount-time code still clears it
// through its own channel, but merging it in on pull means paired and
// unpaired captures both land in localStorage quickly.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const paired = drainInbox();
  const legacy = readAllIngest();
  // Dedup by posting id — a paired extension shouldn't double-post, but if
  // someone has both paired and unpaired captures in flight, merge cleanly.
  const seen = new Set<string>();
  const postings: JobPosting[] = [];
  for (const p of [...paired, ...legacy]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    postings.push(p);
  }
  return Response.json({ postings });
}
