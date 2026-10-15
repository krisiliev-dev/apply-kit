// Setup's API (ticket #55): the check-drafts list with its filters, "Confirm N unflagged" per role,
// picking between sources that disagree, discard and restore, where Kris is in setup (to resume
// there), the search pre-filled from the profile, and the summary at the end. Mutations need a JSON
// body or Content-Type, like the rest of the service, so a web page can't send one without a CORS preflight.
import type { Context, Hono } from "hono";
import { draftFilters, setupSteps, type DraftFilter, type PreparationEngine, type SetupStep } from "@apply-kit/core";

type Body = Record<string, unknown>;
const notFound = { error: "No such piece. It may have been deleted." };

export function mountSetupApi(app: Hono, preparation: PreparationEngine): void {
  app.get("/api/setup", (c) => c.json(preparation.setupProgress()));

  // { step }: where Kris is now; Setup opens there next time.
  app.put("/api/setup/step", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    if (!setupSteps.includes(body.step as SetupStep)) return c.json({ error: `step must be one of ${setupSteps.join(", ")}` }, 400);
    return c.json(preparation.setSetupStep(body.step as SetupStep));
  });

  app.post("/api/setup/skip", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    return c.json(preparation.skipSetup());
  });

  // ?show=to-check|flagged|confirmed|discarded
  app.get("/api/setup/drafts", (c) => {
    const show = c.req.query("show") || "to-check";
    if (!draftFilters.includes(show as DraftFilter)) return c.json({ error: `Unknown filter "${show}"` }, 400);
    return c.json(preparation.draftsToCheck(show as DraftFilter));
  });

  // Confirms a role's unflagged pieces ("none" for the pieces tied to no role).
  app.post("/api/setup/drafts/groups/:id/confirm", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    return c.json(preparation.confirmDrafts(c.req.param("id")));
  });

  // { version } (the index of the true version) or { askCoach: true }.
  app.post("/api/setup/drafts/:id/dispute", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const choice = body.askCoach === true ? { askCoach: true as const }
      : Number.isInteger(body.version) ? { version: body.version as number }
      : null;
    if (!choice) return c.json({ error: "Send { version } or { askCoach: true }" }, 400);
    const result = preparation.resolveDispute(c.req.param("id"), choice);
    return c.json(result, result.saved ? 200 : 422);
  });

  app.post("/api/setup/drafts/:id/discard", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    const piece = preparation.discardPiece(c.req.param("id"));
    return piece ? c.json(piece) : c.json(notFound, 404);
  });

  app.post("/api/setup/drafts/:id/restore", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    const piece = preparation.restorePiece(c.req.param("id"));
    return piece ? c.json(piece) : c.json({ error: "That piece isn't among the discarded ones." }, 404);
  });

  app.post("/api/setup/drafts/:id/unconfirm", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    const piece = preparation.unconfirmPiece(c.req.param("id"));
    return piece ? c.json(piece) : c.json(notFound, 404);
  });

  app.get("/api/setup/search", (c) => c.json(preparation.searchSuggestion()));
  app.get("/api/setup/summary", (c) => c.json(preparation.setupSummary()));
}

const jsonOnly = (c: Context) => c.req.header("content-type")?.startsWith("application/json") ?? false;

async function jsonBody(c: Context): Promise<Body | null> {
  if (!jsonOnly(c)) return null;
  const body: unknown = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : null;
}
