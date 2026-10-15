// Import's API (ticket #54): start an import of old CVs, the LinkedIn export and links, follow its
// progress, cancel or resume it, choose what to do with a file that couldn't be read, and see the
// merges. Files arrive as base64 inside JSON (like the photo), so a web page can't send one without a
// CORS preflight; they go straight to the file store and only their text ever reaches the model.
import type { Context, Hono } from "hono";
import type { ImportFile, PreparationEngine, UnreadableAction } from "@apply-kit/core";

type Body = Record<string, unknown>;

/** 20 MB per file is about 27 MB of base64; an old CV is far smaller. */
const MAX_FILE_BASE64 = 27 * 1024 * 1024;
const MAX_FILES = 20;

export function mountImportApi(app: Hono, preparation: PreparationEngine): void {
  // { files: [{ fileName, base64 }], linkedIn?: { fileName, base64 }, github?, portfolio? }
  app.post("/api/import", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length > MAX_FILES) return c.json({ started: false, problems: [{ field: "files", message: `Import up to ${MAX_FILES} files at a time.` }] }, 422);
    const decoded = files.map(file);
    const linkedIn = body.linkedIn ? file(body.linkedIn) : null;
    const bad = [...decoded, linkedIn].find((f) => typeof f === "string");
    if (typeof bad === "string") return c.json({ started: false, problems: [{ field: "files", message: bad }] }, 422);
    const result = await preparation.startImport({
      files: decoded as ImportFile[],
      linkedIn: linkedIn as ImportFile | null,
      github: typeof body.github === "string" ? body.github : null,
      portfolio: typeof body.portfolio === "string" ? body.portfolio : null,
    });
    if (!result.started) return c.json(result, 422);
    result.done.catch((err: unknown) => console.error("Import failed:", err));
    return c.json(result.status, 202);
  });

  // The latest import, or 204 when there's none yet.
  app.get("/api/import", (c) => {
    const status = preparation.importStatus();
    return status ? c.json(status) : c.body(null, 204);
  });
  app.get("/api/import/:id", (c) => {
    const status = preparation.importStatus(c.req.param("id"));
    return status ? c.json(status) : c.json({ error: "No such import" }, 404);
  });
  app.get("/api/import/:id/merges", (c) => c.json(preparation.importMerges(c.req.param("id"))));

  app.post("/api/import/:id/cancel", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    const status = preparation.cancelImport(c.req.param("id"));
    return status ? c.json(status) : c.json({ error: "No such import" }, 404);
  });
  app.post("/api/import/:id/resume", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    const run = preparation.resumeImport(c.req.param("id"));
    if (!run) return c.json({ error: "No such import" }, 404);
    run.done.catch((err: unknown) => console.error("Import failed:", err));
    return c.json(run.status);
  });

  // { action: "recognise" | "text-version" | "retry" | "skip", file?: { fileName, base64 } }
  app.post("/api/import/items/:itemId", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const action = body.action as UnreadableAction;
    let result;
    if (action === "text-version") {
      const f = file(body.file);
      if (typeof f === "string") return c.json({ error: f }, 422);
      result = await preparation.resolveUnreadable(c.req.param("itemId"), { action, file: f });
    } else if (action === "recognise" || action === "retry" || action === "skip") {
      result = await preparation.resolveUnreadable(c.req.param("itemId"), { action });
    } else {
      return c.json({ error: "action must be recognise, text-version, retry or skip" }, 400);
    }
    if (!result.resolved) return c.json({ error: result.message }, 422);
    result.done.catch((err: unknown) => console.error("Import failed:", err));
    return c.json(result.status);
  });

  // Kris checked a drafted piece: it becomes confirmed, or answers 422 with what it still needs.
  app.post("/api/profile/pieces/:id/confirm", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    const result = preparation.confirmPiece(c.req.param("id"));
    return c.json(result, result.saved ? 200 : 422);
  });
}

/** A file sent as { fileName, base64 }, or what's wrong with it. */
function file(v: unknown): ImportFile | string {
  const f = v && typeof v === "object" ? (v as Body) : null;
  if (!f || typeof f.fileName !== "string" || typeof f.base64 !== "string") return "Send each file as { fileName, base64 }.";
  if (f.base64.length > MAX_FILE_BASE64) return `${f.fileName} is over 20 MB.`;
  return { fileName: f.fileName.slice(0, 255), bytes: new Uint8Array(Buffer.from(f.base64, "base64")) };
}

const jsonOnly = (c: Context) => c.req.header("content-type")?.startsWith("application/json") ?? false;

async function jsonBody(c: Context): Promise<Body | null> {
  if (!jsonOnly(c)) return null;
  const body: unknown = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : null;
}
