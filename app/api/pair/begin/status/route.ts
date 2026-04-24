import { peekCode } from "@/lib/pairing/server";

// GET /api/pair/begin/status?code=FOO-BAR-BAZ-1234
// Polled by the /pair page every ~2s. Returns:
//   * `pending` — code is valid but no extension has bound it yet.
//   * `bound`   — an extension completed the pair; UI should advance.
//   * `expired` — TTL elapsed or the code was never minted.
//
// Safe to call without auth: the code itself is the auth. Once a code is
// reported as `bound` the web-app drops it; re-polling returns `expired`.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  if (!code) {
    return Response.json({ error: "missing code" }, { status: 400 });
  }
  const entry = peekCode(code);
  if (!entry) {
    return Response.json({ status: "expired" });
  }
  return Response.json({
    status: entry.status,
    boundDeviceId: entry.boundDeviceId,
  });
}
