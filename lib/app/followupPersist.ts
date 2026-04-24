// Plain localStorage I/O for FollowUp[]. Kept separate from followupStore.ts
// so the cadence helper can load/save directly without importing Zustand.

import type { FollowUp } from "./types";
import { FOLLOWUPS_STORAGE_KEY } from "./types";

export function loadFollowUpsFromStorage(): FollowUp[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FOLLOWUPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as FollowUp[];
  } catch {
    return [];
  }
}

export function saveFollowUpsToStorage(items: FollowUp[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FOLLOWUPS_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore quota errors
  }
}

export function clearFollowUpsFromStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(FOLLOWUPS_STORAGE_KEY);
}
