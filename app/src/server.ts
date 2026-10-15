import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { stream } from "hono/streaming";
import type { Context } from "hono";
import { TrackerError, angles, maxCvBytes } from "@apply-kit/core";
import type {
  RejectionReason,
  AddApplicationInput, CapturedPage, EmailAnswer, CoverageInput, DiscoveryEngine, DocumentKind, DocumentLanguage, FactAnswer, FeedSort, FeedView, GroupKey,
  Pairing, PassReason, PastedPosting, PreparationEngine, Scheduler, Status, StatusFilter, Tracker, Angle,
} from "@apply-kit/core";
import { mountImportApi } from "./import-api.ts";
import { mountAnswerApi } from "./answers-api.ts";
import { mountPackageApi } from "./packages-api.ts";
import { mountProfileApi } from "./profile-api.ts";
import { mountSetupApi } from "./setup-api.ts";
import { mountInterviewApi } from "./interview-api.ts";
import { mountVoiceApi } from "./voice-api.ts";

const documentKinds: DocumentKind[] = ["cv", "cover-letter"];
const documentLanguages: DocumentLanguage[] = ["en", "bg"];
const views: FeedView[] = ["new", "saved", "open", "passed", "hidden"];
const sorts: FeedSort[] = ["fit", "newest"];
const groupKeys: GroupKey[] = ["accepted", "offer", "interviewing", "screening", "applied", "closed"];
/** Applications groups over this many rows are paged ("Applied 1–25 of 47"). */
const applicationPageSize = 25;

