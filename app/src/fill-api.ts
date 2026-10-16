// The extension's fill endpoints (Apply #38), under the token-guarded /api/ext/*: thin adapters over
// the fill engine. The panel matches the tab's page to a package, starts a fill (which re-reads the
// job each time), asks for the answers to the page's fields and records what was filled. Values pass
// through in the answers only; the record never holds them.
import type { Context, Hono } from "hono";
import { FillError, answerKinds, fieldReportFixture, type AnswerKind, type FieldOutcome, type MarkResult, type FillEngine, type FillPage, type FieldStructure, type PackageFileKind, type PageReading, type SavePick } from "@apply-kit/core";
import { jsonBody } from "./profile-api.ts";

const portals = ["workday", "greenhouse", "lever", "smartrecruiters", "workable", "ashby"];
type Body = Record<string, unknown>;

/** Shows a file in Finder (`open -R`), for "Show in Finder" when a file won't attach. */
export interface Revealer {
  reveal(path: string): Promise<void>;
}

const fileWords = { cv: "CV", letter: "letter" } as const;

export function mountFillApi(app: Hono, fill: FillEngine, revealer?: Revealer): void {
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
  // { sessionId, reading }: the copy list on a form apply-kit doesn't know. Fills nothing, drafts nothing.
  app.post("/api/ext/fill/copy-list", (c) => withBody(c, (b) => {
    const sessionId = str(b.sessionId);
    const reading = readingOf(b.reading);
    return sessionId && reading ? fill.copyList(sessionId, reading) : bad("Send the sessionId and the page's reading");
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
  // { sessionId }: the answers Kris typed on the portal, waiting ("Did you submit?").
  app.post("/api/ext/fill/pending", (c) => withBody(c, (b) => {
    const sessionId = str(b.sessionId);
    return sessionId ? fill.pendingAnswers(sessionId) : bad("Send the sessionId");
  }));
  // { sessionId, picks: [{ pendingId } | { question, answer, kind }] }: Save to answer bank.
  app.post("/api/ext/fill/save-answers", (c) => withBody(c, (b) => {
    const sessionId = str(b.sessionId);
    const picks = picksOf(b.picks);
    return sessionId && picks ? fill.saveAnswers(sessionId, picks) : bad("Send the sessionId and the picks: [{ pendingId } | { question, answer, kind }]");
  }));
  // { sessionId, portalUrl, saveAnswers? }: Kris clicked Mark as submitted (or "I've submitted this") in the panel, with the typed answers he left ticked.
  app.post("/api/ext/fill/submitted", (c) => withBody(c, async (b) => {
    const sessionId = str(b.sessionId);
    if (!sessionId) return bad("Send the sessionId and the portal page's address");
    const saveAnswers = Array.isArray(b.saveAnswers) ? b.saveAnswers.filter((x): x is string => typeof x === "string") : [];
    return marked(await fill.markSubmitted({ sessionId }, { portalUrl: str(b.portalUrl), via: "extension", saveAnswers }));
  }));
  // { applicationId }: the panel's Undo after marking.
  app.post("/api/ext/fill/submitted/undo", (c) => withBody(c, (b) => {
    const applicationId = str(b.applicationId);
    return applicationId ? fill.undoMarkSubmitted(applicationId) : bad("Send the applicationId");
  }));

  // { portal, address, stepLabel, field }: "Report this field" in the panel. The engine keeps the field's
  // structure, host and path only: never the query, never a value.
  app.post("/api/ext/fill/report", (c) => withBody(c, (b) => {
    const address = str(b.address);
    if (!address || !b.field || typeof b.field !== "object") return bad("Send the page's address and the field's structure");
    try {
      return fill.reportField({ portal: str(b.portal) ?? "unknown", address, stepLabel: str(b.stepLabel), field: b.field as FieldStructure });
    } catch (err) {
      if (err instanceof FillError && err.problem === "bad-report") return bad(err.message);
      throw err;
    }
  }));
  // Settings › Extension: the field reports, each with its fixture text for "Copy as fixture"; Delete.
  app.get("/api/field-reports", (c) => c.json({ reports: fill.fieldReports().map((r) => ({ ...r, fixture: fieldReportFixture(r) })) }));
  app.post("/api/field-reports/:id/delete", (c) => withBody(c, () => (fill.deleteFieldReport(c.req.param("id")) ? { deleted: true } : notFound("There's no such field report"))));

  // The Job page's "Mark as submitted", for an application sent outside the extension, and its Undo.
  app.post("/api/packages/:id/submitted", (c) => withBody(c, async () =>
    marked(await fill.markSubmitted({ packageId: c.req.param("id") }, { portalUrl: null, via: "app" }))));
  app.post("/api/applications/:id/submitted/undo", (c) => withBody(c, () => fill.undoMarkSubmitted(c.req.param("id"))));
  // { sessionId, which: "cv" | "letter" }: the package's file, as base64, for the panel to attach.
  app.post("/api/ext/fill/file", (c) => withBody(c, async (b) => {
    const { sessionId, which } = fileRequest(b);
    const file = await fill.packageFile(sessionId, which);
    if (!file) return notFound(`Your package has no ${fileWords[which]}`);
    return { which, fileName: file.fileName, size: file.size, path: file.path, type: "application/pdf", base64: Buffer.from(file.bytes).toString("base64") };
  }));
  // { sessionId, which }: "Show in Finder" for the session's file, in the Packages folder. Never a path from the extension.
  app.post("/api/ext/fill/reveal", (c) => withBody(c, async (b) => {
    const { sessionId, which } = fileRequest(b);
    const file = await fill.packageFile(sessionId, which);
    if (!file) return notFound(`Your package has no ${fileWords[which]}`);
    if (!file.path) return notFound(`The ${fileWords[which]} isn't in your Packages folder: apply-kit couldn't write it there`);
    if (!revealer) return notFound("Show in Finder isn't available here");
    await revealer.reveal(file.path);
    return { revealed: file.path };
  }));
}

function fileRequest(b: Body): { sessionId: string; which: PackageFileKind } {
  const sessionId = str(b.sessionId);
  const which = b.which === "cv" || b.which === "letter" ? b.which : null;
  return sessionId && which ? { sessionId, which } : bad("Send the sessionId and which file: \"cv\" or \"letter\"");
}

/** A mark that created nothing answers 422 with the reason (and the Application to open instead). */
const marked = (r: MarkResult) => (r.marked ? r : new Refused(r));
class Refused { constructor(readonly body: MarkResult) {} }

class BadRequest extends Error {}
class NotFound extends Error {}
const notFound = (message: string): never => { throw new NotFound(message); };
const bad = (message: string): never => { throw new BadRequest(message); };
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function withBody(c: Context, act: (body: Body) => unknown) {
  const body = await jsonBody(c);
  if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
  try {
    const result = await act(body);
    if (result instanceof Refused) return c.json(result.body, 422);
    return c.json(result);
  } catch (err) {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    if (err instanceof NotFound) return c.json({ error: err.message }, 404);
    if (err instanceof FillError) return c.json({ problem: err.problem, error: err.message }, 409);
    throw err;
  }
}

function pageOf(v: unknown): FillPage | null {
  const p = v as Partial<FillPage> | null;
  // "unknown": a form apply-kit doesn't know (a company's own careers site), matched by its host.
  if (!p || typeof p !== "object" || !(portals.includes(String(p.portal)) || p.portal === "unknown") || typeof p.host !== "string") return null;
  const ref = p.jobRef as FillPage["jobRef"] | undefined;
  if (ref != null && (typeof ref !== "object" || !portals.includes(String(ref.portal)) || typeof ref.jobId !== "string")) return null;
  return { portal: p.portal!, host: p.host, jobRef: ref ? { portal: ref.portal, board: typeof ref.board === "string" ? ref.board : null, jobId: ref.jobId } : null };
}

function picksOf(v: unknown): SavePick[] | null {
  if (!Array.isArray(v)) return null;
  const picks: SavePick[] = [];
  for (const p of v as Record<string, unknown>[]) {
    if (p && typeof p.pendingId === "string") picks.push({ pendingId: p.pendingId });
    else if (p && typeof p.question === "string" && typeof p.answer === "string" && answerKinds.includes(p.kind as AnswerKind)) picks.push({ question: p.question, answer: p.answer, kind: p.kind as AnswerKind });
    else return null;
  }
  return picks;
}

function readingOf(v: unknown): PageReading | null {
  const r = v as Partial<PageReading> | null;
  return r && typeof r === "object" && typeof r.pageKind === "string" && Array.isArray(r.fields) ? (r as PageReading) : null;
}
