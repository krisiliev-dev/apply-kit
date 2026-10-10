import { listDevices } from "@/lib/pairing/server";

// GET /api/pair/devices
// Returns the current set of paired devices (no token hashes). Rendered in
// the /pair page's device list. Same-origin, no auth; TODO(v2): gate on
// session auth once the web-app has real users.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const devices = await listDevices();
  return Response.json({ devices });
}
