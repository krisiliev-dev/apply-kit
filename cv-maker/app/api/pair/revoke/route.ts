import { revokeDevice } from "@/lib/pairing/server";

// POST /api/pair/revoke
// Body: { deviceId }
// Called from the /pair page's device list. Also called best-effort by the
// extension when the user clicks "Unpair". No auth — the web-app UI lives
// on the same origin and the only harm from an unauthorized revoke is that
// the user would have to re-pair, which is what they're asking for anyway.
//
// TODO(v2): once we add real auth on the web-app side, gate this behind
// session auth so a malicious page can't revoke devices via CSRF.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Body must be an object." }, { status: 400 });
  }
  const deviceId = (body as Record<string, unknown>).deviceId;
  if (typeof deviceId !== "string" || deviceId.trim().length === 0) {
    return Response.json({ error: "Field `deviceId` required." }, { status: 400 });
  }
  const existed = await revokeDevice(deviceId.trim());
  return Response.json({ ok: true, existed });
}
