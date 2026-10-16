import { describe, expect, it } from "vitest";
import { createClient, defaultServiceUrl, type Store } from "./service.ts";

/** browser.storage.local held in memory, recording every write. */
function memoryStore(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const writes: string[] = [];
  const store: Store = {
    async get(keys) {
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items) {
      writes.push(...Object.keys(items));
      Object.assign(data, items);
    },
    async remove(keys) {
      for (const k of keys) delete data[k];
    },
  };
  return { store, data, writes };
}

type Route = (req: { url: string; method: string; auth: string | null; body: unknown }) => Response | undefined;

/** A fake service at the default address; anything it doesn't answer fails like a closed port. */
function fakeService(route: Route) {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const res = route({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (!res) throw new TypeError("Failed to fetch");
    return res;
  };
  return fetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const page = { url: "https://www.linkedin.com/jobs/view/4100000009/", html: "<html><body><h1>Application Security Engineer</h1></body></html>", frames: [] };
const report = { kind: "job", site: "LinkedIn", source: "Captured · LinkedIn", listings: [], counts: { new: 1, inFeed: 0, hidden: 0, unreadable: 0 }, notLoaded: 0, message: null };

describe("the extension talking to apply-kit", () => {
  it("says the app isn't running when nothing answers on this laptop", async () => {
    const { store } = memoryStore({ token: "t0k3n" });
    const client = createClient({ fetch: fakeService(() => undefined), store });

    expect(await client.connect()).toEqual({ state: "not-running", serviceUrl: defaultServiceUrl });
    expect(await client.preview(page)).toEqual({ ok: false, state: "not-running" });
  });

  it("asks to pair when it has no token, or the service no longer accepts it", async () => {
    const service = fakeService((r) => (r.url.endsWith("/api/ext/status") ? json({ problem: "not-paired" }, 401) : undefined));

    expect(await createClient({ fetch: service, store: memoryStore().store }).connect()).toMatchObject({ state: "unpaired" });
    expect(await createClient({ fetch: service, store: memoryStore({ token: "old" }).store }).connect()).toMatchObject({ state: "unpaired" });
  });

  it("pairs with the code from the app, keeping only the token and the service address", async () => {
    const { store, data } = memoryStore();
    const service = fakeService((r) => {
      if (r.url === `${defaultServiceUrl}/api/ext/pair`) {
        return (r.body as { code: string }).code === "482913" ? json({ token: "fresh-token", deviceId: "device:1" }, 201) : json({ problem: "wrong-code", error: "That isn't the code apply-kit shows." }, 400);
      }
      if (r.url === `${defaultServiceUrl}/api/ext/status`) return r.auth === "Bearer fresh-token" ? json({ app: "apply-kit", paired: true }) : json({ problem: "not-paired" }, 401);
      return undefined;
    });
    const client = createClient({ fetch: service, store });

    expect(await client.pair("111111")).toEqual({ ok: false, error: "That isn't the code apply-kit shows." });
    expect(await client.pair("482 913")).toEqual({ ok: true });

    expect(await client.connect()).toEqual({ state: "ready", serviceUrl: defaultServiceUrl });
    expect(data).toEqual({ token: "fresh-token", serviceUrl: defaultServiceUrl });
  });

  it("sends the page with its token and keeps nothing of it", async () => {
    const { store, writes } = memoryStore({ token: "t0k3n" });
    const sent: unknown[] = [];
    const service = fakeService((r) => {
      if (r.auth !== "Bearer t0k3n") return json({ problem: "not-paired" }, 401);
      sent.push(r.body);
      if (r.url.endsWith("/api/ext/capture/preview")) return json(report);
      if (r.url.endsWith("/api/ext/capture")) return json(report, 201);
      return undefined;
    });
    const client = createClient({ fetch: service, store });

    expect(await client.preview(page)).toEqual({ ok: true, report });
    expect(await client.capture(page)).toEqual({ ok: true, report });

    expect(sent).toEqual([page, page]);
    expect(writes).toEqual([]);
  });

  it("forgets its token when the service says it isn't paired any more", async () => {
    const { store, data } = memoryStore({ token: "revoked", serviceUrl: defaultServiceUrl });
    const client = createClient({ fetch: fakeService(() => json({ problem: "not-paired" }, 401)), store });

    expect(await client.capture(page)).toEqual({ ok: false, state: "unpaired" });
    expect(data).toEqual({ serviceUrl: defaultServiceUrl });
  });

  it("asks apply-kit to start a fill, answer a page and record it, with its token, keeping nothing", async () => {
    const { store, writes } = memoryStore({ token: "t0k3n" });
    const sent: [string, unknown][] = [];
    const ghPage = { portal: "greenhouse" as const, host: "job-boards.greenhouse.io", jobRef: { portal: "greenhouse" as const, board: "kestrel", jobId: "4410" } };
    const reading = { pageKind: "form" as const, jobRef: ghPage.jobRef, stepLabel: null, stepCount: null, fields: [] };
    const service = fakeService((r) => {
      if (r.auth !== "Bearer t0k3n") return json({ problem: "not-paired" }, 401);
      sent.push([new URL(r.url).pathname, r.body]);
      if (r.url.endsWith("/api/ext/fill/start")) return json({ kind: "no-package", job: null });
      if (r.url.endsWith("/api/ext/fill/answer")) return json({ problem: "session-ended", error: "This tab's fill session has ended." }, 409);
      if (r.url.endsWith("/api/ext/fill/record")) return json({ stepLabel: null });
      return undefined;
    });
    const client = createClient({ fetch: service, store });

    expect(await client.fill.start(ghPage, { sessionId: "s-1" })).toEqual({ ok: true, value: { kind: "no-package", job: null } });
    expect(await client.fill.answer("s-1", reading)).toEqual({ ok: false, state: "error", problem: "session-ended", error: "This tab's fill session has ended." });
    expect(await client.fill.record("s-1", reading, [])).toEqual({ ok: true, value: { stepLabel: null } });

    expect(sent).toEqual([
      ["/api/ext/fill/start", { page: ghPage, sessionId: "s-1" }],
      ["/api/ext/fill/answer", { sessionId: "s-1", reading }],
      ["/api/ext/fill/record", { sessionId: "s-1", reading, outcomes: [] }],
    ]);
    expect(writes).toEqual([]);
  });

  it("fetches a package file and asks apply-kit to show it in Finder, naming only the session and which file", async () => {
    const calls: [string, unknown][] = [];
    const service = fakeService((r) => {
      calls.push([new URL(r.url).pathname, r.body]);
      if (r.url.endsWith("/api/ext/fill/file")) return json({ which: "cv", fileName: "Mira_Petrova_CV.pdf", size: 9, path: "/x/Mira_Petrova_CV.pdf", type: "application/pdf", base64: "JVBERi1mYWtl" });
      return json({ revealed: "/x/Mira_Petrova_CV.pdf" });
    });
    const client = createClient({ fetch: service, store: memoryStore({ token: "t" }).store });

    expect(await client.fill.file("s-1", "cv")).toMatchObject({ ok: true, value: { fileName: "Mira_Petrova_CV.pdf", base64: "JVBERi1mYWtl" } });
    expect(await client.fill.reveal("s-1", "cv")).toEqual({ ok: true, value: { revealed: "/x/Mira_Petrova_CV.pdf" } });
    expect(calls).toEqual([["/api/ext/fill/file", { sessionId: "s-1", which: "cv" }], ["/api/ext/fill/reveal", { sessionId: "s-1", which: "cv" }]]);
  });

  it("asks for the copy list of a form apply-kit doesn't know, keeping nothing of it", async () => {
    const calls: [string, unknown][] = [];
    const list = { rows: [{ fieldId: "phone", label: "Телефон", meaning: "phone", kind: "value", value: "+359 88 000 0175" }], unmapped: 2 };
    const service = fakeService((r) => { calls.push([new URL(r.url).pathname, r.body]); return json(list); });
    const { store, writes } = memoryStore({ token: "t" });
    const reading = { pageKind: "form" as const, jobRef: null, stepLabel: null, stepCount: null, fields: [] };

    expect(await createClient({ fetch: service, store }).fill.copyList("s-1", reading)).toEqual({ ok: true, value: list });
    expect(calls).toEqual([["/api/ext/fill/copy-list", { sessionId: "s-1", reading }]]);
    expect(writes).toEqual([]);
  });

  it("sends a field report: the field's structure and the page's address, nothing kept in the browser", async () => {
    const calls: [string, unknown][] = [];
    const service = fakeService((r) => { calls.push([new URL(r.url).pathname, r.body]); return json({ id: "r1" }); });
    const { store, writes } = memoryStore({ token: "t" });
    const field = { tag: "input", type: "tel", role: null, kind: "tel" as const, attributes: { id: "phone" }, labelChain: [{ from: "label[for]", text: "Phone Number" }], options: [] };
    const report = { portal: "greenhouse", address: "https://job-boards.greenhouse.io/kestrel/jobs/4410", stepLabel: null, field };

    expect(await createClient({ fetch: service, store }).fill.report(report)).toEqual({ ok: true, value: { id: "r1" } });
    expect(calls).toEqual([["/api/ext/fill/report", report]]);
    expect(writes).toEqual([]);
  });

  it("marks the tab's session submitted and undoes it, and passes on a mark that created nothing with its reason", async () => {
    const sent: [string, unknown][] = [];
    const refused = { marked: false, reason: "You already have an open Application for Security Engineer at Kestrel Payments.", application: { id: "a0" } };
    const service = fakeService((r) => {
      sent.push([new URL(r.url).pathname, r.body]);
      if (r.url.endsWith("/api/ext/fill/submitted")) return (r.body as { sessionId: string }).sessionId === "s-1" ? json({ marked: true, alreadyMarked: false }) : json(refused, 422);
      if (r.url.endsWith("/api/ext/fill/submitted/undo")) return json({ problem: "not-undoable", error: "Something has happened to this Application since you marked it." }, 409);
      return undefined;
    });
    const client = createClient({ fetch: service, store: memoryStore({ token: "t0k3n" }).store });
    const confirmation = "https://job-boards.greenhouse.io/kestrel/jobs/4410/confirmation";

    expect(await client.fill.markSubmitted("s-1", confirmation, ["7"])).toEqual({ ok: true, value: { marked: true, alreadyMarked: false } });
    expect(await client.fill.markSubmitted("s-2", confirmation, [])).toEqual({ ok: true, value: refused });
    expect(await client.fill.undoMarkSubmitted("a1")).toEqual({ ok: false, state: "error", problem: "not-undoable", error: "Something has happened to this Application since you marked it." });
    expect(sent).toEqual([
      ["/api/ext/fill/submitted", { sessionId: "s-1", portalUrl: confirmation, saveAnswers: ["7"] }],
      ["/api/ext/fill/submitted", { sessionId: "s-2", portalUrl: confirmation, saveAnswers: [] }],
      ["/api/ext/fill/submitted/undo", { applicationId: "a1" }],
    ]);
  });

  it("asks for the answers typed on the portal, and saves the picked ones to the answer bank", async () => {
    const sent: [string, unknown][] = [];
    const typed = [{ id: "7", question: "Have you ever held a government security clearance?", answer: "No", kind: "yes-no", save: { ticked: true, note: null } }];
    const service = fakeService((r) => {
      sent.push([new URL(r.url).pathname, r.body]);
      if (r.url.endsWith("/api/ext/fill/pending")) return json(typed);
      if (r.url.endsWith("/api/ext/fill/save-answers")) return json({ saved: [{ question: typed[0]!.question, answerId: "answer:1", how: "added" }], refused: [] });
      return undefined;
    });
    const client = createClient({ fetch: service, store: memoryStore({ token: "t0k3n" }).store });

    expect(await client.fill.pending("s-1")).toEqual({ ok: true, value: typed });
    expect(await client.fill.saveAnswers("s-1", [{ pendingId: "7" }])).toMatchObject({ ok: true, value: { saved: [{ how: "added" }] } });
    expect(sent).toEqual([
      ["/api/ext/fill/pending", { sessionId: "s-1" }],
      ["/api/ext/fill/save-answers", { sessionId: "s-1", picks: [{ pendingId: "7" }] }],
    ]);
  });

  it("says when the app stopped answering in the middle of a fill", async () => {
    const client = createClient({ fetch: fakeService(() => undefined), store: memoryStore({ token: "t0k3n" }).store });
    expect(await client.fill.match({ portal: "greenhouse", host: "x", jobRef: null }, null)).toEqual({ ok: false, state: "not-running" });
  });
});
