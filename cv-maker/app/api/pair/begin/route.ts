import { mintCode } from "@/lib/pairing/server";

// POST /api/pair/begin
// Starts a pairing session by minting a 10-minute pair code. The web-app
// then shows the code + QR and polls /api/pair/begin/status until the
// extension completes the handshake via /api/pair/complete.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const entry = mintCode();
  return Response.json({
    code: entry.code,
    expiresAt: entry.expiresAt,
  });
}
