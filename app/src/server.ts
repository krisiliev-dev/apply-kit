import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { DiscoveryEngine, FeedView } from "@apply-kit/core";

const views: FeedView[] = ["new", "saved", "open", "passed"];

export function createServer({ engine, uiDir }: { engine: DiscoveryEngine; uiDir: string }) {
  const app = new Hono();

  app.get("/api/feed", async (c) => {
    const v = c.req.query("view") ?? "new";
    if (!views.includes(v as FeedView)) return c.json({ error: `Unknown view "${v}"` }, 400);
    return c.json(await engine.queryFeed({ view: v as FeedView }));
  });

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // The built UI (pnpm start). In dev, Vite serves the UI and proxies /api here.
  app.use("/*", serveStatic({ root: uiDir }));
  app.get("/*", serveStatic({ root: uiDir, path: "index.html" }));

  return app;
}
