import { removeSource } from "@/lib/doc/serverStore";

// DELETE /api/discover/sources/[id] — remove a registered source.

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await removeSource(id);
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Request failed." },
      { status: 400 },
    );
  }
}
