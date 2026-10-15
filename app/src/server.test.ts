import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createAiBudget, createEngine, createPairing, createPreparationEngine, type DocumentToRender, type Scheduler } from "@apply-kit/core";
import { createServer } from "./server.ts";

const port = 4310;

// The service as the extension and the UI see it: an in-memory engine, no network, a fixed clock.
function service(uiDir = "/nonexistent/") {
  const db = new DatabaseSync(":memory:");
  const clock = { now: () => new Date("2026-10-12T07:30:00Z") };
  const engine = createEngine({
    db, clock,
    fetch: async () => { throw new Error("no network in tests"); },
    extractor: { estimateCostUsd: () => 0, extract: async () => { throw new Error("no AI in tests"); } },
    mailReader: { fetchSince: async () => [] },
  });
  const noAi = () => { throw new Error("no AI in tests"); };
  const noFiles = () => { throw new Error("no files in these tests"); };
  const stored = new Map<string, Uint8Array>();
  const preparation = createPreparationEngine({
    db, clock, budget: createAiBudget({ db, clock, capUsd: 0 }),
    writer: { estimateCostUsd: () => 0, draftPieces: async () => noAi(), learnVoice: async () => noAi(), tailorCv: async () => noAi(), coachTurn: async () => noAi() },
    renderer: { render: async () => noAi() },
    pdfReader: { read: async () => noAi() },
    files: {
      put: async (bytes) => { const sha256 = String(stored.size).padStart(64, "0"); stored.set(sha256, bytes); return { sha256, size: bytes.byteLength }; },
      get: async (sha256) => stored.get(sha256) ?? null,
      remove: async (sha256) => { stored.delete(sha256); },
    },
    packages: { saveDraft: async () => noFiles(), read: async () => null },
  });
  const pairing = createPairing({ db, clock });
  const scheduler = { status: () => ({}), checkNow: async () => ({}) } as unknown as Scheduler;
  const app = createServer({ engine, preparation, scheduler, pairing, uiDir, port });
  const json = (body: unknown, headers: Record<string, string> = {}) => ({
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  // Requests as a browser on this machine sends them: to the service's own address and port.
  const request = (path: string, init?: RequestInit) => app.request(`http://127.0.0.1:${port}${path}`, init);
  return { app, json, engine, preparation, request };
}

/** A synthetic job search page with one listing (made-up company). */
const page = {
  url: "https://www.linkedin.com/jobs/search/?keywords=security",
  html: `<ul><li data-occludable-job-id="4100000001"><div class="job-card-container" data-job-id="4100000001">
    <a class="job-card-list__title--link" href="/jobs/view/4100000001/"><strong>Security Engineer</strong></a>
    <div class="artdeco-entity-lockup__subtitle">Kestrel Payments</div></div></li></ul>`,
};

async function paired(s: ReturnType<typeof service>): Promise<string> {
  const { code } = (await (await s.request("/api/pairing", s.json({}))).json()) as { code: string };
  const res = await s.request("/api/ext/pair", s.json({ code, name: "Chrome" }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

describe("the extension's side of the service", () => {
  it("rejects every capture request from an extension that isn't paired", async () => {
    const s = service();

    const none = await s.request("/api/ext/capture", s.json(page));
    const wrong = await s.request("/api/ext/capture", s.json(page, { authorization: "Bearer not-a-token" }));
    const status = await s.request("/api/ext/status");

    for (const res of [none, wrong, status]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ problem: "not-paired" });
    }
    expect((await s.engine.queryFeed({ view: "new" })).jobs).toHaveLength(0);
  });

  it("pairs with the code the app shows, then previews and captures pages", async () => {
    const s = service();
    const token = await paired(s);
    const auth = { authorization: `Bearer ${token}` };

    const status = await s.request("/api/ext/status", { headers: auth });
    expect(await status.json()).toEqual({ app: "apply-kit", paired: true });

    const preview = await (await s.request("/api/ext/capture/preview", s.json(page, auth))).json();
    expect(preview).toMatchObject({ kind: "search", counts: { new: 1 } });
    expect((await s.engine.queryFeed({ view: "new" })).jobs).toHaveLength(0);

    const captured = await s.request("/api/ext/capture", s.json(page, auth));
    expect(captured.status).toBe(201);
    expect(await captured.json()).toMatchObject({ source: "Captured · LinkedIn", counts: { new: 1 } });
    expect((await s.engine.queryFeed({ view: "new" })).jobs.map((j) => j.title)).toEqual(["Security Engineer"]);
  });

  it("refuses a wrong pairing code, and a token stops working once the extension is unpaired", async () => {
    const s = service();
    await s.request("/api/pairing", s.json({}));
    const wrong = await s.request("/api/ext/pair", s.json({ code: "not the code", name: "Chrome" }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ problem: "wrong-code" });

    const token = await paired(s);
    const devices = (await (await s.request("/api/pairing/devices")).json()) as { id: string }[];
    await s.request(`/api/pairing/devices/${encodeURIComponent(devices[0]!.id)}/unpair`, s.json({}));

    const after = await s.request("/api/ext/status", { headers: { authorization: `Bearer ${token}` } });
    expect(after.status).toBe(401);
  });

  it("asks for JSON, so no web page can post to it without a preflight it never grants", async () => {
    const s = service();
    const token = await paired(s);

    const form = await s.request("/api/ext/capture", {
      method: "POST", headers: { "content-type": "text/plain", authorization: `Bearer ${token}` }, body: JSON.stringify(page),
    });
    expect(form.status).toBe(415);
    const preflight = await s.request("/api/ext/capture", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("only this machine's own address", () => {
  it("answers requests to localhost, 127.0.0.1 and [::1] on the service's port", async () => {
    const s = service();
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
      const res = await s.request("/api/feed", { headers: { host } });
      expect(res.status, host).toBe(200);
    }
  });

  it("refuses any other host with 403, so a web page can't reach it through DNS rebinding", async () => {
    const s = service();
    for (const host of ["evil.example", `evil.example:${port}`, "localhost:9999", "127.0.0.1", `localhost.evil.example:${port}`]) {
      const read = await s.request("/api/feed", { headers: { host } });
      const write = await s.request("/api/jobs/link", { ...s.json({ link: "https://example.com/jobs/1" }), headers: { "content-type": "application/json", host } });
      expect([read.status, write.status], host).toEqual([403, 403]);
    }
    expect((await s.engine.queryFeed({ view: "new" })).jobs).toHaveLength(0);
  });
});

describe("the UI's files", () => {
  function built() {
    const dir = mkdtempSync(join(tmpdir(), "apply-kit-ui-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>apply-kit</title><script src=\"/assets/index-abc123.js\"></script>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log('ui')");
    return service(dir);
  }

  it("serves index.html (for any app route) without browser caching, so a rebuild shows at once", async () => {
    const s = built();
    for (const path of ["/", "/index.html", "/jobs/job:greenhouse:payhawkio:1"]) {
      const res = await s.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain("<title>apply-kit</title>");
      expect(res.headers.get("cache-control"), path).toBe("no-cache");
    }
  });

  it("leaves the hashed assets cacheable", async () => {
    const s = built();
    const res = await s.request("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).not.toBe("no-cache");
  });
});

describe("the app's routes", () => {
  it("answers the Feed, and refuses an unknown view", async () => {
    const s = service();

    const feed = await s.request("/api/feed?view=new");
    const bad = await s.request("/api/feed?view=everything");

    expect(feed.status).toBe(200);
    expect(await feed.json()).toMatchObject({ view: "new", firstRun: true, jobs: [] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Unknown view "everything"' });
  });

  it("adds a Source and lists it on Sources; refuses one it can't read", async () => {
    const s = service();

    const added = await s.request("/api/sources", s.json({ kind: "greenhouse", config: "payhawkio", name: "Payhawk" }));
    const bad = await s.request("/api/sources", s.json({ kind: "monster", config: "x" }));
    const sources = (await (await s.request("/api/sources")).json()) as { sources: { id: string; name: string }[] };

    expect(added.status).toBe(201);
    expect(await added.json()).toEqual({ id: "greenhouse:payhawkio", kind: "greenhouse", name: "Payhawk" });
    expect(bad.status).toBe(400);
    expect(sources.sources.map((x) => [x.id, x.name])).toEqual([["greenhouse:payhawkio", "Payhawk"]]);
  });

  it("adds a pasted job, opens it, and saves, passes and undoes it", async () => {
    const s = service();
    const pasted = { title: "Security Engineer", company: "Kestrel Payments", location: "Sofia", text: "Protect payments.\n3+ years in security." };

    const link = await s.request("/api/jobs/link", s.json({ link: "https://www.linkedin.com/jobs/view/4100000001/", pasted }));
    const { jobId } = (await link.json()) as { jobId: string };
    const job = await s.request(`/api/jobs/${encodeURIComponent(jobId)}`);
    const saved = (await (await s.request("/api/jobs/save", s.json({ jobIds: [jobId] }))).json()) as { id: string };
    const passed = (await (await s.request("/api/jobs/pass", s.json({ jobIds: [jobId], reason: "salary" }))).json()) as { id: string; jobIds: string[] };
    const undone = await (await s.request(`/api/decisions/${encodeURIComponent(passed.id)}/undo`, s.json({}))).json();

    expect(link.status).toBe(201);
    expect(await job.json()).toMatchObject({ id: jobId, title: "Security Engineer", company: "Kestrel Payments" });
    expect(saved.id).toMatch(/^decision:/);
    expect(passed.jobIds).toEqual([jobId]);
    expect(undone).toEqual({ jobIds: [jobId], sourceIds: [] });
    expect((await s.engine.queryFeed({ view: "saved" })).jobs.map((j) => j.id)).toEqual([jobId]);
  });

  it("says when a job doesn't exist, and asks for JSON on every change", async () => {
    const s = service();

    const missing = await s.request("/api/jobs/job:nope");
    const form = await s.request("/api/jobs/save", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "jobIds=x" });
    const noIds = await s.request("/api/jobs/save", s.json({ jobIds: [] }));

    expect(missing.status).toBe(404);
    expect(form.status).toBe(415);
    expect(noIds.status).toBe(400);
  });
});

describe("Profile's API", () => {
  it("answers a refused piece with its problems and honest fixes, and keeps a saved one", async () => {
    const s = service();

    const refused = await s.request("/api/profile/pieces", s.json({ kind: "achievement", text: "Triaged 25 alerts a day." }));
    const saved = await s.request("/api/profile/pieces", s.json({ kind: "achievement", text: "Triaged 25 alerts a day.", numberSource: "estimate" }));

    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ saved: false, problems: [{ field: "numberSource", message: "This piece has a number, so pick where it comes from.", fixes: [] }] });
    expect(saved.status).toBe(201);
    expect(s.preparation.profileSummary()).toMatchObject({ pieces: 1, confirmed: 1 });
  });

  it("only deletes a piece through a JSON request", async () => {
    const s = service();
    const saved = s.preparation.savePiece({ kind: "skill", text: "Python" });
    if (!saved.saved) throw new Error("not saved");
    const path = `/api/profile/pieces/${encodeURIComponent(saved.piece.id)}/delete`;

    const form = await s.request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" });
    const json = await s.request(path, s.json({}));

    expect(form.status).toBe(415);
    expect(await json.json()).toEqual({ deleted: true, untied: 0 });
    expect(s.preparation.profileSummary().pieces).toBe(0);
  });

  it("saves an angle's summary line and lead order, answering a refused lead with its problem", async () => {
    const s = service();
    const piece = s.preparation.savePiece({ kind: "skill", text: "Wireshark", angles: ["security"] });
    if (!piece.saved) throw new Error("not saved");

    const refused = await s.request("/api/profile/angles/security", { ...s.json({ leads: ["piece:gone"] }), method: "PUT" });
    const saved = await s.request("/api/profile/angles/security", { ...s.json({ summary: "Analyst who reads packets.", leads: [piece.piece.id] }), method: "PUT" });
    const unknown = await s.request("/api/profile/angles/marketing", { ...s.json({ summary: "x" }), method: "PUT" });
    const list = await s.request("/api/profile/angles");

    expect(refused.status).toBe(422);
    expect(saved.status).toBe(200);
    expect(unknown.status).toBe(404);
    expect(((await list.json()) as unknown[])[1]).toMatchObject({ angle: "security", summary: "Analyst who reads packets.", leads: [{ text: "Wireshark" }] });
  });

  it("exports the profile as a JSON file to download", async () => {
    const s = service();
    s.preparation.savePiece({ kind: "skill", text: "Python" });

    const res = await s.request("/api/profile/export");

    expect(res.headers.get("content-disposition")).toBe('attachment; filename="apply-kit-profile-2026-10-12.json"');
    expect(await res.json()).toMatchObject({ format: "apply-kit master profile", pieces: [expect.objectContaining({ text: "Python" })] });
  });
});

describe("the Package's API", () => {
  it("says why a package can't start for an unread job, refuses to start it, and has no package to show", async () => {
    const s = service();
    const added = await s.engine.addJobLink("https://kestrel.example.com/jobs/security-engineer", {
      title: "Security Engineer", company: "Kestrel Payments", text: "Security Engineer at Kestrel Payments. Experience with a SIEM.",
    });
    if (!("jobId" in added)) throw new Error("not added");
    const jobId = encodeURIComponent(added.jobId as string);

    const status = await s.request(`/api/jobs/${jobId}/prepare`);
    const start = await s.request(`/api/jobs/${jobId}/package`, s.json({}));
    const form = await s.request(`/api/jobs/${jobId}/package`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" });
    const feed = await (await s.request("/api/feed?view=new")).json() as { jobs: { package: unknown }[] };

    expect(await status.json()).toMatchObject({ canStart: false, problem: "not-read", package: null });
    expect(start.status).toBe(422);
    expect(form.status).toBe(415);
    expect(feed.jobs.map((j) => j.package)).toEqual([null]);
    expect((await s.request("/api/packages/nope")).status).toBe(404);
    expect((await s.request("/api/packages/nope/cv/changes/c1/undo", s.json({}))).status).toBe(404);
    expect((await s.request("/api/packages/nope/cv/fit", s.json({ choice: "keep-two-pages" }))).status).toBe(404);
    expect((await s.request("/api/packages/nope/cv/flags/f1/decide", s.json({ option: "letter" }))).status).toBe(404);
    expect((await s.request("/api/packages/nope/cv/flags/f1/answer", s.json({ answer: "Once." }))).status).toBe(404);
    expect(await (await s.request("/api/profile/learned")).json()).toEqual([]);
    expect((await s.request("/api/profile/learned/confirm", { method: "POST", body: "" })).status).toBe(415);
  });
});

describe("the answer bank's API", () => {
  it("answers a refused answer with its problems, and lists a saved one", async () => {
    const s = service();
    const answer = { question: "Notice period", wordings: ["When could you start?"], versions: { en: "1 month", bg: "1 месец" }, category: "standard", kind: "text", mode: "fill" };

    const refused = await s.request("/api/profile/answers", s.json({ ...answer, versions: {} }));
    const saved = await s.request("/api/profile/answers", s.json(answer));
    const list = await s.request("/api/profile/answers?category=standard&q=notice");

    expect(refused.status).toBe(422);
    expect(saved.status).toBe(201);
    expect(await list.json()).toMatchObject({ total: 1, answers: [{ question: "Notice period", versions: { en: "1 month", bg: "1 месец" } }] });
  });

  it("resolves a portal edit and shows the history with the answer", async () => {
    const s = service();
    const r = s.preparation.saveAnswer({ question: "Kubernetes experience", versions: { en: "None in production." }, category: "screening" });
    if (!r.saved) throw new Error("not saved");
    s.preparation.recordPortalEdit(r.answer.id, { language: "en", text: "One personal k3s project.", portal: "Halden Systems Workday form" });
    const path = `/api/profile/answers/${encodeURIComponent(r.answer.id)}`;

    const resolved = await s.request(`${path}/portal-edit`, s.json({ keep: "keep-new" }));
    const detail = await (await s.request(path)).json();

    expect(resolved.status).toBe(200);
    expect(detail).toMatchObject({ answer: { versions: { en: "One personal k3s project." }, portalEdit: null }, history: [{ event: "changed", before: "None in production." }, { event: "created" }] });
    expect(s.preparation.profileSummary().needsYou.answerBank).toBe(0);
  });

  it("only deletes an answer through a JSON request", async () => {
    const s = service();
    const r = s.preparation.saveAnswer({ question: "Notice period", versions: { en: "1 month" }, category: "standard" });
    if (!r.saved) throw new Error("not saved");
    const path = `/api/profile/answers/${encodeURIComponent(r.answer.id)}/delete`;

    const form = await s.request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" });
    const json = await s.request(path, s.json({}));

    expect(form.status).toBe(415);
    expect(json.status).toBe(200);
    expect(s.preparation.answer(r.answer.id)).toBeNull();
  });
});

describe("developer route: the demo documents", () => {
  /** The service with a preparation engine whose renderer prints the document's title as its only line. */
  function withPreparation() {
    const db = new DatabaseSync(":memory:");
    const clock = { now: () => new Date("2026-10-12T07:30:00Z") };
    const engine = createEngine({
      db, clock,
      fetch: async () => { throw new Error("no network in tests"); },
      extractor: { estimateCostUsd: () => 0, extract: async () => { throw new Error("no AI in tests"); } },
      mailReader: { fetchSince: async () => [] },
    });
    const rendered: DocumentToRender[] = [];
    const preparation = createPreparationEngine({
      db, clock, budget: createAiBudget({ db, clock, capUsd: 10 }),
      writer: { estimateCostUsd: () => 0, draftPieces: async () => { throw new Error("no AI in tests"); }, learnVoice: async () => { throw new Error("no AI in tests"); }, tailorCv: async () => { throw new Error("no AI in tests"); }, coachTurn: async () => { throw new Error("no AI in tests"); } },
      renderer: { render: async (doc) => (rendered.push(doc), { pdf: new TextEncoder().encode(`%PDF ${doc.title}`), pages: 1 }) },
      pdfReader: { read: async (pdf) => ({ pages: [{ lines: [new TextDecoder().decode(pdf).slice(5)] }] }) },
      files: { put: async () => { throw new Error("unused"); }, get: async () => null, remove: async () => {} },
      packages: { saveDraft: async (id, _kind, name) => ({ path: `packages/${id}/${name}` }), read: async () => null },
    });
    const scheduler = { status: () => ({}) } as unknown as Scheduler;
    const app = createServer({ engine, preparation, scheduler, pairing: createPairing({ db, clock }), uiDir: "/nonexistent/", port });
    return { request: (path: string) => app.request(`http://127.0.0.1:${port}${path}`), rendered };
  }

  it("serves the demo CV as the PDF itself, named as it would be uploaded", async () => {
    const s = withPreparation();

    const res = await s.request("/api/dev/documents/cv?language=bg&photo=1");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="Nia_Koleva_CV_Kestrel_Payments_Security_Engineer.pdf"');
    expect(await res.text()).toBe("%PDF Ния Колева · CV · Кестрел Плащания");
    expect(s.rendered[0]).toMatchObject({ kind: "cv", language: "bg", content: { photo: { mediaType: "image/svg+xml" } } });
  });

  it("shows what the parse check read back from it", async () => {
    const s = withPreparation();

    const res = await s.request("/api/dev/documents/cover-letter/check");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      fileName: "Nia_Koleva_Cover_Letter_Kestrel_Payments_Security_Engineer.pdf", pages: 1, overflow: null, ats: null,
      text: { pages: [{ lines: ["Nia Koleva · Cover letter · Kestrel Payments"] }] },
    });
  });

  it("refuses a document or language the template doesn't have", async () => {
    const s = withPreparation();

    expect((await s.request("/api/dev/documents/resume")).status).toBe(404);
    expect((await s.request("/api/dev/documents/cv?language=de")).status).toBe(400);
  });
});

describe("Import's API", () => {
  it("starts an import from base64 files, and reports a file the model failed on with a retry", async () => {
    const s = service();
    const cv = { fileName: "mira-petrova-cv.txt", base64: Buffer.from("Mira Petrova\nSecurity Analyst, Northwind Bank").toString("base64") };

    const started = await s.request("/api/import", s.json({ files: [cv] }));
    expect(started.status).toBe(202);
    const { id } = (await started.json()) as { id: string };
    await new Promise((r) => setTimeout(r, 10));
    const status = await (await s.request("/api/import")).json();

    expect(status).toMatchObject({ id, state: "finished", items: [{ name: "mira-petrova-cv.txt", state: "unreadable", problem: { reason: "failed", options: ["retry", "skip"] } }] });
    expect((await s.request(`/api/import/${id}/cancel`, s.json({}))).status).toBe(200);
  });

  it("refuses an import with nothing in it, and a choice a file doesn't offer", async () => {
    const s = service();

    const empty = await s.request("/api/import", s.json({ files: [] }));
    const choice = await s.request("/api/import/items/import-item:gone", s.json({ action: "skip" }));

    expect(empty.status).toBe(422);
    expect(choice.status).toBe(422);
  });

  it("confirms a piece, or says what it still needs", async () => {
    const s = service();
    const piece = s.preparation.savePiece({ kind: "achievement", text: "Triaged 25 alerts a day." }, { from: "CV.pdf", quote: "Triaged 25 alerts a day.", status: "unconfirmed" });
    if (!piece.saved) throw new Error("not saved");

    const res = await s.request(`/api/profile/pieces/${encodeURIComponent(piece.piece.id)}/confirm`, s.json({}));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ saved: false, problems: [{ field: "numberSource" }] });
  });
});

describe("Voice's API", () => {
  const sample = (fileName: string, text: string) => ({ fileName, base64: Buffer.from(text).toString("base64") });

  it("adds samples from base64 files, shows an unreadable one with its reason, and removes one", async () => {
    const s = service();

    const added = await s.request("/api/profile/voice/samples", s.json({ files: [sample("about-page.txt", "I build small tools that make noisy systems quieter."), sample("letter.pages", "PK")] }));
    expect(added.status).toBe(201);
    const voice = (await (await s.request("/api/profile/voice")).json()) as { samples: { id: string; fileName: string; problem: { reason: string } | null }[] };
    expect(voice.samples.map((x) => [x.fileName, x.problem?.reason ?? null])).toEqual([["about-page.txt", null], ["letter.pages", "pages"]]);

    const removed = await s.request(`/api/profile/voice/samples/${encodeURIComponent(voice.samples[0]!.id)}/remove`, s.json({}));
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { samples: unknown[] }).samples).toHaveLength(1);
  });

  it("pauses and resumes learning from edits, and asks for JSON on every change", async () => {
    const s = service();

    const paused = await s.request("/api/profile/voice/learning", { ...s.json({ fromEdits: false }), method: "PUT" });
    expect(await paused.json()).toMatchObject({ learnFromEdits: false });
    expect(s.preparation.recordVoiceEdit({ purpose: "cover-letter", language: "en", before: "I am passionate.", after: "I fix noisy alerts." })).toBe(false);

    expect((await s.request("/api/profile/voice/rules/voice-rule:x/remove", { method: "POST" })).status).toBe(415);
    expect((await s.request("/api/profile/voice/rules/voice-rule:x/remove", s.json({}))).status).toBe(404);
  });
});

describe("the coach interview's API", () => {
  it("starts the interview at its first question, says when the coach can't answer, and refuses an empty answer", async () => {
    const s = service();
    s.preparation.savePiece({ kind: "role", text: "", entry: { title: "Junior Security Analyst", organisation: "Orbital Bank", city: "Sofia", start: "2021-03", end: "2025-12" } });

    const started = await s.request("/api/interview/start", s.json({}));
    expect(started.status).toBe(200);
    await s.preparation.interviewSettled();
    expect(await (await s.request("/api/interview")).json()).toMatchObject({ id: "setup", status: "failed", question: { kind: "gap" }, failure: { message: "no AI in tests" } });

    const refused = await s.request("/api/interviews/setup/answer", s.json({ text: "  " }));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ changed: false });
  });

  it("refuses an unknown angle or interview, and asks for JSON on every change", async () => {
    const s = service();

    expect((await s.request("/api/interview?angle=marketing")).status).toBe(400);
    expect((await s.request("/api/interviews/elsewhere/skip", s.json({}))).status).toBe(404);
    expect((await s.request("/api/interviews/setup/finish", { method: "POST" })).status).toBe(415);
    expect((await s.request("/api/interview/items/x/decide", s.json({ choice: "maybe" }))).status).toBe(400);
  });
});
