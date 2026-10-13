// Profile's API (ticket #53): the master profile's pieces, contact details and links with the
// optional photo, the section counts behind the nav badge, and the one-click export. Mutations need a
// JSON body, like the rest of the service, so a web page can't send one without a CORS preflight.
import type { Context, Hono } from "hono";
import { angles, numberSources, pieceKinds, type Angle, type NumberSource, type PieceEntry, type PieceInput, type PieceKind, type PreparationEngine } from "@apply-kit/core";

type Body = Record<string, unknown>;

/** The photo arrives as base64 inside JSON; 5 MB of photo is about 6.7 MB of base64. */
const MAX_PHOTO_BASE64 = 7 * 1024 * 1024;

export function mountProfileApi(app: Hono, preparation: PreparationEngine): void {
  app.get("/api/profile/summary", (c) => c.json(preparation.profileSummary()));

  // ?kind=achievement&angle=security&q=splunk, each optional.
  app.get("/api/profile/pieces", (c) => {
    const kind = c.req.query("kind") || undefined;
    const angle = c.req.query("angle") || undefined;
    if (kind && !pieceKinds.includes(kind as PieceKind)) return c.json({ error: `Unknown piece type "${kind}"` }, 400);
    if (angle && !angles.includes(angle as Angle)) return c.json({ error: `Unknown angle "${angle}"` }, 400);
    return c.json(preparation.listPieces({ kind: kind as PieceKind | undefined, angle: angle as Angle | undefined, search: c.req.query("q") }));
  });

  app.get("/api/profile/pieces/:id", (c) => {
    const piece = preparation.piece(c.req.param("id"));
    return piece ? c.json(piece) : c.json({ error: "No such piece. It may have been deleted." }, 404);
  });

  // Adds a piece, or saves an edit when the body has the piece's id. A refused piece answers 422
  // with its problems and the honest fixes.
  app.post("/api/profile/pieces", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const input = pieceInput(body);
    if (typeof input === "string") return c.json({ error: input }, 400);
    const result = preparation.savePiece(input);
    return c.json(result, !result.saved ? 422 : input.id ? 200 : 201);
  });

  app.post("/api/profile/pieces/:id/delete", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    const result = preparation.deletePiece(c.req.param("id"));
    return result.deleted ? c.json(result) : c.json({ error: "No such piece. It may have been deleted already." }, 404);
  });

  app.get("/api/profile/contact", (c) => c.json(preparation.contact()));
  app.put("/api/profile/contact", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const text = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    const links = Array.isArray(body.links) ? body.links.filter((l): l is string => typeof l === "string") : [];
    const result = preparation.saveContact({
      nameLatin: text("nameLatin"), nameCyrillic: text("nameCyrillic"), email: text("email"), phone: text("phone"),
      city: text("city"), country: text("country"), links,
    });
    return c.json(result, result.saved ? 200 : 422);
  });

  // { fileName, base64 }: a JPEG or PNG, replacing the photo before.
  app.put("/api/profile/photo", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    if (typeof body.base64 !== "string" || !body.base64) return c.json({ error: "Send the photo as base64" }, 400);
    if (body.base64.length > MAX_PHOTO_BASE64) return c.json({ saved: false, problems: [{ field: "photo", message: "Use a photo under 5 MB." }] }, 422);
    const fileName = typeof body.fileName === "string" ? body.fileName : "photo";
    const result = await preparation.setPhoto({ fileName, bytes: new Uint8Array(Buffer.from(body.base64, "base64")) });
    return c.json(result, result.saved ? 200 : 422);
  });
  app.post("/api/profile/photo/remove", async (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    return c.json(await preparation.removePhoto());
  });

  // The whole profile as a JSON file to keep.
  app.get("/api/profile/export", async (c) => {
    const exported = await preparation.exportProfile();
    c.header("content-disposition", `attachment; filename="apply-kit-profile-${exported.exportedAt.slice(0, 10)}.json"`);
    return c.json(exported);
  });
}

export const jsonOnly = (c: Context) => c.req.header("content-type")?.startsWith("application/json") ?? false;

export async function jsonBody(c: Context): Promise<Body | null> {
  if (!jsonOnly(c)) return null;
  const body: unknown = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : null;
}

/** The piece the form sent, or what's wrong with its shape (the engine checks the content). */
function pieceInput(b: Body): PieceInput | string {
  if (!pieceKinds.includes(b.kind as PieceKind)) return "kind must be role, achievement, skill or education";
  if (b.id !== undefined && typeof b.id !== "string") return "id must be a piece id";
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const e = b.entry && typeof b.entry === "object" ? (b.entry as Body) : null;
  const entry: PieceEntry | null = e
    ? { title: str(e.title), organisation: str(e.organisation), city: str(e.city) || null, start: str(e.start), end: str(e.end) || null }
    : null;
  return {
    ...(typeof b.id === "string" && { id: b.id }),
    kind: b.kind as PieceKind,
    text: str(b.text),
    entry,
    belongsTo: str(b.belongsTo) || null,
    tags: strings(b.tags),
    angles: strings(b.angles).filter((a): a is Angle => angles.includes(a as Angle)),
    numberSource: numberSources.includes(b.numberSource as NumberSource) ? (b.numberSource as NumberSource) : null,
  };
}
