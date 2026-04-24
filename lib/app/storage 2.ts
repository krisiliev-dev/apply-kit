"use client";

import { APPLICATIONS_STORAGE_KEY, type Application } from "./types";

// Read/write for the applications array. Agent B owns the tracker UI; we just
// write records on draft creation and read them to list existing drafts on
// /jobs. Keep mutations additive and don't throw — if localStorage is weird we
// silently no-op, same as persist.ts does.

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
