import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CvDocument } from "./types";
import type { CVContent, Profile } from "@/lib/types";
import type { VariantRegistryEntry } from "@/lib/jobs/registry";
import {
  DEFAULT_DISCOVERY_PREFERENCES,
  type DiscoveryPreferences,
  type DiscoverySource,
  type JobPosting,
} from "@/lib/discovery/types";

// Server-side, file-backed store shared by the web app's API routes and the
// MCP server (via those routes). This is the bridge that lets an external
// agent operate the same CVs the browser edits.
//
// Layout under CV_MAKER_DATA_DIR (default ~/.cv-maker/data):
//   docs/<slug>.json   — one CvDocument per CV
//   variants.json      — VariantRegistryEntry[]
//   base.json          — { profile, cv, updatedAt } the AI tailors FROM
//
// Node-only. Never import from a client component.

export function dataDir(): string {
  const raw = process.env.CV_MAKER_DATA_DIR?.trim();
  if (raw) {
    if (raw === "~" || raw.startsWith("~/")) {
      return path.join(os.homedir(), raw.slice(1));
    }
    return raw;
  }
  return path.join(os.homedir(), ".cv-maker", "data");
}

const docsDir = () => path.join(dataDir(), "docs");
const variantsFile = () => path.join(dataDir(), "variants.json");
const baseFile = () => path.join(dataDir(), "base.json");

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// Write atomically: write a temp file then rename, so a crash mid-write can't
// leave a half-written JSON the browser would choke on.
async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

// Slugs become filenames, so they must be path-safe. The app's own
// makeVariantSlug already produces [a-z0-9-]; we re-validate here to refuse
// anything that could escape the docs dir.
export function assertSafeSlug(slug: string): string {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,80}$/i.test(slug)) {
    throw new Error(`Unsafe or invalid slug: ${JSON.stringify(slug)}`);
  }
  return slug;
}

// Mirror of lib/jobs/registry#makeVariantSlug, duplicated here so server code
// doesn't import the "use client" registry module.
export function makeSlug(company: string, role: string): string {
  const norm = (s: string) =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  const c = norm(company) || "company";
  const r = norm(role) || "role";
  return `${c}-${r}`;
}

export type DocMeta = { slug: string; targetRole: string; updatedAt: number };

