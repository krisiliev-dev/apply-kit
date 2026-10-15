// The answer bank's API for Profile (ticket #56): the table with its filters and paging, one answer
// with its history, Add and Edit, Delete, and "keep new or old" for an answer changed in a portal.
// Apply (#40) reaches the bank through the preparation engine's contract, not these routes.
// Mutations need a JSON body, like the rest of the service, so a web page can't send one without a CORS preflight.
import type { Hono } from "hono";
import {
  answerCategories, answerKinds, answerLanguages, answerModes,
  type AnswerCategory, type AnswerInput, type AnswerKind, type AnswerLanguage, type AnswerMode, type AnswerRule, type PreparationEngine,
} from "@apply-kit/core";
import { jsonBody, jsonOnly } from "./profile-api.ts";

type Body = Record<string, unknown>;

export function mountAnswerApi(app: Hono, preparation: PreparationEngine): void {
  // ?category=standard&stale=1&q=notice&page=2, each optional.
  app.get("/api/profile/answers", (c) => {
    const category = c.req.query("category") || undefined;
    if (category && !answerCategories.includes(category as AnswerCategory)) return c.json({ error: `Unknown category "${category}"` }, 400);
    const page = Number(c.req.query("page") ?? 1);
    return c.json(preparation.listAnswers({
      category: category as AnswerCategory | undefined,
      notUsedIn90Days: c.req.query("stale") === "1",
      search: c.req.query("q"),
      page: Number.isFinite(page) ? page : 1,
    }));
  });

  app.get("/api/profile/answers/:id", (c) => {
    const id = c.req.param("id");
    const answer = preparation.answer(id);
    return answer ? c.json({ answer, history: preparation.answerHistory(id) }) : c.json({ error: "No such answer. It may have been deleted." }, 404);
  });

  // Adds an answer, or saves an edit when the body has its id. A refused answer answers 422 with its problems.
  app.post("/api/profile/answers", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const input = answerInput(body);
    if (typeof input === "string") return c.json({ error: input }, 400);
    const result = preparation.saveAnswer(input);
    return c.json(result, !result.saved ? 422 : input.id ? 200 : 201);
  });

  app.post("/api/profile/answers/:id/delete", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    return preparation.deleteAnswer(c.req.param("id"))
      ? c.json({ deleted: true })
      : c.json({ error: "No such answer. It may have been deleted already." }, 404);
  });

  // { keep: "keep-new" | "keep-old" }
  app.post("/api/profile/answers/:id/portal-edit", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    if (body.keep !== "keep-new" && body.keep !== "keep-old") return c.json({ error: "keep must be keep-new or keep-old" }, 400);
    const answer = preparation.resolvePortalEdit(c.req.param("id"), body.keep);
    return answer ? c.json(answer) : c.json({ error: "No such answer. It may have been deleted." }, 404);
  });
}

/** The answer the form sent, or what's wrong with its shape (the engine checks the content). */
function answerInput(b: Body): AnswerInput | string {
  if (!answerCategories.includes(b.category as AnswerCategory)) return "category must be standard or screening";
  if (b.kind !== undefined && !answerKinds.includes(b.kind as AnswerKind)) return `kind must be one of ${answerKinds.join(", ")}`;
  if (b.mode !== undefined && !answerModes.includes(b.mode as AnswerMode)) return "mode must be fill, ask or blank";
  if (b.id !== undefined && typeof b.id !== "string") return "id must be an answer id";
  const v = b.versions && typeof b.versions === "object" ? (b.versions as Body) : {};
  const versions: Partial<Record<AnswerLanguage, string>> = {};
  for (const l of answerLanguages) if (typeof v[l] === "string") versions[l] = v[l];
  return {
    ...(typeof b.id === "string" && { id: b.id }),
    question: typeof b.question === "string" ? b.question : "",
    wordings: Array.isArray(b.wordings) ? b.wordings.filter((w): w is string => typeof w === "string") : [],
    versions,
    category: b.category as AnswerCategory,
    kind: (b.kind as AnswerKind | undefined) ?? "text",
    mode: (b.mode as AnswerMode | undefined) ?? "fill",
    rule: ruleInput(b.rule),
  };
}

function ruleInput(r: unknown): AnswerRule | null {
  if (!r || typeof r !== "object") return null;
  const { text, params } = r as Body;
  if (typeof text !== "string" || !text.trim()) return null;
  const p = params && typeof params === "object" ? (params as Body) : null;
  const floor = p && (typeof p.floor === "number" || p.floor === null) ? p.floor : null;
  return { text, params: p?.kind === "salary" ? { kind: "salary", take: "upper-half", floor, currency: "EUR" } : null };
}
