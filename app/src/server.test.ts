import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createEngine, createPairing, createTracker, type Scheduler } from "@apply-kit/core";
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
  const pairing = createPairing({ db, clock });
  const tracker = createTracker({ db, clock, discovery: engine });
  const scheduler = { status: () => ({}), checkNow: async () => ({}) } as unknown as Scheduler;
  const app = createServer({ engine, tracker, scheduler, pairing, uiDir, port });
  const json = (body: unknown, headers: Record<string, string> = {}) => ({
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  // Requests as a browser on this machine sends them: to the service's own address and port.
  const request = (path: string, init?: RequestInit) => app.request(`http://127.0.0.1:${port}${path}`, init);
  return { app, json, engine, request };
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

describe("the Applications routes", () => {
  it("adds an application by hand, lists it grouped, changes its Status and undoes that", async () => {
    const s = service();

    const added = await s.request("/api/applications", s.json({ job: { company: "Fennel Studio", title: "UX Engineer" }, appliedOn: "2026-10-09", status: "applied" }));
    expect(added.status).toBe(201);
    const { application } = (await added.json()) as { application: { id: string } };

    const changed = await s.request(`/api/applications/${encodeURIComponent(application.id)}/status`, s.json({ status: "screening" }));
    const { event } = (await changed.json()) as { event: { id: string } };
    expect((await (await s.request("/api/applications")).json()) as unknown).toMatchObject({ total: 1, groups: [{ key: "screening", count: 1 }] });

    const undone = await s.request(`/api/applications/events/${encodeURIComponent(event.id)}/undo`, s.json({}));
    expect(await undone.json()).toMatchObject({ application: { status: "applied" } });
  });

  it("explains a refused add or change in words, and shows more of a group when asked", async () => {
    const s = service();
    const invalid = await s.request("/api/applications", s.json({ job: { company: "", title: "UX Engineer" }, appliedOn: "2026-10-09", status: "applied" }));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ outcome: "invalid", field: "company", error: "Enter the company, so replies can be matched to it." });

    for (let i = 0; i < 7; i++) {
      await s.request("/api/applications", s.json({ job: { company: "Fennel Studio", title: `Job ${i}` }, appliedOn: "2026-10-09", status: "applied" }));
    }
    const five = (await (await s.request("/api/applications")).json()) as { groups: { applications: { id: string }[] }[] };
    const all = (await (await s.request("/api/applications?all=applied")).json()) as { groups: { applications: unknown[] }[] };
    expect([five.groups[0]!.applications.length, all.groups[0]!.applications.length]).toEqual([5, 7]);

    const accepted = await s.request(`/api/applications/${encodeURIComponent(five.groups[0]!.applications[0]!.id)}/status`, s.json({ status: "accepted" }));
    expect(accepted.status).toBe(409);
    expect(await accepted.json()).toMatchObject({ problem: "accepted" });
  });

  it("shows one Application in full, takes notes, contacts and the CV sent, and says when there's no such one", async () => {
    const s = service();
    const added = await s.request("/api/applications", s.json({ job: { company: "Fennel Studio", title: "UX Engineer" }, appliedOn: "2026-10-09", status: "applied" }));
    const { application } = (await added.json()) as { application: { id: string } };
    const at = `/api/applications/${encodeURIComponent(application.id)}`;

    expect((await s.request(`${at}/notes`, s.json({ text: "Recruiter called." }))).status).toBe(201);
    expect((await s.request(`${at}/contacts`, s.json({ value: "mira@example.com" }))).status).toBe(201);
    const badContact = await s.request(`${at}/contacts`, s.json({ value: "Mira" }));
    expect(badContact.status).toBe(422);
    expect(await badContact.json()).toMatchObject({ problem: "invalid" });

    const pdf = new TextEncoder().encode("%PDF-1.7\n% Mira Petrova\n%%EOF\n");
    const put = (type: string) => s.request(`${at}/cv?name=${encodeURIComponent("cv-design.pdf")}&label=Design%20v2`, { method: "PUT", headers: { "content-type": type }, body: pdf });
    expect((await put("text/plain")).status).toBe(415);
    expect((await put("application/pdf")).status).toBe(201);

    const detail = await (await s.request(at)).json();
    expect(detail).toMatchObject({
      id: application.id, cvVersion: "Design v2", contacts: [{ value: "mira@example.com" }],
      nextStep: { kind: "note", text: "Recruiter called." }, steps: [{ status: "applied", state: "current" }, {}, {}, {}, {}],
    });
    const file = await s.request(`${at}/cv`);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode(await file.arrayBuffer())).toContain("Mira Petrova");

    expect((await s.request("/api/applications/no-such-id")).status).toBe(404);
    expect((await s.request("/api/applications/no-such-id/cv")).status).toBe(404);
  });
});
