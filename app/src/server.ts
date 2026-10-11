import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { DiscoveryEngine, FactAnswer, FeedView, Scheduler } from "@apply-kit/core";

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
    const result = await engine.checkSource(id);
    // Read its new postings in the background, within the monthly AI budget.
    engine.readPending().catch((err: unknown) => console.error("Reading postings failed:", err));
    return c.json(result);
  });

  app.get("/api/jobs/:id", async (c) => {
    const job = await engine.getJob(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "No such job" }, 404);
  });

  // Reads one Job's posting now (the Job page asks when it opens an unread Job).
  app.post("/api/jobs/:id/read", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    if (!(await engine.getJob(c.req.param("id")))) return c.json({ error: "No such job" }, 404);
    return c.json(await engine.readJob(c.req.param("id")));
  });

  // Kris's answer to a low-confidence fact: { "answer": "extracted" | "cautious" }.
  app.post("/api/jobs/:id/facts/:key", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    const { answer } = (await c.req.json().catch(() => ({}))) as { answer?: FactAnswer };
    try {
      return c.json(await engine.confirmFact(c.req.param("id"), c.req.param("key"), answer as FactAnswer));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // The built UI (pnpm start). In dev, Vite serves the UI and proxies /api here.
  app.use("/*", serveStatic({ root: uiDir }));
  app.get("/*", serveStatic({ root: uiDir, path: "index.html" }));

  return app;
}
