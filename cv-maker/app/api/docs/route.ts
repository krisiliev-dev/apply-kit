import { listDocMeta, listVariants } from "@/lib/doc/serverStore";

// GET /api/docs — list every CV in the shared store + the variant registry.
// Used by the browser to discover docs the agent (or another tab) created.

export const runtime = "nodejs";

export async function GET() {
  try {
    const [docs, variants] = await Promise.all([listDocMeta(), listVariants()]);
    return Response.json({ docs, variants });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list docs." },
      { status: 500 },
    );
  }
}
