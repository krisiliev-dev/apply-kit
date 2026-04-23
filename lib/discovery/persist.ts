"use client";

import {
  DEFAULT_DISCOVERY_PREFERENCES,
  DISCOVERY_PREFS_KEY,
  DISCOVERY_STATE_KEY,
  EMPTY_DISCOVERY_STATE,
  type DiscoveryPreferences,
  type DiscoveryState,
} from "./types";

// Mirrors the shape of lib/app/persist.ts — single key per object,
// JSON.parse with a permissive "if anything looks wrong, return defaults"
// fallback. Keeps the client resilient to schema drift.

export function loadPreferences(): DiscoveryPreferences {
  if (typeof window === "undefined") return DEFAULT_DISCOVERY_PREFERENCES;
  try {
    const raw = localStorage.getItem(DISCOVERY_PREFS_KEY);
    if (!raw) return DEFAULT_DISCOVERY_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<DiscoveryPreferences> | null;
    if (!parsed || typeof parsed !== "object")
      return DEFAULT_DISCOVERY_PREFERENCES;
    return {
      ...DEFAULT_DISCOVERY_PREFERENCES,
      ...parsed,
      watchlist: {
        greenhouse: Array.isArray(parsed.watchlist?.greenhouse)
          ? parsed.watchlist.greenhouse
          : [],
        lever: Array.isArray(parsed.watchlist?.lever)
          ? parsed.watchlist.lever
          : [],
        ashby: Array.isArray(parsed.watchlist?.ashby)
          ? parsed.watchlist.ashby
          : [],
      },
      rssFeeds: Array.isArray(parsed.rssFeeds) ? parsed.rssFeeds : [],
      workAuth: Array.isArray(parsed.workAuth) ? parsed.workAuth : [],
      preferredLocations: Array.isArray(parsed.preferredLocations)
        ? parsed.preferredLocations
        : [],
      titleDenylist: Array.isArray(parsed.titleDenylist)
        ? parsed.titleDenylist
        : [],
      trackHnHiring: Boolean(parsed.trackHnHiring),
    };
  } catch {
    return DEFAULT_DISCOVERY_PREFERENCES;
  }
}

export function savePreferences(prefs: DiscoveryPreferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISCOVERY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // quota error — ignore
  }
}

export function loadState(): DiscoveryState {
  if (typeof window === "undefined") return EMPTY_DISCOVERY_STATE;
  try {
    const raw = localStorage.getItem(DISCOVERY_STATE_KEY);
    if (!raw) return EMPTY_DISCOVERY_STATE;
    const parsed = JSON.parse(raw) as Partial<DiscoveryState> | null;
    if (!parsed || typeof parsed !== "object") return EMPTY_DISCOVERY_STATE;
    return {
      postings:
        parsed.postings && typeof parsed.postings === "object"
          ? parsed.postings
          : {},
      dismissed:
        parsed.dismissed && typeof parsed.dismissed === "object"
          ? parsed.dismissed
          : {},
      saved:
        parsed.saved && typeof parsed.saved === "object" ? parsed.saved : {},
      lastFetchAt:
        parsed.lastFetchAt && typeof parsed.lastFetchAt === "object"
          ? parsed.lastFetchAt
          : {},
    };
  } catch {
    return EMPTY_DISCOVERY_STATE;
  }
}

export function saveState(state: DiscoveryState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISCOVERY_STATE_KEY, JSON.stringify(state));
  } catch {
    // quota error — ignore
  }
}
