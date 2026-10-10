import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { A4, defaultTheme, type CvDocument } from "@/lib/doc/types";
import type { CVContent } from "@/lib/types";
import {
  assertSafeSlug,
  deleteDoc,
  effectivePrefs,
  expireMissing,
  ingestPostings,
  listDocMeta,
  listOpenPostings,
  listPostings,
  listSources,
  listVariants,
  makeSlug,
  readBase,
  readDiscoveryPrefs,
  readDoc,
  removeSource,
  removeVariant,
  upsertSource,
  upsertVariant,
  writeBase,
  writeDiscoveryPrefs,
  writeDoc,
} from "@/lib/doc/serverStore";
import {
  DEFAULT_DISCOVERY_PREFERENCES,
  type JobPosting,
} from "@/lib/discovery/types";

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cvstore-"));
  process.env.CV_MAKER_DATA_DIR = tmp;
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
});

function makeDoc(slug: string, updatedAt = 1): CvDocument {
  return {
    slug,
    targetRole: "Engineer",
    pages: [{ id: "p1", width: A4.width, height: A4.height, nodes: [] }],
    theme: defaultTheme,
    updatedAt,
  };
}

describe("serverStore docs", () => {
  it("round-trips a document", async () => {
    await writeDoc(makeDoc("me", 100));
    const got = await readDoc("me");
    expect(got?.slug).toBe("me");
    expect(got?.updatedAt).toBe(100);
  });

  it("lists doc metadata newest-first", async () => {
    await writeDoc(makeDoc("old", 100));
    await writeDoc(makeDoc("new", 200));
    const meta = await listDocMeta();
    expect(meta.map((m) => m.slug)).toEqual(["new", "old"]);
  });

  it("returns null for a missing doc and after delete", async () => {
    expect(await readDoc("ghost")).toBeNull();
    await writeDoc(makeDoc("temp"));
    await deleteDoc("temp");
    expect(await readDoc("temp")).toBeNull();
  });
});

describe("serverStore variants", () => {
  it("upserts, lists, and removes variants", async () => {
    await upsertVariant({ slug: "a", targetRole: "X", createdAt: 1, source: "job" });
    await upsertVariant({ slug: "a", targetRole: "X2", createdAt: 2, source: "job" });
    let list = await listVariants();
    expect(list).toHaveLength(1);
    expect(list[0].targetRole).toBe("X2");
    await removeVariant("a");
    list = await listVariants();
    expect(list).toHaveLength(0);
  });
});

describe("serverStore base", () => {
  it("writes and reads base data, keeping cv.profile in lockstep", async () => {
    expect(await readBase()).toBeNull();
    const profile = { name: "Kris", title: "Eng", email: "k@example.com" };
    const cv: CVContent = {
      slug: "me",
      targetRole: "Eng",
      profile: { name: "stale", title: "stale", email: "stale" },
      experiences: [],
      education: [],
    };
    const saved = await writeBase({ profile, cv });
    expect(saved.updatedAt).toBeGreaterThan(0);
    const got = await readBase();
    expect(got?.profile.name).toBe("Kris");
    // cv.profile must be overwritten with the canonical profile
    expect(got?.cv.profile.name).toBe("Kris");
  });

  it("rejects base without an experiences array", async () => {
    const badCv = { slug: "me", targetRole: "x" } as unknown as CVContent;
    await expect(
      writeBase({ profile: { name: "x", title: "t", email: "y" }, cv: badCv }),
    ).rejects.toThrow();
  });
});

describe("slug safety", () => {
  it("accepts clean slugs and rejects traversal", () => {
    expect(assertSafeSlug("acme-security-engineer")).toBe("acme-security-engineer");
    expect(() => assertSafeSlug("../etc/passwd")).toThrow();
    expect(() => assertSafeSlug("a/b")).toThrow();
    expect(() => assertSafeSlug("")).toThrow();
  });

  it("makeSlug normalizes company + role", () => {
    expect(makeSlug("Acme Corp!", "Senior Engineer")).toBe("acme-corp-senior-engineer");
    expect(makeSlug("", "")).toBe("company-role");
  });
});

