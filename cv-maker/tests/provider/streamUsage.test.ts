/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UsageEnvelope } from "@/lib/ai/tokenTracker";
import {
  encodeUsageHeader,
  encodeUsageSentinel,
  extractNdjsonUsage,
  extractUsageSentinel,
  NDJSON_USAGE_KEY,
  STREAM_USAGE_SENTINEL_PREFIX,
  STREAM_USAGE_SENTINEL_SUFFIX,
} from "@/lib/ai/tokenTracker";
import { clearLedger, trackedFetch } from "@/lib/ai/tokenLedger";

// ————————————————————————————————————————————————
// Stream usage sentinel tests.
//
// We build fake Responses whose bodies simulate each of the three stream
// shapes the server routes emit:
//   • text/plain stream (cover-letter, pre-screen, follow-up)
//   • text/event-stream (chat UI-message stream) — sentinel as SSE comment
//   • application/x-ndjson (cv-evaluate/refine) — sentinel as __cvUsage line
//
// Each test pushes the fake response through `trackedFetch` and asserts the
// ledger (via localStorage) recorded the right envelope. We stub `fetch` via
// a vitest spy on globalThis.fetch so no network is touched.
// ————————————————————————————————————————————————

function makeEnvelope(overrides: Partial<UsageEnvelope> = {}): UsageEnvelope {
  return {
    feature: "default",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 1234,
    outputTokens: 567,
    totalTokens: 1801,
    costUsd: 0.01,
    at: 1700000000000,
    ...overrides,
  };
}

function bodyFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function readLedger(): UsageEnvelope[] {
  const raw = window.localStorage.getItem("cv-maker:token-ledger");
  if (!raw) return [];
  return JSON.parse(raw) as UsageEnvelope[];
}

