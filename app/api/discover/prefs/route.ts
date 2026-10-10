import { readDiscoveryPrefs, writeDiscoveryPrefs } from "@/lib/doc/serverStore";
import type { DiscoveryPreferences } from "@/lib/discovery/types";

// Discovery preferences in the shared store.
//   GET /api/discover/prefs → { prefs }
//   PUT /api/discover/prefs ← partial DiscoveryPreferences (merged)

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ prefs: await readDiscoveryPrefs() });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const patch = (await req.json()) as Partial<DiscoveryPreferences>;
    const cur = await readDiscoveryPrefs();
    const next: DiscoveryPreferences = {
      ...cur,
      ...patch,
      watchlist: { ...cur.watchlist, ...(patch.watchlist ?? {}) },
    };
    await writeDiscoveryPrefs(next);
    return Response.json({ prefs: next });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 400 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed.";
}