describe("discovery prefs + sources", () => {
  it("defaults prefs then persists a patch", async () => {
    expect(await readDiscoveryPrefs()).toEqual(DEFAULT_DISCOVERY_PREFERENCES);
    await writeDiscoveryPrefs({
      ...DEFAULT_DISCOVERY_PREFERENCES,
      workAuth: ["UK", "EU"],
      preferredLocations: ["Sofia", "Manchester"],
      trackHnHiring: true,
    });
    const got = await readDiscoveryPrefs();
    expect(got.workAuth).toEqual(["UK", "EU"]);
    expect(got.trackHnHiring).toBe(true);
  });

  it("upserts sources with deterministic ids and removes them", async () => {
    await upsertSource({ kind: "greenhouse", ref: "Vercel", label: "Vercel", addedBy: "research" });
    await upsertSource({ kind: "greenhouse", ref: "Vercel", label: "Vercel Inc" }); // update
    let list = await listSources();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("greenhouse:vercel");
    expect(list[0].label).toBe("Vercel Inc");
    expect(list[0].enabled).toBe(true);
    await removeSource("greenhouse:vercel");
    expect(await listSources()).toHaveLength(0);
  });

  it("folds enabled ATS/RSS sources into effective prefs, skipping disabled + careerpage", () => {
    const prefs = { ...DEFAULT_DISCOVERY_PREFERENCES, watchlist: { greenhouse: ["a"], lever: [], ashby: [] } };
    const eff = effectivePrefs(prefs, [
      { id: "greenhouse:b", kind: "greenhouse", ref: "b", label: "b", addedBy: "research", enabled: true },
      { id: "rss:x", kind: "rss", ref: "https://x/feed", label: "x", addedBy: "research", enabled: true },
      { id: "lever:c", kind: "lever", ref: "c", label: "c", addedBy: "research", enabled: false },
      { id: "careerpage:y", kind: "careerpage", ref: "https://y/careers", label: "y", addedBy: "research", enabled: true },
    ]);
    expect(eff.watchlist.greenhouse.sort()).toEqual(["a", "b"]);
    expect(eff.watchlist.lever).toEqual([]); // disabled excluded
    expect(eff.rssFeeds).toEqual(["https://x/feed"]);
  });
});

describe("discovery postings pool", () => {
  const posting = (id: string): JobPosting => ({
    id,
    source: { kind: "greenhouse", company: "acme" },
    url: `https://acme/jobs/${id}`,
    title: "Security Engineer",
    company: "Acme",
    fetchedAt: 1,
  });

  it("merges by id and reports new count", async () => {
    expect(await ingestPostings([posting("p1")])).toBe(1);
    expect(await ingestPostings([posting("p1"), posting("p2")])).toBe(1);
    const all = await listPostings();
    expect(all.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("expires postings whose source was crawled but that vanished, then reopens on re-crawl", async () => {
    await ingestPostings([posting("p1"), posting("p2")]);
    // Crawl greenhouse:acme again; only p1 came back → p2 should close.
    const closed = await expireMissing(
      new Set(["greenhouse:acme"]),
      new Set(["p1"]),
    );
    expect(closed).toBe(1);
    expect((await listOpenPostings()).map((p) => p.id)).toEqual(["p1"]);
    expect((await listPostings())).toHaveLength(2); // closed one is retained

    // p2 reappears in a later crawl → reopened.
    await ingestPostings([posting("p2")]);
    expect((await listOpenPostings()).map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("leaves postings from un-crawled sources untouched", async () => {
    await ingestPostings([posting("p1")]);
    const closed = await expireMissing(new Set(["lever:other"]), new Set());
    expect(closed).toBe(0);
    expect(await listOpenPostings()).toHaveLength(1);
  });
});
