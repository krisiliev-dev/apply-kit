// The extension's only connection: the apply-kit service on this laptop (ARCHITECTURE.md). It keeps
// two things in browser.storage.local, the service's address and the token from pairing, and
// nothing else: no pages, no jobs, no profile. Pages go straight to the service and are forgotten.
import type { CaptureReport, CapturedPage, FieldAnswer, FieldOutcome, FillPage, FillStart, MarkResult, PackageFileKind, PageReading, RecordedPage } from "@apply-kit/core";

/** The service's address unless Kris changes it (PORT in the app's settings). */
export const defaultServiceUrl = "http://127.0.0.1:4310";

/** The slice of browser.storage.local the client uses. */
export interface Store {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export type Connection =
  /** Nothing answers at the service's address: the app isn't running (or the address is wrong). */
  | { state: "not-running"; serviceUrl: string }
  /** The service answers but this extension isn't paired with it (or was unpaired). */
  | { state: "unpaired"; serviceUrl: string }
  | { state: "ready"; serviceUrl: string };

export type CaptureAnswer = { ok: true; report: CaptureReport } | { ok: false; state: "not-running" | "unpaired" } | { ok: false; state: "error"; error: string };

/** A fill call's answer: its value, or why there isn't one (a refusal names its problem, "session-ended"). */
export type Answer<T> = { ok: true; value: T } | { ok: false; state: "not-running" | "unpaired" } | { ok: false; state: "error"; error: string; problem?: string };

export interface FillClient {
  /** Which package fits the page; opens nothing. */
  match(page: FillPage, sessionId: string | null): Promise<Answer<FillStart>>;
  /** A Fill click: re-reads the job, keeps or ends the tab's session, opens one on a match. */
  start(page: FillPage, options: { sessionId?: string | null; packageId?: string }): Promise<Answer<FillStart>>;
  answer(sessionId: string, reading: PageReading): Promise<Answer<FieldAnswer[]>>;
  record(sessionId: string, reading: PageReading, outcomes: FieldOutcome[]): Promise<Answer<RecordedPage>>;
  /** Kris's "Mark as submitted": the Application is created (or was already); a mark that created nothing says why. */
  markSubmitted(sessionId: string, portalUrl: string | null): Promise<Answer<MarkResult>>;
  /** Undo after marking (kept in the panel until it closes). */
  undoMarkSubmitted(applicationId: string): Promise<Answer<{ packageId: string }>>;
  /** The package's CV or letter as base64, held in the panel's memory only while it's attached. */
  file(sessionId: string, which: PackageFileKind): Promise<Answer<PackageFileBytes>>;
  /** "Show in Finder": apply-kit reveals the session's file in the Packages folder. */
  reveal(sessionId: string, which: PackageFileKind): Promise<Answer<{ revealed: string }>>;
}

/** A package file as the service sends it; `path` is its copy in the Packages folder, or null. */
export interface PackageFileBytes {
  which: PackageFileKind;
  fileName: string;
  size: number;
  path: string | null;
  type: string;
  base64: string;
}

export interface Client {
  connect(): Promise<Connection>;
  /** Trades the code apply-kit shows for a token. A different address can be given at the same time. */
  pair(code: string, serviceUrl?: string): Promise<{ ok: true } | { ok: false; error: string }>;
  preview(page: CapturedPage): Promise<CaptureAnswer>;
  capture(page: CapturedPage): Promise<CaptureAnswer>;
  fill: FillClient;
}

export function createClient({ fetch, store }: { fetch: typeof globalThis.fetch; store: Store }): Client {
  async function settings() {
    const s = await store.get(["serviceUrl", "token"]);
    return {
      serviceUrl: typeof s.serviceUrl === "string" && s.serviceUrl ? s.serviceUrl : defaultServiceUrl,
      token: typeof s.token === "string" ? s.token : null,
    };
  }

  /** One request to the service, or null when nothing answers. */
  async function call(path: string, init: { method?: string; body?: unknown; token?: string | null; serviceUrl?: string } = {}): Promise<Response | null> {
    const s = await settings();
    const token = init.token === undefined ? s.token : init.token;
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    try {
      return await fetch(`${(init.serviceUrl ?? s.serviceUrl).replace(/\/+$/, "")}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      return null;
    }
  }

  async function sendPage(path: string, page: CapturedPage): Promise<CaptureAnswer> {
    const { token } = await settings();
    if (!token) return { ok: false, state: "unpaired" };
    const res = await call(path, { method: "POST", body: page });
    if (!res) return { ok: false, state: "not-running" };
    if (res.status === 401) {
      await store.remove(["token"]);
      return { ok: false, state: "unpaired" };
    }
    if (!res.ok) return { ok: false, state: "error", error: await errorOf(res) };
    return { ok: true, report: (await res.json()) as CaptureReport };
  }

  /** `answers`: refusals that still carry the value (a mark that created nothing answers 422 with its reason). */
  async function post<T>(path: string, body: unknown, answers: number[] = []): Promise<Answer<T>> {
    const { token } = await settings();
    if (!token) return { ok: false, state: "unpaired" };
    const res = await call(path, { method: "POST", body });
    if (!res) return { ok: false, state: "not-running" };
    if (res.status === 401) {
      await store.remove(["token"]);
      return { ok: false, state: "unpaired" };
    }
    if (!res.ok && !answers.includes(res.status)) {
      const b = (await res.json().catch(() => null)) as { error?: unknown; problem?: unknown } | null;
      const error = typeof b?.error === "string" ? b.error : `apply-kit answered ${res.status}.`;
      return typeof b?.problem === "string" ? { ok: false, state: "error", problem: b.problem, error } : { ok: false, state: "error", error };
    }
    return { ok: true, value: (await res.json()) as T };
  }

  return {
    fill: {
      match: (page, sessionId) => post("/api/ext/fill/match", { page, sessionId }),
      start: (page, options) => post("/api/ext/fill/start", { page, ...options }),
      answer: (sessionId, reading) => post("/api/ext/fill/answer", { sessionId, reading }),
      record: (sessionId, reading, outcomes) => post("/api/ext/fill/record", { sessionId, reading, outcomes }),
      file: (sessionId, which) => post("/api/ext/fill/file", { sessionId, which }),
      reveal: (sessionId, which) => post("/api/ext/fill/reveal", { sessionId, which }),
      markSubmitted: (sessionId, portalUrl) => post("/api/ext/fill/submitted", { sessionId, portalUrl }, [422]),
      undoMarkSubmitted: (applicationId) => post("/api/ext/fill/submitted/undo", { applicationId }),
    },

    async connect() {
      const { serviceUrl, token } = await settings();
      const res = await call("/api/ext/status");
      if (!res) return { state: "not-running", serviceUrl };
      if (!token || res.status === 401) return { state: "unpaired", serviceUrl };
      return { state: res.ok ? "ready" : "not-running", serviceUrl };
    },

    async pair(code, serviceUrl) {
      const url = serviceUrl?.trim() || (await settings()).serviceUrl;
      const res = await call("/api/ext/pair", { method: "POST", body: { code: code.replace(/\s+/g, ""), name: "Chrome" }, token: null, serviceUrl: url });
      if (!res) return { ok: false, error: `Can't reach apply-kit at ${url}. Start apply-kit, then try again.` };
      if (!res.ok) return { ok: false, error: await errorOf(res) };
      const { token } = (await res.json()) as { token: string };
      await store.set({ token, serviceUrl: url });
      return { ok: true };
    },

    preview: (page) => sendPage("/api/ext/capture/preview", page),
    capture: (page) => sendPage("/api/ext/capture", page),
  };
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : `apply-kit answered ${res.status}.`;
}
