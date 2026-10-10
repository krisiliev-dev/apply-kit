import {
  appendInboxItem,
  touchDevice,
  validateToken,
} from "@/lib/pairing/server";
import { payloadToPosting } from "@/lib/discovery/ingestBuffer";
import { ingestPostings } from "@/lib/doc/serverStore";
import type { IngestPayload } from "@/lib/discovery/types";
import type {
  PairIngestRequest,
  PairIngestResponse,
} from "@/lib/pairing/types";

// POST /api/pair/ingest
// Authenticated extension → web-app capture sync.
//
// Headers:
//   Authorization: Bearer <token>
//   x-device-id: <deviceId>
// Body: { items: IngestPayload[] }
//
// Captures are appended to the in-memory pair inbox. The web-app pulls them
// into localStorage via /api/pair/pull on any page visit. The device's
// `lastSeenAt` is touched on success.
//
// TODO(v2): move the inbox to a real KV store (Vercel KV / Upstash) so that
// captures survive dev-server restarts and aren't tied to a single
// serverless instance. For now, if the dev server restarts between ingest
// and pull, captures are lost — the extension's `chrome.alarms` retry will
// re-send them on the next tick because we only mark them `synced` after a
// 2xx. Documented and acceptable for v1.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS_PER_REQUEST = 50;
const ALLOWED_SOURCES: IngestPayload["source"][] = [
  "linkedin",
  "indeed",
  "glassdoor",
  "jobsbg",
  "capture",
];

export async function POST(req: Request) {
  const deviceId = req.headers.get("x-device-id")?.trim();
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";

  if (!deviceId || !token) {
    return Response.json(
      { error: "Missing device id or bearer token." },
      { status: 401 },
    );
  }

  const record = await validateToken(deviceId, token);
  if (!record) {
    return Response.json(
      { error: "Unknown device or invalid token." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parse(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const errors: string[] = [];
  const acceptedItems: IngestPayload[] = [];
  let rejected = 0;
  for (const raw of parsed.value.items) {
    const v = validateItem(raw);
    if (!v.ok) {
      rejected++;
      errors.push(v.error);
      continue;
    }
    appendInboxItem(deviceId, v.value);
    acceptedItems.push(v.value);
  }
  const accepted = acceptedItems.length;

  // Unify captures into the shared server pool (alongside the legacy inbox the
  // browser drains), so they're visible via MCP and the /discover server sync.
  if (acceptedItems.length > 0) {
    await ingestPostings(acceptedItems.map(payloadToPosting));
  }

  await touchDevice(deviceId);

  const response: PairIngestResponse = { accepted, rejected };
  if (errors.length > 0) response.errors = errors.slice(0, 5);
  return Response.json(response);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parse(body: unknown): Parsed<PairIngestRequest> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object." };
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.items)) {
    return { ok: false, error: "Field `items` must be an array." };
  }
  if (b.items.length === 0) {
    return { ok: false, error: "Field `items` must not be empty." };
  }
  if (b.items.length > MAX_ITEMS_PER_REQUEST) {
    return {
      ok: false,
      error: `Too many items (max ${MAX_ITEMS_PER_REQUEST}).`,
    };
  }
  return { ok: true, value: { items: b.items as IngestPayload[] } };
}

function validateItem(raw: unknown): Parsed<IngestPayload> {
  if (!raw || typeof raw !== "object") return err("item not object");
  const b = raw as Record<string, unknown>;
  if (!isSource(b.source))
    return err(`invalid source: ${JSON.stringify(b.source)}`);
  if (typeof b.url !== "string" || !/^https?:\/\//.test(b.url))
    return err("invalid url");
  if (typeof b.title !== "string" || b.title.trim().length === 0)
    return err("invalid title");
  if (typeof b.company !== "string" || b.company.trim().length === 0)
    return err("invalid company");
  if (b.location != null && typeof b.location !== "string")
    return err("invalid location");
  if (b.salary != null && typeof b.salary !== "string")
    return err("invalid salary");
  if (b.description != null && typeof b.description !== "string")
    return err("invalid description");
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
  return (
    typeof v === "string" &&
    (ALLOWED_SOURCES as readonly string[]).includes(v)
  );
}

function err(msg: string): Parsed<never> {
  return { ok: false, error: msg };
}
