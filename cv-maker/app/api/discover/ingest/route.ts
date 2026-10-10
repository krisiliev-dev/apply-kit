import { pushIngest } from "@/lib/discovery/ingestBuffer";
import { ingestPostings } from "@/lib/doc/serverStore";
import type { IngestPayload } from "@/lib/discovery/types";

// POST /api/discover/ingest
//
// Accepts a single posting captured by the browser extension. We store the
// posting in a server-side in-memory buffer that `/discover` pulls from on
// refresh.
//
// Design: the extension cannot write directly to the web app's localStorage
// (cross-origin). A cookie-based handoff was considered but cookies can't
// carry arbitrary JSON reliably and would need the user to be on the same
// origin. A server-memory buffer is the simplest thing that works:
//   * `/discover` polls it on mount and on Refresh.
//   * The buffer is cleared on server restart — captures that haven't been
//     pulled by `/discover` yet are lost if the dev server restarts.
//   * The user must have `/discover` open for captures to land in their
//     canonical, persistent `DiscoveryState`. Documented in the UI.
//
// See lib/discovery/ingestBuffer.ts for the tradeoffs and TODOs.

export const runtime = "nodejs";

const ALLOWED_SOURCES: IngestPayload["source"][] = [
  "linkedin",
  "indeed",
  "glassdoor",
  "jobsbg",
  "capture",
];

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const parsed = parsePayload(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const posting = pushIngest(parsed.value);
  // Also land it in the shared server pool so it unifies with crawled postings
  // and is visible via MCP / the /discover server sync (not just the in-memory
  // buffer the browser drains).
  await ingestPostings([posting]);
  return json({ ok: true, posting });
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parsePayload(body: unknown): Parsed<IngestPayload> {
  if (!body || typeof body !== "object") return err("Body must be an object.");
  const b = body as Record<string, unknown>;
  if (!isSource(b.source))
    return err(
      `Field "source" must be one of ${ALLOWED_SOURCES.join(", ")}.`,
    );
  if (typeof b.url !== "string" || !/^https?:\/\//.test(b.url))
    return err('Field "url" must be an http(s) URL.');
  if (typeof b.title !== "string" || b.title.trim().length === 0)
    return err('Field "title" must be a non-empty string.');
  if (typeof b.company !== "string" || b.company.trim().length === 0)
    return err('Field "company" must be a non-empty string.');
  if (b.location != null && typeof b.location !== "string")
    return err('Field "location" must be a string.');
  if (b.salary != null && typeof b.salary !== "string")
    return err('Field "salary" must be a string.');
  if (b.description != null && typeof b.description !== "string")
    return err('Field "description" must be a string.');
  const capturedAt =
    typeof b.capturedAt === "number" && Number.isFinite(b.capturedAt)
      ? b.capturedAt
      : Date.now();

  return {
    ok: true,
    value: {
      source: b.source,
      url: b.url.trim(),
      title: b.title.trim(),
      company: b.company.trim(),
      location: typeof b.location === "string" ? b.location.trim() : undefined,
      salary: typeof b.salary === "string" ? b.salary.trim() : undefined,
      description:
        typeof b.description === "string" ? b.description : undefined,
      capturedAt,
    },
  };
}

function isSource(v: unknown): v is IngestPayload["source"] {
  return typeof v === "string" && (ALLOWED_SOURCES as string[]).includes(v);
}

function err(message: string): Parsed<never> {
  return { ok: false, error: message };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      // Let the extension POST from any origin.
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
