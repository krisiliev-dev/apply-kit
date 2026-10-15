import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { stream } from "hono/streaming";
import type { Context } from "hono";
import type {
  CapturedPage, CoverageInput, DiscoveryEngine, DocumentKind, DocumentLanguage, FactAnswer, FeedSort, FeedView, Pairing, PassReason, PastedPosting,
  PreparationEngine, Scheduler,
} from "@apply-kit/core";
import { mountImportApi } from "./import-api.ts";
import { mountAnswerApi } from "./answers-api.ts";
import { mountPackageApi } from "./packages-api.ts";
import { mountProfileApi } from "./profile-api.ts";
import { mountVoiceApi } from "./voice-api.ts";

const documentKinds: DocumentKind[] = ["cv", "cover-letter"];
const documentLanguages: DocumentLanguage[] = ["en", "bg"];
const views: FeedView[] = ["new", "saved", "open", "passed", "hidden"];
const sorts: FeedSort[] = ["fit", "newest"];

export function createServer({ engine, preparation, scheduler, pairing, uiDir, port }: {
  engine: DiscoveryEngine; scheduler: Scheduler; pairing: Pairing; uiDir: string;
  /** Prepare's engine; its routes answer 404 without it. */
  preparation?: PreparationEngine;
  /** The port the service listens on: only requests addressed to this machine on it are answered. */
  port: number;
}) {
  const app = new Hono();

  // Only requests addressed to this machine itself, on the service's port, are answered. A web page
  // that points its own domain name at 127.0.0.1 (DNS rebinding) still sends its own name as Host.
  const ownHosts = new Set(["localhost", "127.0.0.1", "[::1]"].map((h) => `${h}:${port}`));
  app.use("*", async (c, next) => {
    const host = (c.req.header("host") ?? new URL(c.req.url).host).toLowerCase();
    if (!ownHosts.has(host)) return c.json({ error: "apply-kit only answers requests to this machine (localhost)" }, 403);
    return next();
  });

  // The Chrome extension. Everything under /api/ext needs the token it got when Kris paired it, except
  // pairing itself. The extension calls from its own pages with host permission for localhost, so no
  // CORS is ever granted: a web page can't send the JSON or the Authorization header these need.
  app.use("/api/ext/*", async (c, next) => {
    if (c.req.path === "/api/ext/pair") return next();
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? "";
    if (!pairing.verify(token)) {
      return c.json({ problem: "not-paired", error: "This extension isn't paired with apply-kit. Pair it again from the app." }, 401);
    }
    return next();
  });

  // The extension trades the code the app shows for its token: { code, name }.
  app.post("/api/ext/pair", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const code = typeof body.code === "string" ? body.code : "";
    const name = typeof body.name === "string" ? body.name : "Chrome extension";
    const result = pairing.pair(code, name);
    if (result.ok) return c.json({ token: result.token, deviceId: result.deviceId }, 201);
    return c.json({ problem: result.problem, error: pairProblems[result.problem] }, 400);
  });

  app.get("/api/ext/status", (c) => c.json({ app: "apply-kit", paired: true }));

  // { url, html, frames? }: the page Kris is viewing, read by the extension when Kris clicked.
  app.post("/api/ext/capture/preview", (c) => withPage(c, (page) => engine.previewCapture(page)));
  app.post("/api/ext/capture", (c) => withPage(c, async (page) => {
    const report = await engine.capturePage(page);
    // Search results carry no posting text; anything readable is read in the background, within the budget.
    engine.readPending().catch((err: unknown) => console.error("Reading postings failed:", err));
    return report;
  }, 201));

  // The app's side of pairing: show a code, list paired extensions, forget one.
  app.post("/api/pairing", (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    return c.json(pairing.startPairing(), 201);
  });
  app.get("/api/pairing/devices", (c) => c.json(pairing.devices()));
  app.post("/api/pairing/devices/:id/unpair", (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    pairing.unpair(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/api/feed", async (c) => {
    const v = c.req.query("view") ?? "new";
    if (!views.includes(v as FeedView)) return c.json({ error: `Unknown view "${v}"` }, 400);
    const sort = c.req.query("sort") ?? "fit";
    if (!sorts.includes(sort as FeedSort)) return c.json({ error: `Unknown sort "${sort}"` }, 400);
    const relocation = c.req.query("relocation") === "1";
    const feed = await engine.queryFeed({ view: v as FeedView, sort: sort as FeedSort, relocation });
    // Each row carries its Job's package chip ("Continue package · step 2 of 5", "Package ready"), or null.
    const chips = preparation?.packageChips(feed.jobs.map((j) => j.id)) ?? {};
    return c.json({ ...feed, jobs: feed.jobs.map((j) => ({ ...j, package: chips[j.id] ?? null })) });
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
    withIds(c, (body, ids) => engine.pass(ids, {
      reason: body.reason as PassReason | null,
      note: typeof body.note === "string" ? body.note : null,
      // "Rank jobs like this lower": only when Kris ticked it (exactly true).
      learn: body.learn === true,
      requirement: typeof body.requirement === "string" ? body.requirement : null,
    })));
  app.post("/api/jobs/reopen", (c) => withIds(c, (body, ids) => engine.reopen(ids)));
  app.post("/api/decisions/:id/undo", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const ids = body.jobIds === undefined ? undefined : stringArray(body.jobIds);
    if (ids === null) return c.json({ error: "jobIds must be a list of job ids" }, 400);
    return c.json(await engine.undo(c.req.param("id"), ids));
  });

  // Dealbreakers. "Show this job" is a Decision like the others (undo hides it again).
  app.post("/api/jobs/unhide", (c) => withIds(c, (body, ids) => engine.unhide(ids, { learn: body.learn === true })));

  // Learned ranking adjustments: listed with what created each, undoable one by one. A boost is
  // created from a Job ("Boost new Kestrel security jobs").
  app.get("/api/adjustments", async (c) => c.json(await engine.learnedAdjustments()));
  app.post("/api/adjustments/:id/undo", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    try {
      return c.json(await engine.undoAdjustment(c.req.param("id")));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });
  app.post("/api/jobs/:id/boost", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    try {
      return c.json(await engine.boost(c.req.param("id")), 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });
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

  // Coverage checks: record one ({ site, query, location?, resultCount?, listings?, resultsUrl? },
  // listings as pasted text or a list), the history (newest first, whether one is due), and one check.
  app.post("/api/coverage", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const text = (v: unknown) => (typeof v === "string" ? v : undefined);
    const listings = typeof body.listings === "string" || Array.isArray(body.listings) ? body.listings as CoverageInput["listings"] : undefined;
    const resultCount = body.resultCount == null || body.resultCount === "" ? null : Number(body.resultCount);
    try {
      return c.json(await engine.recordCoverageCheck({
        site: text(body.site) ?? "", query: text(body.query) ?? "", location: text(body.location) ?? null,
        resultCount, listings, resultsUrl: text(body.resultsUrl) ?? null,
      }), 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
  app.get("/api/coverage", async (c) => c.json(await engine.coverageHistory()));
  app.get("/api/coverage/:id", async (c) => {
    const check = await engine.getCoverageCheck(c.req.param("id"));
    return check ? c.json(check) : c.json({ error: "No such coverage check" }, 404);
  });

  // Developer route: the fictional demo profile printed by the real template, for checking it by eye
  // (?language=en|bg&photo=1). /check shows what the parse check read back from the same PDF.
  const demo = async (c: Context) => {
    const kind = c.req.param("kind");
    const language = c.req.query("language") ?? "en";
    if (!preparation || !documentKinds.includes(kind as DocumentKind)) return c.json({ error: "No such document: cv or cover-letter" }, 404);
    if (!documentLanguages.includes(language as DocumentLanguage)) return c.json({ error: "language must be en or bg" }, 400);
    return preparation.demoDocument({ kind: kind as DocumentKind, language: language as DocumentLanguage, photo: c.req.query("photo") === "1" });
  };
  app.get("/api/dev/documents/:kind", async (c) => {
    const draft = await demo(c);
    if (draft instanceof Response) return draft;
    return c.body(Buffer.from(draft.pdf), 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${draft.fileName}"`,
    });
  });
  app.get("/api/dev/documents/:kind/check", async (c) => {
    const draft = await demo(c);
    if (draft instanceof Response) return draft;
    return c.json({ ...draft, pdf: undefined });
  });

  // Profile: the master profile's pieces, contact details, section counts and export.
  if (preparation) mountProfileApi(app, preparation);
  if (preparation) mountImportApi(app, preparation);
  // Profile's answer bank: the table, Add and Edit answer, Delete, and portal edits to keep or not.
  if (preparation) mountAnswerApi(app, preparation);
  // Profile's voice: samples, the rules learned, and the "Learn from my edits" switch.
  if (preparation) mountVoiceApi(app, preparation);
  // Packages: the Prepare button, starting a package, its steps, parts and the CV draft.
  if (preparation) mountPackageApi(app, engine, preparation);

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // The built UI (pnpm start). In dev, Vite serves the UI and proxies /api here.
  // index.html (the only HTML it serves) is never cached, so a rebuilt UI shows at once; the hashed
  // assets it names may be.
  app.use("/*", async (c, next) => {
    await next();
    if (c.res.headers.get("content-type")?.startsWith("text/html")) c.res.headers.set("cache-control", "no-cache");
  });
  app.use("/*", serveStatic({ root: uiDir }));
  app.get("/*", serveStatic({ root: uiDir, path: "index.html" }));

  return app;
}

type Body = Record<string, unknown>;

const pairProblems = {
  "no-code": "There's no pairing code waiting. In apply-kit, choose Pair the extension to get one.",
  expired: "That code has expired. In apply-kit, choose Pair the extension for a new one.",
  "wrong-code": "That isn't the code apply-kit shows. Check it and try again.",
} as const;

/** A JSON-only POST carrying a captured page: { url, html, frames? }. */
async function withPage(c: Context, act: (page: CapturedPage) => Promise<unknown>, status: 200 | 201 = 200) {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
  if (typeof body.url !== "string" || typeof body.html !== "string") return c.json({ error: "Send the page's url and html" }, 400);
  const frames = Array.isArray(body.frames)
    ? body.frames.flatMap((f: unknown) => {
        const o = f as { id?: unknown; html?: unknown } | null;
        return o && typeof o.html === "string" ? [{ id: typeof o.id === "string" ? o.id : null, html: o.html }] : [];
      })
    : [];
  return c.json(await act({ url: body.url, html: body.html, frames }), status);
}

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
