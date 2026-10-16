import { describe, expect, it } from "vitest";
import type { PostingFacts } from "@apply-kit/core";
import { CHINA_HOSTED_PROVIDERS, createOpenRouterExtractor } from "./openrouter.ts";

const facts: PostingFacts = {
  language: "en",
  titleTranslation: null,
  requirements: [{ text: "TypeScript", kind: "required", category: "skill", source: { quote: "Strong TypeScript", translation: null }, confidence: 0.9 }],
  years: [],
  languages: [],
  certificates: [],
  workAuthorisation: { summary: "Not stated", visaSponsorship: "not-stated", source: null, confidence: 1 },
  remote: { mode: "remote", summary: "Remote within the EU", locations: ["EU"], source: { quote: "Remote (EU)", translation: null }, confidence: 0.9 },
  salary: { stated: false, min: null, max: null, currency: null, period: null, basis: "not-stated", source: null, confidence: 1 },
};

const input = { title: "Frontend Developer", company: "Brightwave", location: "Remote", text: "Strong TypeScript\nRemote (EU)" };

/** A fetch that records the request and answers like OpenRouter's chat completions endpoint. Never touches the network. */
function fakeOpenRouter(content: string = JSON.stringify(facts)) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
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

describe("OpenRouter extractor", () => {
  it("pins the request to non-China hosts that don't collect data", async () => {
    const api = fakeOpenRouter();
    const extractor = createOpenRouterExtractor({ apiKey: "test-key", fetch: api.fetch });

    await extractor.extract(input);

    const { url, headers, body } = api.requests[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
    const provider = body.provider as Record<string, unknown>;
    expect(provider).toMatchObject({ data_collection: "deny", allow_fallbacks: false, require_parameters: true });
    expect(provider.ignore).toEqual(CHINA_HOSTED_PROVIDERS);
    expect(provider.ignore).toEqual(expect.arrayContaining(["deepseek", "baidu", "alibaba", "siliconflow", "streamlake"]));
    expect(provider.only).toEqual(["deepinfra", "together", "fireworks", "coreweave", "baseten", "parasail", "crusoe", "digitalocean", "modal"]);
    expect(body.response_format).toMatchObject({ type: "json_schema" });
  });

  it("drops China-hosted providers from a configured provider list", async () => {
    const api = fakeOpenRouter();
    const extractor = createOpenRouterExtractor({
      apiKey: "test-key", fetch: api.fetch, providers: ["deepinfra", "DeepSeek", "siliconflow/fp8", "fireworks/us"],
    });

    await extractor.extract(input);

    expect((api.requests[0]!.body.provider as { only: string[] }).only).toEqual(["deepinfra", "fireworks/us"]);
  });

  it("refuses to run with only China-hosted providers configured", () => {
    expect(() => createOpenRouterExtractor({ apiKey: "k", providers: ["deepseek", "alibaba"] })).toThrow(/non-China/);
  });

  it("returns the schema-checked facts and the cost OpenRouter reports", async () => {
    const extractor = createOpenRouterExtractor({ apiKey: "test-key", fetch: fakeOpenRouter().fetch });

    const result = await extractor.extract(input);

    expect(result).toEqual({ facts, costUsd: 0.00042, model: "deepseek/deepseek-v4.1-flash" });
  });

  it("normalises model language names to the codes used for package language", async () => {
    for (const [language, code] of [["Bulgarian", "bg"], ["English", "en"], ["BG", "bg"]]) {
      const extractor = createOpenRouterExtractor({ apiKey: "test-key", fetch: fakeOpenRouter(JSON.stringify({ ...facts, language })).fetch });
      expect((await extractor.extract(input)).facts.language).toBe(code);
    }
  });

  it("makes the posting language code explicit in the model contract", async () => {
    const api = fakeOpenRouter();
    await createOpenRouterExtractor({ apiKey: "test-key", fetch: api.fetch }).extract(input);
    expect(JSON.stringify(api.requests[0]!.body)).toContain("ISO 639-1");
  });

  it("keeps billed usage when structured output is rejected", async () => {
    const extractor = createOpenRouterExtractor({ apiKey: "test-key", fetch: fakeOpenRouter("truncated {").fetch });
    await expect(extractor.extract(input)).rejects.toMatchObject({ costUsd: expect.any(Number) });
  });

  it("estimates a cost above what a typical read costs, without calling anything", () => {
    const api = fakeOpenRouter();
    const extractor = createOpenRouterExtractor({ apiKey: "test-key", fetch: api.fetch });

    const estimate = extractor.estimateCostUsd(input);

    expect(api.requests).toHaveLength(0);
    expect(estimate).toBeGreaterThan(0.00042);
    expect(estimate).toBeLessThan(0.02);
  });

  it("throws when the answer doesn't fit the fact schema", async () => {
    const extractor = createOpenRouterExtractor({ apiKey: "test-key", fetch: fakeOpenRouter('{"requirements": "lots"}').fetch });

    await expect(extractor.extract(input)).rejects.toThrow();
  });
});
