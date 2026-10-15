import { describe, expect, it } from "vitest";
import type { DraftedPieces } from "@apply-kit/core";
import { CHINA_HOSTED_PROVIDERS } from "../openrouter.ts";
import { createOpenRouterWriter } from "./openrouter.ts";

/** Extracted text of a made-up CV (fictional person). */
const cv = { fileName: "mira-petrova-cv.pdf", text: "Mira Petrova\nSecurity Analyst, Northwind Bank, 2022–2025\nCut false positives by about a third." };

const drafted: DraftedPieces = {
  pieces: [{ kind: "achievement", text: "Cut false positives by about a third", quote: "Cut false positives by about a third.", entry: null, role: null }],
};

/** A fetch that records the request and answers like OpenRouter's chat completions endpoint. Never touches the network. */
function fakeOpenRouter(content: string = JSON.stringify(drafted)) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({
      id: "gen-1",
      object: "chat.completion",
      created: 1_760_000_000,
      model: "deepseek/deepseek-v4.1-flash",
      provider: "DeepInfra",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: 1200, completion_tokens: 400, total_tokens: 1600, cost: 0.00042 },
    });
  };
  return { fetch, requests };
}

describe("OpenRouter writer", () => {
  it("sends only the extracted text, pinned to non-China hosts that don't collect data", async () => {
    const api = fakeOpenRouter();
    const writer = createOpenRouterWriter({ apiKey: "test-key", fetch: api.fetch });

    await writer.draftPieces(cv);

    const { url, body } = api.requests[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(body.provider).toMatchObject({ data_collection: "deny", allow_fallbacks: false, require_parameters: true, ignore: CHINA_HOSTED_PROVIDERS });
    expect((body.provider as { only: string[] }).only).not.toContain("deepseek");
    expect(body.response_format).toMatchObject({ type: "json_schema" });
    expect(JSON.stringify(body.messages)).toContain("Cut false positives by about a third.");
  });

  it("returns the schema-checked pieces, the cost OpenRouter reports, and no excerpts", async () => {
    const writer = createOpenRouterWriter({ apiKey: "test-key", fetch: fakeOpenRouter().fetch });

    const result = await writer.draftPieces(cv);

    expect(result).toEqual({ output: drafted, costUsd: 0.00042, model: "deepseek/deepseek-v4.1-flash", excerpts: [] });
  });

  it("estimates a cost above what a typical call costs, without calling anything", () => {
    const api = fakeOpenRouter();
    const writer = createOpenRouterWriter({ apiKey: "test-key", fetch: api.fetch });

    const estimate = writer.estimateCostUsd({ task: "draft-pieces", input: cv });

    expect(api.requests).toHaveLength(0);
    expect(estimate).toBeGreaterThan(0.00042);
    expect(estimate).toBeLessThan(0.05);
  });

  it("throws when the answer doesn't fit the schema, carrying what the call was billed", async () => {
    const writer = createOpenRouterWriter({ apiKey: "test-key", fetch: fakeOpenRouter('{"pieces": "lots"}').fetch });

    const error = await writer.draftPieces(cv).then(() => null, (err: unknown) => err as { costUsd?: number });

    expect(error?.costUsd).toBeGreaterThan(0);
  });

  it("learns voice rules from only the excerpts and rules it's given, and reports exactly the excerpts it sent", async () => {
    const learned = { rules: [{ id: null, text: "Short declarative sentences", evidence: "about-page", language: null, sources: ["sample:s1"] }] };
    const api = fakeOpenRouter(JSON.stringify(learned));
    const writer = createOpenRouterWriter({ apiKey: "test-key", fetch: api.fetch });
    const excerpts = [{ source: "sample:s1", text: "I build small tools that make noisy systems quieter." }];

    const result = await writer.learnVoice({ rules: [{ id: "r1", text: "Signs off \"Kind regards\"", evidence: "2 samples" }], removed: ["Uses exclamation marks"], excerpts });

    const sent = JSON.stringify(api.requests[0]!.body.messages);
    expect(sent).toContain("I build small tools that make noisy systems quieter.");
    expect(sent).toContain("Uses exclamation marks");
    expect(result).toEqual({ output: learned, costUsd: 0.00042, model: "deepseek/deepseek-v4.1-flash", excerpts });
  });
});
