"use client";

import { APPLICATIONS_STORAGE_KEY, type Application } from "./types";

// Read/write for the applications array. Agent B owns the tracker UI and has
// their own persist.ts — this file intentionally matches their shape and
// storage key so writes from /jobs land in the same bucket they read from.
// Kept separate so no merge conflict on either side.

export function readApplications(): Application[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(APPLICATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Application[];
  } catch {
    return [];
  }
}

export function writeApplications(apps: Application[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(APPLICATIONS_STORAGE_KEY, JSON.stringify(apps));
  } catch {
    // Ignore quota.
  }
}

export function getApplication(id: string): Application | undefined {
  return readApplications().find((a) => a.id === id);
}

export function upsertApplication(app: Application) {
  const apps = readApplications().filter((a) => a.id !== app.id);
  apps.push(app);
  writeApplications(apps);
}

export function patchApplication(
  id: string,
  patch: Partial<Application>,
): Application | null {
  const apps = readApplications();
  const idx = apps.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  const updated: Application = { ...apps[idx], ...patch };
  apps[idx] = updated;
  writeApplications(apps);
  return updated;
}
