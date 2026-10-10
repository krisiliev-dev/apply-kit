import { listSources, upsertSource } from "@/lib/doc/serverStore";
import type { DiscoverySource } from "@/lib/discovery/types";

// The discovery source registry.
//   GET  /api/discover/sources → { sources }
//   POST /api/discover/sources ← { kind, ref, label?, region?, addedBy?, enabled?, note? }

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ sources: await listSources() });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<DiscoverySource>;
    if (!body?.kind || !body?.ref) {
      return Response.json({ error: "kind and ref are required." }, { status: 400 });
    }
    const entry = await upsertSource({
      kind: body.kind,
      ref: body.ref,
      label: body.label ?? body.ref,
      region: body.region,
      addedBy: body.addedBy ?? "manual",
      enabled: body.enabled,
      note: body.note,
    });
    return Response.json({ source: entry });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 400 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed.";
}
