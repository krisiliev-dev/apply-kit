import { expect, it } from "vitest";
import { createProfileConsolidator } from "./consolidation.ts";
import type { ProfilePiece } from "@apply-kit/core";

it("asks for existing piece IDs only, sends only reconciliation facts, and preserves billed usage on failure", async () => {
  let body: Record<string, unknown> = {};
  let content = JSON.stringify({ groups: [{ ids: ["p1", "p2"], reason: "Same skill" }] });
  const proposer = createProfileConsolidator({ apiKey: "test-key", fetch: async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ id: "gen-1", object: "chat.completion", created: 1, model: "fake/model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, cost: 0.0001 } });
  } });
  const piece: ProfilePiece = { id: "p1", kind: "skill", text: "Python", entry: null, belongsTo: null, tags: [], angles: [], status: "unconfirmed", numberSource: null, source: { from: "CV-2024.pdf", quote: "PRIVATE-QUOTE" }, alsoFrom: [], checkThis: false, dispute: null, createdAt: "", updatedAt: "" };
  expect(await proposer.propose([piece, { ...piece, id: "p2", text: "Python programming" }])).toMatchObject({ groups: [{ ids: ["p1", "p2"] }], costUsd: 0.0001 });
  expect(JSON.stringify(body.messages)).toContain("Python programming");
  expect(JSON.stringify(body.messages)).not.toContain("PRIVATE-QUOTE");
  expect(body.provider).toMatchObject({ data_collection: "deny", require_parameters: true });
  expect(body.reasoning).toMatchObject({ enabled: false });
  content = "invalid";
  await expect(proposer.propose([piece])).rejects.toMatchObject({ costUsd: expect.any(Number) });
});