export function createServer({ engine, preparation, tracker, scheduler, pairing, uiDir, port }: {
  engine: DiscoveryEngine; tracker: Tracker; scheduler: Scheduler; pairing: Pairing; uiDir: string;
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
    // Each row carries its Job's package chip ("Continue package · step 2 of 5", "Package ready"), or null,
    // and Track's markers for the listed Jobs: "Applied <date> · <Status>", or the same company recently.
    const chips = preparation?.packageChips(feed.jobs.map((j) => j.id)) ?? {};
    return c.json({
      ...feed,
      jobs: feed.jobs.map((j) => ({ ...j, package: chips[j.id] ?? null })),
      markers: await tracker.jobMarkers(feed.jobs.map((j) => j.id)),
    });
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
    if (!job) return c.json({ error: "No such job" }, 404);
    // With what Track knows: this Job's Application and the History with its company.
    return c.json({ ...job, track: (await tracker.jobMarkers([job.id]))[job.id] ?? null });
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

  // The follow-up delays (Track): a nudge after applying, the note to self after an Offer, snooze.
  app.get("/api/settings/follow-ups", async (c) => c.json(await tracker.followUpSettings()));
  app.put("/api/settings/follow-ups", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    try {
      return c.json(await tracker.saveFollowUpSettings(body));
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
  if (preparation) mountSetupApi(app, preparation);
  if (preparation) mountInterviewApi(app, preparation);
  // Profile's answer bank: the table, Add and Edit answer, Delete, and portal edits to keep or not.
  if (preparation) mountAnswerApi(app, preparation);
  // Profile's voice: samples, the rules learned, and the "Learn from my edits" switch.
  if (preparation) mountVoiceApi(app, preparation);
  // Packages: the Prepare button, starting a package, its steps, parts and the CV draft.
  if (preparation) mountPackageApi(app, engine, preparation);

  // Applications (Track). The list grouped by Status: ?all=applied,closed shows every row of those
  // groups; ?paged=1 pages groups over 25 rows, from ?at=applied:25,closed:50; ?q= searches; ?status=
  // (open or a group), ?angle= and ?within= (days) filter. Jobs to pick when adding (?q=), and one
  // Application in full (its page).
  app.get("/api/applications", async (c) => {
    const all = (c.req.query("all") ?? "").split(",").filter(Boolean) as GroupKey[];
    const at = Object.fromEntries((c.req.query("at") ?? "").split(",").flatMap((p) => {
      const [k, n] = p.split(":");
      return k && Number(n) >= 0 ? [[k, Number(n)]] : [];
    })) as Partial<Record<GroupKey, number>>;
    const status = c.req.query("status");
    const angle = c.req.query("angle");
    const within = Number(c.req.query("within"));
    return c.json(await tracker.list({
      limits: Object.fromEntries(all.map((k) => [k, Number.MAX_SAFE_INTEGER])),
      pageSize: c.req.query("paged") ? applicationPageSize : null,
      offsets: at,
      search: c.req.query("q") ?? null,
      status: status === "open" || groupKeys.includes(status as GroupKey) ? (status as StatusFilter) : null,
      angle: angles.includes(angle as Angle) ? (angle as Angle) : null,
      appliedWithinDays: Number.isInteger(within) && within > 0 ? within : null,
    }));
  });
  // A visit to Applications: records it and returns "Since your last visit" (Status changes made by email).
  app.post("/api/applications/visit", async (c) => c.json(await tracker.visit()));
  // The Stats strip: applications per week with the pace, response rate, interviews, what's working.
  app.get("/api/applications/stats", async (c) => c.json(await tracker.stats()));
  app.get("/api/applications/jobs", async (c) => c.json(await tracker.findJobs(c.req.query("q") ?? "")));
  // Emails waiting in Needs you ("Email to match"), and the job mailbox's state for Applications' banners.
  app.get("/api/applications/emails", async (c) => c.json(await tracker.emailsToMatch()));
  app.get("/api/applications/mailbox", async (c) => c.json(await tracker.mailbox()));
  // Needs you: follow-ups due, most urgent first, the count for the top bar's badge, and Coming up.
  app.get("/api/applications/needs-you", async (c) => c.json(await tracker.needsYou()));
  // The withdrawals of the offer accepted (still to send, and sent), for the withdrawal dialog.
  app.get("/api/applications/withdrawals", async (c) => c.json(await tracker.withdrawals()));
  app.get("/api/applications/:id", async (c) => {
    const a = await tracker.get(c.req.param("id"));
    return a ? c.json(a) : c.json({ error: "No such application" }, 404);
  });
  // Offers and closing: accept (Accepted, with withdrawals to send), decline (Withdrawn, "declined offer") and its
  // optional draft, the offer's details ({ baseSalary, startDate, workPattern, contract, other }) and a rejection's
  // optional lesson and likely reason ({ lesson, reason }).
  app.post("/api/applications/:id/accept", async (c) => trackerCall(c, () => tracker.acceptOffer(c.req.param("id"))));
  app.post("/api/applications/:id/decline", async (c) => trackerCall(c, () => tracker.declineOffer(c.req.param("id"))));
  app.get("/api/applications/:id/decline-draft", async (c) => trackerCall(c, () => tracker.declineDraft(c.req.param("id"))));
  app.put("/api/applications/:id/offer", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const details = Object.fromEntries((["baseSalary", "startDate", "workPattern", "contract", "other"] as const)
      .filter((k) => k in body).map((k) => [k, typeof body[k] === "string" ? body[k] : null]));
    return trackerCall(c, () => tracker.saveOfferDetails(c.req.param("id"), details));
  });
  app.put("/api/applications/:id/rejection", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    return trackerCall(c, () => tracker.saveRejectionNote(c.req.param("id"), {
      lesson: typeof body.lesson === "string" ? body.lesson : null,
      reason: typeof body.reason === "string" ? (body.reason as RejectionReason) : null,
    }));
  });
  // A note ({ text }) and a contact address or domain ({ value }) on one Application.
  app.post("/api/applications/:id/notes", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    return trackerCall(c, () => tracker.addNote(c.req.param("id"), typeof body.text === "string" ? body.text : ""), 201);
  });
  app.post("/api/applications/:id/contacts", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    return trackerCall(c, () => tracker.addContact(c.req.param("id"), typeof body.value === "string" ? body.value : ""), 201);
  });
  // The CV sent with one added by hand: PUT the PDF itself (Content-Type: application/pdf, which a
  // web page can't send here without asking first), ?name= its file name, &label= its CV version.
  app.put("/api/applications/:id/cv", async (c) => {
    if (c.req.header("content-type") !== "application/pdf") return c.json({ error: "Send the CV as Content-Type: application/pdf" }, 415);
    if (Number(c.req.header("content-length") ?? 0) > maxCvBytes) return c.json({ problem: "invalid", error: "That PDF is over 10 MB. Attach a smaller export of your CV." }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return trackerCall(c, () => tracker.attachCv(c.req.param("id"), { fileName: c.req.query("name") ?? "", label: c.req.query("label") ?? null, bytes }), 201);
  });
  app.get("/api/applications/:id/cv", async (c) => {
    const file = await tracker.cvFile(c.req.param("id"));
    if (!file) return c.json({ error: "No CV attached" }, 404);
    return c.body(new Uint8Array(file.bytes), 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  });

  // "Add application" and "I applied": { job: { jobId } | { company, title, link? }, appliedOn, status, contact?, how? }.
  // Added: 201. Already open for that Job: 200 with the existing one. Invalid: 422 naming the field.
  app.post("/api/applications", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const j = (body.job && typeof body.job === "object" ? body.job : {}) as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    const input: AddApplicationInput = {
      job: typeof j.jobId === "string" ? { jobId: j.jobId } : { company: text(j.company), title: text(j.title), link: text(j.link) || null },
      appliedOn: text(body.appliedOn), status: text(body.status) as Status,
      contact: text(body.contact) || null, how: body.how === "i-applied" ? "i-applied" : "by-hand",
    };
    const result = await tracker.addByHand(input);
    if (result.outcome === "invalid") return c.json({ ...result, error: result.message }, 422);
    return c.json(result, result.outcome === "added" ? 201 : 200);
  });

  // Quick Status change: { status }. An Event "by you", undone with POST /api/applications/events/:id/undo.
  app.post("/api/applications/:id/status", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    return trackerCall(c, () => tracker.setStatus(c.req.param("id"), String(body.status) as Status));
  });
  app.post("/api/applications/events/:id/undo", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    return trackerCall(c, () => tracker.undoEvent(c.req.param("id")));
  });
  // "Looks right" on the moved-by-email banner: the banner goes, the move and the email stay.
  app.post("/api/applications/events/:id/looks-right", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    return trackerCall(c, async () => { await tracker.confirmEmailMove(c.req.param("id")); return { ok: true }; });
  });

  // Your answer to an email to match:
  // { choice: "application", applicationId, move } | { choice: "new", move } | { choice: "none" }.
  // No choice: 422 "Choose where this email belongs first."
  app.post("/api/applications/emails/:id/answer", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const answer = (body.choice === "application"
      ? { choice: "application", applicationId: typeof body.applicationId === "string" ? body.applicationId : "", move: body.move === true }
      : body.choice === "new" ? { choice: "new", move: body.move === true }
      : body.choice === "none" ? { choice: "none" }
      : {}) as EmailAnswer;
    return trackerCall(c, () => tracker.answerEmail(c.req.param("id"), answer));
  });

  // One follow-up: its outline and text (GET), the text as typed (PUT { text }), and what the user did:
  // sent from their own mail, skipped, or snoozed. Each of those is an Event, undone like any other.
  app.get("/api/follow-ups/:id", async (c) => {
    const draft = await tracker.followUp(c.req.param("id"));
    return draft ? c.json(draft) : c.json({ error: "No such follow-up" }, 404);
  });
  app.put("/api/follow-ups/:id/text", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    return trackerCall(c, () => tracker.saveFollowUpText(c.req.param("id"), typeof body.text === "string" ? body.text : ""));
  });
  const followUpActions = { sent: tracker.markFollowUpSent, skip: tracker.skipFollowUp, snooze: tracker.snoozeFollowUp } as const;
  for (const [path, act] of Object.entries(followUpActions)) {
    app.post(`/api/follow-ups/:id/${path}`, async (c) => {
      if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
      return trackerCall(c, () => act(c.req.param("id")));
    });
  }

  // The thank-you note's topic (PUT { topic }): one thing discussed, which makes the note specific.
  app.put("/api/follow-ups/:id/topic", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    return trackerCall(c, () => tracker.saveFollowUpTopic(c.req.param("id"), typeof body.topic === "string" ? body.topic : ""));
  });

  // Interviews: add one by hand, or edit one ({ interviewId? , start, end, timeZone, format, place, people, round, notes };
  // times are "YYYY-MM-DDTHH:mm" in timeZone), and its calendar file.
  app.post("/api/applications/:id/interviews", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const text = (v: unknown) => (typeof v === "string" ? v : null);
    const format = body.format === "video" || body.format === "phone" || body.format === "onsite" ? body.format : null;
    return trackerCall(c, () => tracker.setInterview(c.req.param("id"), {
      interviewId: text(body.interviewId) ?? undefined, start: text(body.start), end: text(body.end), timeZone: text(body.timeZone) ?? "",
      format, place: text(body.place), people: stringArray(body.people) ?? [], round: text(body.round), notes: text(body.notes),
    }), body.interviewId ? 200 : 201);
  });
  app.get("/api/interviews/:id/ics", async (c) => {
    const file = await tracker.interviewIcs(c.req.param("id"));
    if (!file) return c.json({ error: "No such interview with a time" }, 404);
    return c.body(file.text, 200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  });

  // The prep sheet: GET it ({ sheet: null } until built), POST to build it (once, within the AI budget;
  // 409 "budget" when it can't), a practised mark ({ practised }) and your own story ({ text }) per question.
  app.get("/api/applications/:id/prep", async (c) => c.json({ sheet: await tracker.prepSheet(c.req.param("id")) }));
  app.post("/api/applications/:id/prep", async (c) => {
    if (!jsonOnly(c.req.header("content-type"))) return c.json({ error: "Send Content-Type: application/json" }, 415);
    return trackerCall(c, async () => ({ sheet: await tracker.buildPrepSheet(c.req.param("id")) }));
  });
  app.post("/api/applications/:id/prep/:question/practised", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    return trackerCall(c, async () => ({ sheet: await tracker.markPractised(c.req.param("id"), c.req.param("question"), body.practised === true) }));
  });
  app.post("/api/applications/:id/prep/:question/story", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    return trackerCall(c, async () => ({ sheet: await tracker.addPrepStory(c.req.param("id"), c.req.param("question"), typeof body.text === "string" ? body.text : "") }));
  });

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

/** Runs a tracker change; a refusal answers 404 (not found), 422 (invalid input) or 409 with its problem and words. */
async function trackerCall(c: Context, act: () => Promise<unknown>, ok: 200 | 201 = 200) {
  try {
    return c.json(await act(), ok);
  } catch (err) {
    if (!(err instanceof TrackerError)) throw err;
    const status = err.problem === "not-found" ? 404 : err.problem === "invalid" ? 422 : 409;
    return c.json({ problem: err.problem, error: err.message, applicationId: err.applicationId }, status);
  }
}

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
