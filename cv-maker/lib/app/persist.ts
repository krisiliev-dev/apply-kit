"use client";

import type { Application } from "./types";

// Single JSON array under one key. No per-application sharding — the list is
// tiny and one key keeps load/save trivial.
const STORAGE_KEY = "cv-maker:applications";

export function loadAllFromStorage(): Application[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as Application[];
  } catch {
    return [];
  }
}

export function saveAllToStorage(apps: Application[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
  } catch {
    // ignore quota errors
  }
}

export function clearAllFromStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
