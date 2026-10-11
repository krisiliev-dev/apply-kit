import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context } from "hono";
import type { DiscoveryEngine, FeedView, PassReason, Scheduler } from "@apply-kit/core";

const views: FeedView[] = ["new", "saved", "open", "passed"];

export function createServer({ engine, scheduler, uiDir }: { engine: DiscoveryEngine; scheduler: Scheduler; uiDir: string }) {
  const app = new Hono();

  app.get("/api/feed", async (c) => {
    const v = c.req.query("view") ?? "new";
    if (!views.includes(v as FeedView)) return c.json({ error: `Unknown view "${v}"` }, 400);
    return c.json(await engine.queryFeed({ view: v as FeedView }));
  });

  // Requiring a JSON body type means a web page can't trigger a POST without a CORS preflight,
  // which this service never grants.
  const jsonOnly = (ct: string | undefined) => ct?.startsWith("application/json");

  // Whether a check is running (with progress and a time estimate) and how the last one went.
  app.get("/api/check", (c) => c.json(scheduler.status()));

  // Starts a check, or joins the one running, and answers straight away with its status;
  // the UI follows progress through GET /api/check.
  app.post("/api/check", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    scheduler.checkNow().catch(() => {});
    return c.json(scheduler.status(), 202);
  });

  app.get("/api/sources", async (c) => c.json(await engine.sourceHealth()));

  // "Try now": checks one Source. Same JSON-only rule as /api/check.
  app.post("/api/sources/:id/check", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    const id = c.req.param("id");
    const known = (await engine.sourceHealth()).sources.some((s) => s.id === id);
    if (!known) return c.json({ error: `No source "${id}"` }, 404);
    return c.json(await engine.checkSource(id));
  });

  // Triage. Each answers with the Decision (or the Jobs restored, for undo).
  app.post("/api/jobs/save", (c) => withIds(c, (body, ids) => engine.save(ids)));
  app.post("/api/jobs/pass", (c) =>
    withIds(c, (body, ids) => engine.pass(ids, { reason: body.reason as PassReason | null, note: typeof body.note === "string" ? body.note : null })));
  app.post("/api/jobs/reopen", (c) => withIds(c, (body, ids) => engine.reopen(ids)));
  app.post("/api/decisions/:id/undo", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const ids = body.jobIds === undefined ? undefined : stringArray(body.jobIds);
    if (ids === null) return c.json({ error: "jobIds must be a list of job ids" }, 400);
    return c.json(await engine.undo(c.req.param("id"), ids));
  });

  // One Job with its Postings (target marked). A merged-away id answers with the Job it lives in now.
  app.get("/api/jobs/:id", async (c) => {
    const job = await engine.getJob(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "No such job" }, 404);
  });
  app.post("/api/jobs/:id/target", (c) => withPosting(c, (jobId, postingId) => engine.setTarget(jobId, postingId)));
  app.post("/api/jobs/:id/split", (c) => withPosting(c, (jobId, postingId) => engine.splitPosting(jobId, postingId)));

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // The built UI (pnpm start). In dev, Vite serves the UI and proxies /api here.
  app.use("/*", serveStatic({ root: uiDir }));
  app.get("/*", serveStatic({ root: uiDir, path: "index.html" }));

  return app;
}

type Body = Record<string, unknown>;

/** Reads a JSON object body; null unless the request says it's JSON (see /api/check). */
async function jsonBody(c: Context): Promise<Body | null> {
  if (!c.req.header("content-type")?.startsWith("application/json")) return null;
  const body: unknown = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : null;
}

function stringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
}

async function withPosting(c: Context, act: (jobId: string, postingId: string) => Promise<unknown>) {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
  if (typeof body.postingId !== "string") return c.json({ error: "postingId must be a posting id" }, 400);
  try {
    return c.json(await act(c.req.param("id")!, body.postingId));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
}

async function withIds(c: Context, act: (body: Body, ids: string[]) => Promise<unknown>) {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
  const ids = stringArray(body.jobIds);
  if (!ids || ids.length === 0) return c.json({ error: "jobIds must be a non-empty list of job ids" }, 400);
  try {
    return c.json(await act(body, ids));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
}
