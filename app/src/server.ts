import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context } from "hono";
import type { DiscoveryEngine, FactAnswer, FeedView } from "@apply-kit/core";

const views: FeedView[] = ["new", "saved", "open", "passed"];

export function createServer({ engine, uiDir }: { engine: DiscoveryEngine; uiDir: string }) {
  const app = new Hono();

  app.get("/api/feed", async (c) => {
    const v = c.req.query("view") ?? "new";
    if (!views.includes(v as FeedView)) return c.json({ error: `Unknown view "${v}"` }, 400);
    return c.json(await engine.queryFeed({ view: v as FeedView }));
  });

  // Requiring a JSON body type means a web page can't trigger these without a CORS preflight,
  // which this service never grants.
  const notJson = (c: Context) =>
    c.req.header("content-type")?.startsWith("application/json") ? null : c.json({ error: "Send Content-Type: application/json" }, 415);

  app.post("/api/check", async (c) => {
    const refused = notJson(c);
    if (refused) return refused;
    const result = await engine.checkAll();
    // Read new postings in the background, within the monthly budget; the Feed shows progress per row.
    engine.readPending().catch((err: unknown) => console.error("Reading postings failed:", err));
    return c.json(result);
  });

  app.get("/api/jobs/:id", async (c) => {
    const job = await engine.getJob(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "No such job" }, 404);
  });

  app.post("/api/jobs/:id/read", async (c) => {
    const refused = notJson(c);
    if (refused) return refused;
    if (!(await engine.getJob(c.req.param("id")))) return c.json({ error: "No such job" }, 404);
    return c.json(await engine.readJob(c.req.param("id")));
  });

  app.post("/api/jobs/:id/facts/:key", async (c) => {
    const refused = notJson(c);
    if (refused) return refused;
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
