// The extension's fill endpoints (Apply #38), under the token-guarded /api/ext/*: thin adapters over
// the fill engine. The panel matches the tab's page to a package, starts a fill (which re-reads the
// job each time), asks for the answers to the page's fields and records what was filled. Values pass
// through in the answers only; the record never holds them.
import type { Context, Hono } from "hono";
import { FillError, type FieldOutcome, type FillEngine, type FillPage, type PageReading } from "@apply-kit/core";
import { jsonBody } from "./profile-api.ts";

const portals = ["workday", "greenhouse", "lever", "smartrecruiters", "workable", "ashby"];
type Body = Record<string, unknown>;

export function mountFillApi(app: Hono, fill: FillEngine): void {
  // { page: { portal, host, jobRef }, sessionId? }: which package fits, opening nothing.
  app.post("/api/ext/fill/match", (c) => withBody(c, (b) => {
    const page = pageOf(b.page);
    return page ? fill.matchPage(page, { sessionId: str(b.sessionId) }) : bad("Send the page: { portal, host, jobRef }");
  }));
  // { page, sessionId?, packageId? }: every Fill click starts here.
  app.post("/api/ext/fill/start", (c) => withBody(c, (b) => {
    const page = pageOf(b.page);
    return page ? fill.startFill(page, { sessionId: str(b.sessionId), packageId: str(b.packageId) ?? undefined }) : bad("Send the page: { portal, host, jobRef }");
  }));
  // { sessionId, reading }: the answer for each field of the page.
  app.post("/api/ext/fill/answer", (c) => withBody(c, (b) => {
    const sessionId = str(b.sessionId);
    const reading = readingOf(b.reading);
    return sessionId && reading ? fill.answer(sessionId, reading) : bad("Send the sessionId and the page's reading");
  }));
  // { sessionId, reading, outcomes }: what the fill did on the page.
  app.post("/api/ext/fill/record", (c) => withBody(c, (b) => {
    const sessionId = str(b.sessionId);
    const reading = readingOf(b.reading);
    const outcomes = Array.isArray(b.outcomes) ? (b.outcomes as FieldOutcome[]) : null;
    return sessionId && reading && outcomes ? fill.recordPage(sessionId, reading, outcomes) : bad("Send the sessionId, the page's reading and the outcomes");
  }));
}

class BadRequest extends Error {}
const bad = (message: string): never => { throw new BadRequest(message); };
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function withBody(c: Context, act: (body: Body) => unknown) {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
  try {
    return c.json(await act(body));
  } catch (err) {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    if (err instanceof FillError) return c.json({ problem: err.problem, error: err.message }, 409);
    throw err;
  }
}

function pageOf(v: unknown): FillPage | null {
  const p = v as Partial<FillPage> | null;
  if (!p || typeof p !== "object" || !portals.includes(String(p.portal)) || typeof p.host !== "string") return null;
  const ref = p.jobRef as FillPage["jobRef"] | undefined;
  if (ref != null && (typeof ref !== "object" || !portals.includes(String(ref.portal)) || typeof ref.jobId !== "string")) return null;
  return { portal: p.portal!, host: p.host, jobRef: ref ? { portal: ref.portal, board: typeof ref.board === "string" ? ref.board : null, jobId: ref.jobId } : null };
}

function readingOf(v: unknown): PageReading | null {
  const r = v as Partial<PageReading> | null;
  return r && typeof r === "object" && typeof r.pageKind === "string" && Array.isArray(r.fields) ? (r as PageReading) : null;
}
