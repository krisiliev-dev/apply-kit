import type { CVContent, Profile } from "@/lib/types";
import { profile as demoProfile } from "@/content/profile";
import { defaultCV as demoCv } from "@/content/cvs/default";

// The "base" identity that AI features tailor FROM — fit-check, drafting,
// advisor, follow-ups, and the editor's default-doc seed all read it here.
//
// By default this is the shipped demo persona (Ines Valverde). The user's
// real data is NEVER committed: it lives only in localStorage, written via
// Settings → Data. That keeps personal data out of the repo entirely (it's
// not even a file on disk an accidental `git add` could catch) and avoids
// build-time optional-import fragility. Server contexts (API routes) can't
// read localStorage, so they fall back to the demo and rely on the client to
// pass the real profile in the request body.

export const BASE_PROFILE_KEY = "cv-maker:base-profile";
export const BASE_CV_KEY = "cv-maker:base-cv";
// Tracks when the local base was last set, so we can reconcile against the
// shared server store (which the MCP `write_base` tool writes to).
export const BASE_UPDATED_AT_KEY = "cv-maker:base-updated-at";

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getBaseProfile(): Profile {
  return readJson<Profile>(BASE_PROFILE_KEY) ?? demoProfile;
}

export function getBaseCv(): CVContent {
  return readJson<CVContent>(BASE_CV_KEY) ?? demoCv;
}

/** True once the user has loaded their own data (i.e. not on the demo). */
export function hasLocalBase(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(localStorage.getItem(BASE_CV_KEY));
}

export type BaseImport = { profile: Profile; cv: CVContent };

/** Parse + structurally validate a pasted base blob. Throws on bad shape. */
export function parseBaseImport(raw: string): BaseImport {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Not valid JSON.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Expected a JSON object with `profile` and `cv`.");
  }
  const obj = data as Record<string, unknown>;
  const profile = obj.profile as Profile | undefined;
  const cv = obj.cv as CVContent | undefined;
  if (!profile || typeof profile.name !== "string" || !profile.name.trim()) {
    throw new Error("`profile.name` is required.");
  }
  if (typeof profile.email !== "string" || !profile.email.trim()) {
    throw new Error("`profile.email` is required.");
  }
  if (!cv || !Array.isArray(cv.experiences)) {
    throw new Error("`cv.experiences` (array) is required.");
  }
  if (!Array.isArray(cv.education)) {
    throw new Error("`cv.education` (array) is required.");
  }
  return { profile, cv };
}

/** Persist the user's real base identity to localStorage. */
export function setLocalBase({ profile, cv }: BaseImport): void {
  if (typeof window === "undefined") return;
  // Keep the cv's profile in lockstep with the standalone profile so the
  // seed/masthead and the AI context never disagree.
  const normalized: CVContent = {
    ...cv,
    profile,
    slug: cv.slug?.trim() || "me",
    targetRole: cv.targetRole?.trim() || "Generalist",
  };
  localStorage.setItem(BASE_PROFILE_KEY, JSON.stringify(profile));
  localStorage.setItem(BASE_CV_KEY, JSON.stringify(normalized));
  localStorage.setItem(BASE_UPDATED_AT_KEY, String(Date.now()));
}

/** Revert to the shipped demo persona. */
export function clearLocalBase(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(BASE_PROFILE_KEY);
  localStorage.removeItem(BASE_CV_KEY);
  localStorage.removeItem(BASE_UPDATED_AT_KEY);
}

function localBaseUpdatedAt(): number {
  if (typeof window === "undefined") return -1;
  const raw = localStorage.getItem(BASE_UPDATED_AT_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : -1;
}

// ————————————————————————————————————————————————
// Shared-store sync. The base lives in the server store too (base.json) so the
// MCP `write_base` tool can set it. These helpers reconcile the two.
// ————————————————————————————————————————————————

/** Push the local base to the shared server store. Best-effort. */
export async function pushBaseToServer(input: BaseImport): Promise<void> {
  try {
    await fetch("/api/base", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: input.profile, cv: input.cv }),
    });
  } catch {
    // offline — local copy still applies
  }
}

/**
 * Pull the base from the shared store into localStorage if it's newer than the
 * local copy (e.g. the agent set it via write_base). Returns true if applied.
 */
export async function pullBaseFromServer(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await fetch("/api/base", { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { base?: BaseData | null };
    const base = data.base;
    if (!base?.profile || !base?.cv) return false;
    if (base.updatedAt <= localBaseUpdatedAt()) return false;
    localStorage.setItem(BASE_PROFILE_KEY, JSON.stringify(base.profile));
    localStorage.setItem(BASE_CV_KEY, JSON.stringify(base.cv));
    localStorage.setItem(BASE_UPDATED_AT_KEY, String(base.updatedAt));
    return true;
  } catch {
    return false;
  }
}

type BaseData = { profile: Profile; cv: CVContent; updatedAt: number };
