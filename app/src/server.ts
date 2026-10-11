import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { stream } from "hono/streaming";
import type { Context } from "hono";
import type { DiscoveryEngine, FactAnswer, FeedSort, FeedView, PassReason, PastedPosting, Scheduler } from "@apply-kit/core";

const views: FeedView[] = ["new", "saved", "open", "passed", "hidden"];
const sorts: FeedSort[] = ["fit", "newest"];

export function createServer({ engine, scheduler, uiDir }: { engine: DiscoveryEngine; scheduler: Scheduler; uiDir: string }) {
  const app = new Hono();

  app.get("/api/feed", async (c) => {
    const v = c.req.query("view") ?? "new";
    if (!views.includes(v as FeedView)) return c.json({ error: `Unknown view "${v}"` }, 400);
    const sort = c.req.query("sort") ?? "fit";
    if (!sorts.includes(sort as FeedSort)) return c.json({ error: `Unknown sort "${sort}"` }, 400);
    const relocation = c.req.query("relocation") === "1";
    return c.json(await engine.queryFeed({ view: v as FeedView, sort: sort as FeedSort, relocation }));
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

  // Add company: finds which job system a company (a name or a careers link) uses. Answers with one
  // JSON line per progress snapshot (application/x-ndjson); the last one has finished: true.
  app.post("/api/companies/detect", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const input = typeof body.input === "string" ? body.input.trim() : "";
    if (!input) return c.json({ error: "Type a company name or paste a link to its careers page" }, 400);
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    return stream(c, async (s) => {
      let written: Promise<unknown> = Promise.resolve();
      const line = (v: unknown) => { written = written.then(() => s.writeln(JSON.stringify(v))); };
      try {
        await engine.detectCompany(input, { onProgress: line });
      } catch (err) {
        line({ error: err instanceof Error ? err.message : String(err) });
      }
      await written;
    });
  });

  // Adds a Source to the watchlist: { kind, config, name? } as detection found it. Adding a paused or
  // removed one brings it back.
  app.post("/api/sources", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    if (typeof body.kind !== "string") return c.json({ error: "kind must be a Source type" }, 400);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
    try {
      return c.json(await engine.addSource({ kind: body.kind, config: body.config, name }), 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // The Sofia starter watchlist: GET shows which companies' feeds are on the watchlist and the ones
  // without a feed with their alert route; POST adds every feed not added before, in one step.
  app.get("/api/watchlist/starter", async (c) => c.json(await engine.starterWatchlist()));
  app.post("/api/watchlist/starter", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    return c.json(await engine.seedWatchlist(), 201);
  });

  // Pause, resume, what removing would do, and remove. Undoing a removal is POST /api/decisions/:id/undo.
  app.post("/api/sources/:id/pause", (c) => onSource(c, (id) => engine.pauseSource(id)));
  app.post("/api/sources/:id/resume", (c) => onSource(c, (id) => engine.resumeSource(id)));
  app.get("/api/sources/:id/removal", async (c) => {
    try {
      return c.json(await engine.previewRemoval(c.req.param("id")));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });
  app.post("/api/sources/:id/remove", (c) => onSource(c, (id) => engine.removeSource(id)));
  // Kris confirms an unusual drop is real: closes the count it stated. Undo with POST /api/decisions/:id/undo.
  app.post("/api/sources/:id/confirm-drop", (c) => onSource(c, (id) => engine.confirmDrop(id)));

  // One Job with its Postings (target marked) and its reading. A merged-away id answers with the
  // Job it lives in now (check the returned id).
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

  // "Paste a job link": { link, pasted?: { title, company?, location?, text } }. Answers with the
  // outcome: added, existing or merged (open jobId), invalid, or unreadable (with the link kept).
  app.post("/api/jobs/link", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    if (typeof body.link !== "string" || !body.link.trim()) return c.json({ error: "Paste a link to the job" }, 400);
    const p = body.pasted;
    let pasted: PastedPosting | undefined;
    if (p !== undefined) {
      const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const text = typeof o.text === "string" ? o.text.trim() : "";
      const title = typeof o.title === "string" ? o.title.trim() : "";
      if (!text || !title) return c.json({ error: "A pasted job needs its title and text" }, 400);
      const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      pasted = { text, title, company: opt(o.company), location: opt(o.location) };
    }
    const result = await engine.addJobLink(body.link, pasted);
    return c.json(result, result.outcome === "added" || result.outcome === "merged" ? 201 : 200);
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

  // Dealbreakers. "Show this job" is a Decision like the others (undo hides it again).
  app.post("/api/jobs/unhide", (c) => withIds(c, (body, ids) => engine.unhide(ids)));
  // "Not a dealbreaker for me": { "reason": "<the hidden reason's key>" }; changes the rule behind it.
  app.post("/api/jobs/:id/not-a-dealbreaker", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    if (typeof body.reason !== "string") return c.json({ error: "reason must be a hidden reason's key" }, 400);
    try {
      return c.json(await engine.notADealbreaker(c.req.param("id"), body.reason));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
  app.get("/api/rule-changes", async (c) => c.json(await engine.ruleChanges()));
  app.post("/api/rule-changes/:id/undo", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    try {
      return c.json(await engine.undoRuleChange(c.req.param("id")));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });

  // Kris's search settings (the settings form): what Fit and dealbreakers are measured against.
  app.get("/api/settings/search", async (c) => c.json(await engine.getSearchSettings()));
  app.put("/api/settings/search", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    try {
      return c.json(await engine.saveSearchSettings(body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
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

/** A JSON-only POST acting on one Source; an unknown Source is a 404. */
async function onSource(c: Context, act: (sourceId: string) => Promise<unknown>) {
  if (!c.req.header("content-type")?.startsWith("application/json")) {
    return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
  }
  try {
    return c.json(await act(c.req.param("id")!));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
  }
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
