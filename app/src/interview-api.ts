// The coach interview's API (ticket #57): start or resume it (setup's, or one about an angle),
// answer, "I don't remember", skip, pause, try again, decide a near-the-line piece, remove or edit
// what it wrote, and finish. The coach writes in the background; the UI follows GET /api/interview.
// Mutations need a JSON body or Content-Type, like the rest of the service.
import type { Context, Hono } from "hono";
import { angles, type Angle, type InterviewChange, type PreparationEngine } from "@apply-kit/core";

type Body = Record<string, unknown>;
const needsJson = { error: "Send a JSON body with Content-Type: application/json" };

export function mountInterviewApi(app: Hono, preparation: PreparationEngine): void {
  const angleOf = (value: unknown): Angle | null | undefined =>
    value == null || value === "" ? null : angles.includes(value as Angle) ? (value as Angle) : undefined;
  const idOk = (id: string) => id === "setup" || angles.some((a) => id === `angle:${a}`);
  const change = (c: Context, result: InterviewChange) => c.json(result, result.changed ? 200 : 422);

  // ?angle=design for the interview about one angle; setup's otherwise. Doesn't start anything.
  app.get("/api/interview", (c) => {
    const angle = angleOf(c.req.query("angle"));
    if (angle === undefined) return c.json({ error: `angle must be one of ${angles.join(", ")}` }, 400);
    return c.json(preparation.interview(angle ? `angle:${angle}` : "setup"));
  });

  // { angle? }: starts the interview, or resumes it at the same question.
  app.post("/api/interview/start", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json(needsJson, 415);
    const angle = angleOf(body.angle);
    if (angle === undefined) return c.json({ error: `angle must be one of ${angles.join(", ")}` }, 400);
    return c.json(preparation.startInterview(angle));
  });

  // { text }
  app.post("/api/interviews/:id/answer", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json(needsJson, 415);
    if (!idOk(c.req.param("id"))) return c.json({ error: "No such interview." }, 404);
    if (typeof body.text !== "string") return c.json({ error: "Send { text }" }, 400);
    return change(c, preparation.answerInterview(c.req.param("id"), body.text));
  });

  const simple = { "dont-remember": preparation.dontRemember, skip: preparation.skipQuestion, retry: preparation.retryInterview } as const;
  for (const [path, run] of Object.entries(simple)) {
    app.post(`/api/interviews/:id/${path}`, (c) => {
      if (!jsonOnly(c)) return c.json(needsJson, 415);
      if (!idOk(c.req.param("id"))) return c.json({ error: "No such interview." }, 404);
      return change(c, run(c.req.param("id")));
    });
  }

  app.post("/api/interviews/:id/pause", (c) => {
    if (!jsonOnly(c)) return c.json(needsJson, 415);
    if (!idOk(c.req.param("id"))) return c.json({ error: "No such interview." }, 404);
    return c.json(preparation.pauseInterview(c.req.param("id")));
  });

  app.post("/api/interviews/:id/finish", (c) => {
    if (!jsonOnly(c)) return c.json(needsJson, 415);
    if (!idOk(c.req.param("id"))) return c.json({ error: "No such interview." }, 404);
    const result = preparation.finishInterview(c.req.param("id"));
    return c.json(result, result.finished ? 200 : 422);
  });

  // { choice: "honest" | "stronger" }
  app.post("/api/interview/items/:id/decide", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json(needsJson, 415);
    if (body.choice !== "honest" && body.choice !== "stronger") return c.json({ error: 'choice must be "honest" or "stronger"' }, 400);
    return change(c, preparation.decideInterviewPiece(c.req.param("id"), body.choice));
  });

  app.post("/api/interview/items/:id/remove", (c) => {
    if (!jsonOnly(c)) return c.json(needsJson, 415);
    return change(c, preparation.removeInterviewItem(c.req.param("id")));
  });

  // { text }: a standard answer's new wording, before it goes to the answer bank.
  app.put("/api/interview/items/:id/answer", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json(needsJson, 415);
    if (typeof body.text !== "string") return c.json({ error: "Send { text }" }, 400);
    return change(c, preparation.editInterviewAnswer(c.req.param("id"), body.text));
  });
}

const jsonOnly = (c: Context) => c.req.header("content-type")?.startsWith("application/json") ?? false;

async function jsonBody(c: Context): Promise<Body | null> {
  if (!jsonOnly(c)) return null;
  const body: unknown = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : null;
}
