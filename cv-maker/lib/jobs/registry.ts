"use client";

// Dynamic CV variant registry, persisted to localStorage. The static
// `content/cvs/index.ts` registry can't hold runtime-generated variants — so
// any CV the "apply" flow drafts is tracked here so the home page and
// /applications view can discover it.

const REGISTRY_KEY = "cv-maker:variants";

export type VariantRegistryEntry = {
  slug: string;
  targetRole: string;
  company?: string;
  createdAt: number;
  // Where the variant came from. "job" means auto-drafted from a job post.
  source: "job" | "manual";
};

function readRaw(): VariantRegistryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as VariantRegistryEntry[];
  } catch {
    return [];
  }
}

function writeRaw(entries: VariantRegistryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(entries));
  } catch {
    // Ignore quota errors.
  }
}

export function listVariants(): VariantRegistryEntry[] {
  return readRaw();
}

export function getVariant(slug: string): VariantRegistryEntry | undefined {
  return readRaw().find((v) => v.slug === slug);
}

export function upsertVariant(entry: VariantRegistryEntry) {
  const entries = readRaw().filter((v) => v.slug !== entry.slug);
  entries.push(entry);
  writeRaw(entries);
}

export function removeVariant(slug: string) {
  writeRaw(readRaw().filter((v) => v.slug !== slug));
}

// Builds a url-safe slug like "acme-senior-frontend-engineer".
export function makeVariantSlug(company: string, role: string): string {
  const norm = (s: string) =>
    s
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