export async function listDocMeta(): Promise<DocMeta[]> {
  await ensureDir(docsDir());
  const files = await fs.readdir(docsDir()).catch(() => [] as string[]);
  const out: DocMeta[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const doc = await readJsonFile<CvDocument>(path.join(docsDir(), f));
    if (doc?.slug) {
      out.push({
        slug: doc.slug,
        targetRole: doc.targetRole ?? "",
        updatedAt: doc.updatedAt ?? 0,
      });
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readDoc(slug: string): Promise<CvDocument | null> {
  return readJsonFile<CvDocument>(
    path.join(docsDir(), `${assertSafeSlug(slug)}.json`),
  );
}

export async function writeDoc(doc: CvDocument): Promise<void> {
  if (!doc?.slug) throw new Error("doc.slug is required");
  assertSafeSlug(doc.slug);
  const next: CvDocument = { ...doc, updatedAt: doc.updatedAt ?? Date.now() };
  await writeJsonFile(path.join(docsDir(), `${next.slug}.json`), next);
}

export async function deleteDoc(slug: string): Promise<void> {
  await fs.rm(path.join(docsDir(), `${assertSafeSlug(slug)}.json`), {
    force: true,
  });
}

export async function listVariants(): Promise<VariantRegistryEntry[]> {
  return (await readJsonFile<VariantRegistryEntry[]>(variantsFile())) ?? [];
}

export async function upsertVariant(entry: VariantRegistryEntry): Promise<void> {
  const list = (await listVariants()).filter((v) => v.slug !== entry.slug);
  list.push(entry);
  await writeJsonFile(variantsFile(), list);
}

export async function removeVariant(slug: string): Promise<void> {
  const list = (await listVariants()).filter((v) => v.slug !== slug);
  await writeJsonFile(variantsFile(), list);
}

export type BaseData = { profile: Profile; cv: CVContent; updatedAt: number };

export async function readBase(): Promise<BaseData | null> {
  return readJsonFile<BaseData>(baseFile());
}

export async function writeBase(input: {
  profile: Profile;
  cv: CVContent;
}): Promise<BaseData> {
  if (!input?.profile?.name) throw new Error("profile.name is required");
  if (!Array.isArray(input?.cv?.experiences)) {
    throw new Error("cv.experiences must be an array");
  }
  // Keep the cv's embedded profile in lockstep with the standalone one.
  const payload: BaseData = {
    profile: input.profile,
    cv: { ...input.cv, profile: input.profile },
    updatedAt: Date.now(),
  };
  await writeJsonFile(baseFile(), payload);
  return payload;
}

// ————————————————————————————————————————————————
// Discovery: preferences, source registry, and the postings pool. These let
// the MCP bridge drive job discovery (set prefs/sources, run a crawl, read the
// ranked pool) while the browser /discover page reads the same data.
// ————————————————————————————————————————————————

const discoveryPrefsFile = () => path.join(dataDir(), "discovery-prefs.json");
const sourcesFile = () => path.join(dataDir(), "discovery-sources.json");
const postingsFile = () => path.join(dataDir(), "discovery-postings.json");

export async function readDiscoveryPrefs(): Promise<DiscoveryPreferences> {
  return (
    (await readJsonFile<DiscoveryPreferences>(discoveryPrefsFile())) ??
    DEFAULT_DISCOVERY_PREFERENCES
  );
}

export async function writeDiscoveryPrefs(
  prefs: DiscoveryPreferences,
): Promise<void> {
  await writeJsonFile(discoveryPrefsFile(), prefs);
}

function sourceId(kind: string, ref: string): string {
  return `${kind}:${ref}`.toLowerCase();
}

export async function listSources(): Promise<DiscoverySource[]> {
  return (await readJsonFile<DiscoverySource[]>(sourcesFile())) ?? [];
}

export async function upsertSource(
  input: Omit<DiscoverySource, "id" | "enabled" | "addedBy" | "label"> & {
    id?: string;
    enabled?: boolean;
    addedBy?: DiscoverySource["addedBy"];
    label?: string;
  },
): Promise<DiscoverySource> {
  if (!input?.kind || !input?.ref) throw new Error("source kind and ref are required");
  const id = input.id ?? sourceId(input.kind, input.ref);
  const list = await listSources();
  const existing = list.find((s) => s.id === id);
  const entry: DiscoverySource = {
    id,
    kind: input.kind,
    ref: input.ref,
    label: input.label || input.ref,
    region: input.region ?? existing?.region,
    addedBy: input.addedBy ?? existing?.addedBy ?? "manual",
    enabled: input.enabled ?? existing?.enabled ?? true,
    lastCrawledAt: existing?.lastCrawledAt,
    note: input.note ?? existing?.note,
  };
  const next = [...list.filter((s) => s.id !== id), entry];
  await writeJsonFile(sourcesFile(), next);
  return entry;
}

export async function removeSource(id: string): Promise<void> {
  const list = await listSources();
  await writeJsonFile(sourcesFile(), list.filter((s) => s.id !== id));
}

export async function touchSourcesCrawled(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const set = new Set(ids);
  const now = Date.now();
  const list = await listSources();
  await writeJsonFile(
    sourcesFile(),
    list.map((s) => (set.has(s.id) ? { ...s, lastCrawledAt: now } : s)),
  );
}

// A posting in the pool, plus a `closedAt` stamp once it disappears from its
// source (the freshness signal for "this role is no longer available").
export type StoredPosting = JobPosting & { closedAt?: number };

export async function listPostings(): Promise<StoredPosting[]> {
  return (await readJsonFile<StoredPosting[]>(postingsFile())) ?? [];
}

export async function listOpenPostings(): Promise<StoredPosting[]> {
  return (await listPostings()).filter((p) => !p.closedAt);
}

export async function savePostings(postings: StoredPosting[]): Promise<void> {
  await writeJsonFile(postingsFile(), postings);
}

// Merge new postings into the pool, keyed by id; returns how many were new.
// Re-seeing a posting reopens it (clears closedAt).
export async function ingestPostings(postings: JobPosting[]): Promise<number> {
  const existing = await listPostings();
  const byId = new Map<string, StoredPosting>(existing.map((p) => [p.id, p]));
  let added = 0;
  for (const p of postings) {
    if (!byId.has(p.id)) added++;
    const prev = byId.get(p.id);
    byId.set(p.id, { ...prev, ...p, closedAt: undefined });
  }
  await savePostings([...byId.values()]);
  return added;
}

// Stable key identifying which source a posting came from — used to scope
// expiry to sources actually crawled this run.
export function postingSourceKey(p: JobPosting): string {
  switch (p.source.kind) {
    case "greenhouse":
    case "lever":
    case "ashby":
    case "smartrecruiters":
    case "workday":
      return `${p.source.kind}:${p.source.company}`;
    case "rss":
      return `rss:${p.source.feedUrl}`;
    case "careerpage":
      return `careerpage:${p.source.url}`;
    case "jooble":
      return `jooble:${p.source.query}`;
    case "arbeitnow":
      return `arbeitnow:${p.source.query ?? ""}`;
    case "jobapi":
      return `jobapi:${p.source.provider}:${p.source.query ?? ""}`;
    case "hn-hiring":
      return "hn-hiring:latest";
    default:
      return p.source.kind;
  }
}

// Mark postings whose source was crawled this run but that didn't reappear as
// closed. Postings from sources not crawled this run are left untouched.
// Returns how many were newly closed.
export async function expireMissing(
  crawledKeys: Set<string>,
  liveIds: Set<string>,
): Promise<number> {
  const all = await listPostings();
  const now = Date.now();
  let closed = 0;
  const next = all.map((p) => {
    if (p.closedAt) return p;
    if (!crawledKeys.has(postingSourceKey(p))) return p;
    if (liveIds.has(p.id)) return p;
    closed++;
    return { ...p, closedAt: now };
  });
  if (closed > 0) await savePostings(next);
  return closed;
}

// Build an effective DiscoveryPreferences for the aggregator by folding the
// enabled ATS/RSS sources into the watchlist. careerpage/board sources are
// handled by the puppeteer extractor (separate path), so they're skipped here.
export function effectivePrefs(
  prefs: DiscoveryPreferences,
  sources: DiscoverySource[],
): DiscoveryPreferences {
  const greenhouse = new Set(prefs.watchlist.greenhouse);
  const lever = new Set(prefs.watchlist.lever);
  const ashby = new Set(prefs.watchlist.ashby);
  const rssFeeds = new Set(prefs.rssFeeds);
  for (const s of sources) {
    if (!s.enabled) continue;
    if (s.kind === "greenhouse") greenhouse.add(s.ref);
    else if (s.kind === "lever") lever.add(s.ref);
    else if (s.kind === "ashby") ashby.add(s.ref);
    else if (s.kind === "rss") rssFeeds.add(s.ref);
  }
  return {
    ...prefs,
    watchlist: {
      greenhouse: [...greenhouse],
      lever: [...lever],
      ashby: [...ashby],
    },
    rssFeeds: [...rssFeeds],
  };
}
