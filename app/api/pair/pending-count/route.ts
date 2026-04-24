import { inboxCount } from "@/lib/pairing/server";

// GET /api/pair/pending-count
// Returns the number of captures sitting in the pair inbox. Called by the
// home page and /discover to drive a lightweight "N jobs captured" badge
// without having to drain the inbox.
//
// No auth: the count is not sensitive and anyone on the same origin as the
// web-app is by definition the web-app UI.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ count: inboxCount() });
}
