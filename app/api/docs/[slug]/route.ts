import {
  assertSafeSlug,
  deleteDoc,
  readDoc,
  writeDoc,
} from "@/lib/doc/serverStore";
import type { CvDocument } from "@/lib/doc/types";

// CRUD for a single CV document in the shared store.
//   GET    /api/docs/[slug]  → { doc }
//   PUT    /api/docs/[slug]  ← { doc }   (doc.slug must match the path)
//   DELETE /api/docs/[slug]

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  try {
    assertSafeSlug(slug);
    const doc = await readDoc(slug);
    if (!doc) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ doc });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 400 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { slug } = await params;
  try {
    assertSafeSlug(slug);
    const body = (await req.json()) as { doc?: CvDocument };
    const doc = body?.doc;
    if (!doc || typeof doc !== "object") {
      return Response.json({ error: "Body must be { doc }." }, { status: 400 });
    }
    if (doc.slug !== slug) {
      return Response.json(
        { error: `doc.slug (${doc.slug}) must match path (${slug}).` },
        { status: 400 },
      );
    }
    await writeDoc(doc);
    return Response.json({ ok: true, slug, updatedAt: doc.updatedAt });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  try {
    assertSafeSlug(slug);
    await deleteDoc(slug);
    return Response.json({ ok: true, slug });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 400 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed.";
}
