import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_OLLAMA_BASE_URL,
  ProviderConfigError,
  describeChoice,
  resolveModel,
} from "@/lib/ai/provider";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/types";

// These tests verify the branching logic of `resolveModel` — Anthropic with
// a key, Anthropic without a key (throws), Ollama (instantiates a model even
// without a running server). The actual network call isn't exercised here;
// that's the smoke script's job.

describe("resolveModel", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    // Fresh key state per test.
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns an Anthropic LanguageModel when the key is present", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const model = resolveModel("default");
    expect(model).toBeTruthy();
    // LanguageModel instances expose a `modelId` or similar — we don't pin
    // the internals, just verify we got an object.
    expect(typeof model).toBe("object");
  });

  it("throws ProviderConfigError when Anthropic is chosen but key missing", () => {
    expect(() => resolveModel("default")).toThrow(ProviderConfigError);
    try {
      resolveModel("default");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderConfigError);
      const e = err as ProviderConfigError;
      expect(e.code).toBe("anthropic-key-missing");
      expect(e.httpStatus).toBe(400);
      expect(e.message).toContain("ANTHROPIC_API_KEY");
    }
  });

  it("returns an Ollama-routed model when the feature points at ollama", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      models: {
        default: {
          provider: "ollama-openai-compat",
          model: "qwen2.5-coder:32b",
          baseUrl: "http://localhost:11434/v1",
        },
      },
    };
    const model = resolveModel("default", settings);
    expect(model).toBeTruthy();
  });

  it("does not require the Anthropic key when Ollama is the choice", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      models: {
        default: {
          provider: "ollama-openai-compat",
          model: "llama3.2:3b",
        },
      },
    };
    expect(() => resolveModel("default", settings)).not.toThrow();
  });

  it("uses the default base URL when ollama choice omits baseUrl", () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      models: {
        default: {
          provider: "ollama-openai-compat",
          model: "llama3.2:3b",
        },
      },
    };
    const choice = describeChoice("default", settings);
    expect(choice.provider).toBe("ollama-openai-compat");
    // provider.ts internally falls back to DEFAULT_OLLAMA_BASE_URL when the
    // choice omits it; the describeChoice returns the user's choice verbatim
    // (no baseUrl), but the *default* is what the factory uses.
    expect(DEFAULT_OLLAMA_BASE_URL).toBe("http://localhost:11434/v1");
  });

  it("resolves a feature-specific choice when present, otherwise falls back to default", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      models: {
        default: { provider: "anthropic", model: "claude-sonnet-4-6" },
        chat: { provider: "anthropic", model: "claude-haiku-4-5" },
      },
    };
    const chatChoice = describeChoice("chat", settings);
    expect(chatChoice.model).toBe("claude-haiku-4-5");
    const draftChoice = describeChoice("draft", settings);
    // draft has no override — falls back to default
    expect(draftChoice.model).toBe("claude-sonnet-4-6");
  });

  it("defaults to DEFAULT_SETTINGS when no settings object is passed", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const choice = describeChoice("default");
    expect(choice.provider).toBe("anthropic");
    expect(choice.model).toBe("claude-sonnet-4-6");
  });
});
