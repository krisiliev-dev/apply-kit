import { bindCode, peekCode, registerDevice } from "@/lib/pairing/server";
import type {
  PairCompleteRequest,
  PairCompleteResponse,
} from "@/lib/pairing/types";

// POST /api/pair/complete
// Called by the extension. Body: { code, publicKey, deviceLabel }.
// If the code is valid + pending, we mint a long-lived token, register a
// device record (persisted to .pairing-devices.json), and return the token
// to the extension *exactly once*. We store only the SHA-256 hash server-side.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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

  const entry = peekCode(parsed.value.code);
  if (!entry) {
    return Response.json(
      { error: "Code expired or unknown." },
      { status: 410 },
    );
  }
  if (entry.status !== "pending") {
    return Response.json(
      { error: "Code already used." },
      { status: 409 },
    );
  }

  const { deviceId, token, record } = await registerDevice({
    deviceLabel: parsed.value.deviceLabel,
    publicKey: parsed.value.publicKey,
  });

  if (!bindCode(parsed.value.code, deviceId)) {
    // Extremely unlikely race — the code expired between peek and bind. We
    // registered the device anyway; return success so the extension keeps
    // its token. The dangling code will be GC'd naturally.
  }

  const response: PairCompleteResponse = {
    deviceId,
    token,
    deviceLabel: record.deviceLabel,
    pairedAt: record.pairedAt,
  };
  return Response.json(response);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parse(body: unknown): Parsed<PairCompleteRequest> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object." };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.code !== "string" || b.code.trim().length === 0) {
    return { ok: false, error: "Field `code` required." };
  }
  if (!b.publicKey || typeof b.publicKey !== "object") {
    return { ok: false, error: "Field `publicKey` (JWK) required." };
  }
  if (typeof b.deviceLabel !== "string" || b.deviceLabel.trim().length === 0) {
    return { ok: false, error: "Field `deviceLabel` required." };
  }
  return {
    ok: true,
    value: {
      code: b.code.trim().toUpperCase(),
      publicKey: b.publicKey as JsonWebKey,
      deviceLabel: b.deviceLabel.trim(),
    },
  };
}