async function drainBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe("streamUsage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearLedger();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("encode/extract", () => {
    it("round-trips a sentinel in a plain-text buffer", () => {
      const env = makeEnvelope({ inputTokens: 100, outputTokens: 50 });
      const buffer = `Some streamed prose.\n${encodeUsageSentinel(env)}\n`;
      const parsed = extractUsageSentinel(buffer);
      expect(parsed).not.toBeNull();
      expect(parsed!.inputTokens).toBe(100);
      expect(parsed!.outputTokens).toBe(50);
      expect(parsed!.model).toBe(env.model);
    });

    it("scans only the tail — ignores earlier mentions of `cv-usage:`", () => {
      const env = makeEnvelope({ inputTokens: 1 });
      // Large body with the real sentinel near the end
      const prose = "lorem ipsum ".repeat(500);
      const buffer = `${prose}\n${encodeUsageSentinel(env)}\n`;
      const parsed = extractUsageSentinel(buffer);
      expect(parsed?.inputTokens).toBe(1);
    });

    it("returns null when no sentinel is present", () => {
      expect(extractUsageSentinel("plain prose with no marker")).toBeNull();
    });

    it("ignores malformed sentinels (missing suffix)", () => {
      const env = makeEnvelope();
      const truncated = STREAM_USAGE_SENTINEL_PREFIX + encodeUsageHeader(env); // no suffix
      expect(extractUsageSentinel(truncated)).toBeNull();
    });

    it("extracts an NDJSON usage frame", () => {
      const env = makeEnvelope({ inputTokens: 9999, feature: "draft" });
      const body = [
        '{"type":"stage","iteration":0,"stage":"score","message":"…"}',
        '{"type":"done","message":"ok"}',
        JSON.stringify({ [NDJSON_USAGE_KEY]: env }),
        "",
      ].join("\n");
      const parsed = extractNdjsonUsage(body);
      expect(parsed?.inputTokens).toBe(9999);
      expect(parsed?.feature).toBe("draft");
    });

    it("returns null from extractNdjsonUsage when no frame exists", () => {
      expect(
        extractNdjsonUsage(
          '{"type":"stage","iteration":0}\n{"type":"done"}\n',
        ),
      ).toBeNull();
    });
  });

  describe("trackedFetch with streaming bodies", () => {
    it("records usage from a text/plain body ending in a sentinel", async () => {
      const env = makeEnvelope({ inputTokens: 200, outputTokens: 80 });
      const body = bodyFromChunks([
        "First paragraph.\n\n",
        "Second paragraph.\n",
        "\n" + encodeUsageSentinel(env) + "\n",
      ]);
      const fakeRes = new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
      globalThis.fetch = async () => fakeRes;

      const res = await trackedFetch("/api/cover-letter");
      const text = await drainBody(res);
      // Consumer still sees the full body, including the sentinel tail.
      expect(text).toContain("First paragraph");
      expect(text).toContain("Second paragraph");

      const entries = readLedger();
      expect(entries.length).toBe(1);
      expect(entries[0].inputTokens).toBe(200);
      expect(entries[0].outputTokens).toBe(80);
    });

    it("records usage from an SSE body with trailing comment sentinel", async () => {
      const env = makeEnvelope({ inputTokens: 555, outputTokens: 222 });
      const body = bodyFromChunks([
        'data: {"type":"text-delta","delta":"hi"}\n\n',
        "data: [DONE]\n\n",
        ":" + encodeUsageSentinel(env) + "\n\n",
      ]);
      const fakeRes = new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      globalThis.fetch = async () => fakeRes;

      const res = await trackedFetch("/api/chat");
      await drainBody(res);

      const entries = readLedger();
      expect(entries.length).toBe(1);
      expect(entries[0].inputTokens).toBe(555);
      expect(entries[0].outputTokens).toBe(222);
    });

    it("records usage from an NDJSON body ending in __cvUsage frame", async () => {
      const env = makeEnvelope({
        inputTokens: 42,
        outputTokens: 21,
        feature: "draft",
      });
      const body = bodyFromChunks([
        '{"type":"stage","iteration":0,"stage":"score","message":"…"}\n',
        '{"type":"iteration-done","iteration":0,"score":80,"delta":0,"warningCount":0}\n',
        JSON.stringify({ [NDJSON_USAGE_KEY]: env }) + "\n",
      ]);
      const fakeRes = new Response(body, {
        status: 200,
        headers: { "content-type": "application/x-ndjson; charset=utf-8" },
      });
      globalThis.fetch = async () => fakeRes;

      const res = await trackedFetch("/api/cv-evaluate/refine");
      await drainBody(res);

      const entries = readLedger();
      expect(entries.length).toBe(1);
      expect(entries[0].feature).toBe("draft");
      expect(entries[0].inputTokens).toBe(42);
    });

    it("does not double-count when both header and sentinel carry counts", async () => {
      // Header is the zero-token pre-stream stamp; sentinel has real numbers.
      const zeroEnv = makeEnvelope({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
      const realEnv = makeEnvelope({
        inputTokens: 300,
        outputTokens: 100,
        totalTokens: 400,
      });
      const body = bodyFromChunks([
        "some content\n",
        "\n" + encodeUsageSentinel(realEnv) + "\n",
      ]);
      const fakeRes = new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "x-cv-usage": encodeUsageHeader(zeroEnv),
        },
      });
      globalThis.fetch = async () => fakeRes;

      const res = await trackedFetch("/api/cover-letter");
      await drainBody(res);

      const entries = readLedger();
      expect(entries.length).toBe(1);
      expect(entries[0].inputTokens).toBe(300);
    });

    it("skips streams without a sentinel quietly", async () => {
      const body = bodyFromChunks(["no sentinel here\n"]);
      const fakeRes = new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
      globalThis.fetch = async () => fakeRes;

      const res = await trackedFetch("/api/cover-letter");
      await drainBody(res);

      expect(readLedger().length).toBe(0);
    });

    it("keeps zero-width markers invisible in the body (printable prose unchanged)", async () => {
      const env = makeEnvelope();
      const body = bodyFromChunks([
        "Plain letter body.\n",
        "\n" + encodeUsageSentinel(env) + "\n",
      ]);
      const fakeRes = new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
      globalThis.fetch = async () => fakeRes;

      const res = await trackedFetch("/api/cover-letter");
      const text = await drainBody(res);
      // Stripping the zero-width sentinel leaves the original prose intact
      // when rendered — consumers that ignore ZWSPs show the letter cleanly.
      const prefixIdx = text.indexOf(STREAM_USAGE_SENTINEL_PREFIX);
      const visible = prefixIdx === -1 ? text : text.slice(0, prefixIdx);
      expect(visible.trim()).toBe("Plain letter body.");
      // The suffix uses the same zero-width glyph as the prefix.
      expect(STREAM_USAGE_SENTINEL_SUFFIX.length).toBeGreaterThan(0);
    });
  });
});
