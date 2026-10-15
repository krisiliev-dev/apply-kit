// The Package's API (ticket #62): the Prepare button's state for a Job, starting the Job's package,
// reading it, approving steps in order, the target posting, language and photo, stopping and
// retrying parts, the CV version's changes (undo, redo) and fitting it on one page (#63), its flags
// and gap questions (#64), the screening answers and the drafter Apply uses (#66), and the CV's draft PDF. Mutations need a JSON body type, like the rest of the
// service, so a web page can't send one without a CORS preflight.
import type { Context, Hono } from "hono";
import { packageSteps, type DiscoveryEngine, type PackageStep, type PreparationEngine } from "@apply-kit/core";

type Body = Record<string, unknown>;

const jsonOnly = (c: Context) => c.req.header("content-type")?.startsWith("application/json") ?? false;

async function jsonBody(c: Context): Promise<Body | null> {
  if (!jsonOnly(c)) return null;
  const body: unknown = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : null;
}

const noPackage = { error: "No such package" };
const needJson = { error: "Send a JSON body with Content-Type: application/json" };

export function mountPackageApi(app: Hono, engine: DiscoveryEngine, preparation: PreparationEngine): void {
  // What the Job page's Prepare button shows: { canStart, problem?, reason?, package }.
  app.get("/api/jobs/:id/prepare", async (c) => {
    const job = await engine.getJob(c.req.param("id"));
    return job ? c.json(preparation.prepareStatus(job)) : c.json({ error: "No such job" }, 404);
  });

  // Starts the Job's package, or returns the one it has. A package that can't start answers 422 with the reason.
  app.post("/api/jobs/:id/package", async (c) => {
    if (!jsonOnly(c)) return c.json(needJson, 415);
    const job = await engine.getJob(c.req.param("id"));
    if (!job) return c.json({ error: "No such job" }, 404);
    const result = preparation.startPackage(job);
    return c.json(result, result.started ? 201 : 422);
  });

  app.get("/api/packages/:id", (c) => {
    const pkg = preparation.package(c.req.param("id"));
    return pkg ? c.json(pkg) : c.json(noPackage, 404);
  });

  const withPackage = async (c: Context, act: (id: string, body: Body) => unknown) => {
    const body = await jsonBody(c);
    if (!body) return c.json(needJson, 415);
    const id = c.req.param("id")!;
    if (!preparation.package(id)) return c.json(noPackage, 404);
    const result = (await act(id, body)) as { approved?: boolean; changed?: boolean } | Response;
    if (result instanceof Response) return result;
    return c.json(result, result.approved === false || result.changed === false ? 422 : 200);
  };
  const step = (c: Context, name: string) => (packageSteps.includes(name as PackageStep) ? (name as PackageStep) : c.json({ error: `Unknown step "${name}"` }, 404));

  app.post("/api/packages/:id/steps/:step/approve", (c) => withPackage(c, (id) => {
    const s = step(c, c.req.param("step")!);
    return s instanceof Response ? s : preparation.approveStep(id, s);
  }));
  // { postingId }
  app.put("/api/packages/:id/target", (c) => withPackage(c, (id, body) =>
    typeof body.postingId === "string" ? preparation.setTargetPosting(id, body.postingId) : c.json({ error: "postingId must be a posting id" }, 400)));
  // { language: "en" | "bg" }
  app.put("/api/packages/:id/language", (c) => withPackage(c, (id, body) =>
    body.language === "en" || body.language === "bg" ? preparation.setPackageLanguage(id, body.language) : c.json({ error: "language must be en or bg" }, 400)));
  // { on: boolean }
  app.put("/api/packages/:id/photo", (c) => withPackage(c, (id, body) =>
    typeof body.on === "boolean" ? preparation.setPackagePhoto(id, body.on) : c.json({ error: "on must be true or false" }, 400)));
  app.post("/api/packages/:id/stop", (c) => withPackage(c, (id) => preparation.stopGenerating(id)));
  app.post("/api/packages/:id/parts/:part/retry", (c) => withPackage(c, (id) => {
    const s = step(c, c.req.param("part")!);
    return s instanceof Response ? s : preparation.retryPart(id, s);
  }));

  // A change from the master profile in the CV version: undo it (the line it replaced comes back) or redo it.
  app.post("/api/packages/:id/cv/changes/:change/undo", (c) => withPackage(c, (id) => preparation.undoCvChange(id, c.req.param("change")!)));
  app.post("/api/packages/:id/cv/changes/:change/redo", (c) => withPackage(c, (id) => preparation.redoCvChange(id, c.req.param("change")!)));
  // { choice }: one of the ways offered to fit the CV on one page, or "keep-two-pages".
  app.post("/api/packages/:id/cv/fit", (c) => withPackage(c, (id, body) =>
    typeof body.choice === "string" ? preparation.fitCv(id, body.choice) : c.json({ error: "choice must be one of the offered ways" }, 400)));

  // { option } or { own }: Kris's decision on a flag (one of its options, or her own wording).
  app.post("/api/packages/:id/cv/flags/:flag/decide", (c) => withPackage(c, (id, body) =>
    typeof body.option === "string" ? preparation.decideFlag(id, c.req.param("flag")!, { option: body.option })
      : typeof body.own === "string" ? preparation.decideFlag(id, c.req.param("flag")!, { own: body.own })
      : c.json({ error: "Send { option } or { own }" }, 400)));
  // { answer }: Kris's answer to a gap's question, for the coach.
  app.post("/api/packages/:id/cv/flags/:flag/answer", (c) => withPackage(c, (id, body) =>
    typeof body.answer === "string" ? preparation.answerGap(id, c.req.param("flag")!, body.answer) : c.json({ error: "answer must be text" }, 400)));

  // Screening answers (#66). { text }: Kris's answer to a question (her number, an option, her words).
  app.put("/api/packages/:id/answers/:question", (c) => withPackage(c, (id, body) =>
    typeof body.text === "string" ? preparation.setScreeningAnswer(id, c.req.param("question")!, body.text) : c.json({ error: "text must be text" }, 400)));
  app.post("/api/packages/:id/answers/:question/redraft", (c) => withPackage(c, (id) => preparation.redraftScreeningAnswer(id, c.req.param("question")!)));
  app.post("/api/packages/:id/answers/:question/save", (c) => withPackage(c, (id) => preparation.saveScreeningAnswerToBank(id, c.req.param("question")!)));
  // The drafter, for Apply: { question, language?, maxChars?, maxWords? } → { drafted, text, pieces } or { drafted: false, reason }.
  app.post("/api/packages/:id/draft-answer", (c) => withPackage(c, async (id, body) => {
    const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
    if (typeof body.question !== "string") return c.json({ error: "question must be text" }, 400);
    if (body.language !== undefined && body.language !== "en" && body.language !== "bg") return c.json({ error: "language must be en or bg" }, 400);
    const result = await preparation.draftAnswer(id, { question: body.question, language: body.language, maxChars: n(body.maxChars), maxWords: n(body.maxWords) });
    return c.json(result, result.drafted ? 200 : 422);
  }));

  // The CV's draft PDF, exactly as printed. ?download=1 saves it, named as a draft.
  app.get("/api/packages/:id/cv.pdf", async (c) => {
    const file = await preparation.packageCv(c.req.param("id"));
    if (!file) return c.json({ error: "This package has no CV yet" }, 404);
    const download = c.req.query("download") === "1";
    return c.body(Buffer.from(file.pdf), 200, {
      "content-type": "application/pdf",
      "cache-control": "no-store",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${download ? `DRAFT_${file.fileName}` : file.fileName}"`,
    });
  });
}
