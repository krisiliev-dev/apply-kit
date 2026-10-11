import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { DiscoveryEngine, FeedView, Scheduler } from "@apply-kit/core";

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

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // The built UI (pnpm start). In dev, Vite serves the UI and proxies /api here.
  app.use("/*", serveStatic({ root: uiDir }));
  app.get("/*", serveStatic({ root: uiDir, path: "index.html" }));

  return app;
}
