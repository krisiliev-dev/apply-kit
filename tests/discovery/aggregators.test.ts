import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPostings as fetchJooble,
  parseRef as joobleParseRef,
} from "@/lib/discovery/sources/jooble";
import {
  fetchPostings as fetchArbeitnow,
  parseRef as anParseRef,
} from "@/lib/discovery/sources/arbeitnow";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.JOOBLE_API_KEY;
});

function stubFetch(json: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => json })),
  );
}

describe("jooble aggregator", () => {
  it("parses 'keywords|location' refs", () => {
    expect(joobleParseRef("cyber security|Sofia")).toEqual({
      keywords: "cyber security",
      location: "Sofia",
    });
    expect(joobleParseRef("security")).toEqual({ keywords: "security", location: undefined });
  });

  it("throws without an API key", async () => {
    await expect(fetchJooble("security|Sofia")).rejects.toThrow(/JOOBLE_API_KEY/);
  });

  it("maps jooble jobs", async () => {
    process.env.JOOBLE_API_KEY = "k";
    stubFetch({
      jobs: [
        {
          title: "Security Engineer",
          company: "Acme",
          location: "Sofia",
          link: "https://x/1",
          snippet: "<b>do</b> security",
          updated: "2026-05-01T00:00:00Z",
        },
      ],
    });
    const out = await fetchJooble("cyber security|Sofia");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: { kind: "jooble", query: "cyber security|Sofia" },
      title: "Security Engineer",
      company: "Acme",
      location: "Sofia",
      url: "https://x/1",
      description: "do security",
    });
  });
});

describe("arbeitnow aggregator", () => {
  it("parses '*' to no-keyword", () => {
    expect(anParseRef("*")).toEqual({ keyword: "" });
    expect(anParseRef("security")).toEqual({ keyword: "security" });
  });

  it("filters the feed by keyword and flags remote", async () => {
    stubFetch({
      data: [
        { title: "Security Engineer", company_name: "Foo", url: "https://y/1", remote: true, location: "Berlin", tags: ["security"], created_at: 1700000000 },
        { title: "Sales Rep", company_name: "Bar", url: "https://y/2", tags: [], created_at: 1 },
      ],
    });
    const out = await fetchArbeitnow("security");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: { kind: "arbeitnow", query: "security" },
      title: "Security Engineer",
      company: "Foo",
      location: "Remote (Berlin)",
    });
  });
});
