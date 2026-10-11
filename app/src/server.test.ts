import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createEngine, createPairing, type Scheduler } from "@apply-kit/core";
import { createServer } from "./server.ts";

// The service as the extension sees it: an in-memory engine, no network, a fixed clock.
function service() {
  const db = new DatabaseSync(":memory:");
  const clock = { now: () => new Date("2026-10-12T07:30:00Z") };
  const engine = createEngine({
    db, clock,
    fetch: async () => { throw new Error("no network in tests"); },
    extractor: { estimateCostUsd: () => 0, extract: async () => { throw new Error("no AI in tests"); } },
    mailReader: { fetchSince: async () => [] },
  });
  const pairing = createPairing({ db, clock });
  const scheduler = { status: () => ({}), checkNow: async () => ({}) } as unknown as Scheduler;
  const app = createServer({ engine, scheduler, pairing, uiDir: "/nonexistent/" });
  const json = (body: unknown, headers: Record<string, string> = {}) => ({
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  return { app, json, engine };
}

/** A synthetic job search page with one listing (made-up company). */
const page = {
  url: "https://www.linkedin.com/jobs/search/?keywords=security",
  html: `<ul><li data-occludable-job-id="4100000001"><div class="job-card-container" data-job-id="4100000001">
    <a class="job-card-list__title--link" href="/jobs/view/4100000001/"><strong>Security Engineer</strong></a>
    <div class="artdeco-entity-lockup__subtitle">Kestrel Payments</div></div></li></ul>`,
};

async function paired(s: ReturnType<typeof service>): Promise<string> {
  const { code } = (await (await s.app.request("/api/pairing", s.json({}))).json()) as { code: string };
  const res = await s.app.request("/api/ext/pair", s.json({ code, name: "Chrome" }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

describe("the extension's side of the service", () => {
  it("rejects every capture request from an extension that isn't paired", async () => {
    const s = service();

    const none = await s.app.request("/api/ext/capture", s.json(page));
    const wrong = await s.app.request("/api/ext/capture", s.json(page, { authorization: "Bearer not-a-token" }));
    const status = await s.app.request("/api/ext/status");

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

    const status = await s.app.request("/api/ext/status", { headers: auth });
    expect(await status.json()).toEqual({ app: "apply-kit", paired: true });

    const preview = await (await s.app.request("/api/ext/capture/preview", s.json(page, auth))).json();
    expect(preview).toMatchObject({ kind: "search", counts: { new: 1 } });
    expect((await s.engine.queryFeed({ view: "new" })).jobs).toHaveLength(0);

    const captured = await s.app.request("/api/ext/capture", s.json(page, auth));
    expect(captured.status).toBe(201);
    expect(await captured.json()).toMatchObject({ source: "Captured · LinkedIn", counts: { new: 1 } });
    expect((await s.engine.queryFeed({ view: "new" })).jobs.map((j) => j.title)).toEqual(["Security Engineer"]);
  });

  it("refuses a wrong pairing code, and a token stops working once the extension is unpaired", async () => {
    const s = service();
    await s.app.request("/api/pairing", s.json({}));
    const wrong = await s.app.request("/api/ext/pair", s.json({ code: "not the code", name: "Chrome" }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ problem: "wrong-code" });

    const token = await paired(s);
    const devices = (await (await s.app.request("/api/pairing/devices")).json()) as { id: string }[];
    await s.app.request(`/api/pairing/devices/${encodeURIComponent(devices[0]!.id)}/unpair`, s.json({}));

    const after = await s.app.request("/api/ext/status", { headers: { authorization: `Bearer ${token}` } });
    expect(after.status).toBe(401);
  });

  it("asks for JSON, so no web page can post to it without a preflight it never grants", async () => {
    const s = service();
    const token = await paired(s);

    const form = await s.app.request("/api/ext/capture", {
      method: "POST", headers: { "content-type": "text/plain", authorization: `Bearer ${token}` }, body: JSON.stringify(page),
    });
    expect(form.status).toBe(415);
    const preflight = await s.app.request("/api/ext/capture", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });
});
