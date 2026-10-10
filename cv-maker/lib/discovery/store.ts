"use client";

import { create, type StateCreator } from "zustand";
import {
  DEFAULT_DISCOVERY_PREFERENCES,
  EMPTY_DISCOVERY_STATE,
  type DiscoveryPreferences,
  type DiscoveryState,
  type JobPosting,
  type ScoredPosting,
} from "./types";
import { loadPreferences, loadState, savePreferences, saveState } from "./persist";
import { scoreMany } from "./scoring";
import type { CVContent } from "@/lib/types";

type DiscoveryStoreState = {
  prefs: DiscoveryPreferences;
  state: DiscoveryState;
  loaded: boolean;
};

type DiscoveryStoreActions = {
  load: () => void;
  setPrefs: (patch: Partial<DiscoveryPreferences>) => void;
  replacePrefs: (prefs: DiscoveryPreferences) => void;
  /** Ingest raw postings from the aggregator; rescore against current prefs+CVs. */
  ingest: (postings: JobPosting[], cvs: CVContent[]) => void;
  /** Rescore all known postings with the latest prefs/CVs (e.g. after prefs change). */
  rescore: (cvs: CVContent[]) => void;
  dismiss: (id: string) => void;
  undismiss: (id: string) => void;
  save: (id: string) => void;
  unsave: (id: string) => void;
  markFetched: (sourceKey: string) => void;
  clearAll: () => void;
};

export type DiscoveryStore = DiscoveryStoreState & DiscoveryStoreActions;

const creator: StateCreator<DiscoveryStore> = (set, get) => ({
  prefs: DEFAULT_DISCOVERY_PREFERENCES,
  state: EMPTY_DISCOVERY_STATE,
  loaded: false,

  load: () => {
    if (get().loaded) return;
    set({ prefs: loadPreferences(), state: loadState(), loaded: true });
  },

  setPrefs: (patch) => {
    const next = { ...get().prefs, ...patch };
    savePreferences(next);
    set({ prefs: next });
  },

  replacePrefs: (prefs) => {
    savePreferences(prefs);
    set({ prefs });
  },

  ingest: (postings, cvs) => {
    const { prefs, state } = get();
    const scored = scoreMany(postings, prefs, cvs, state);
    const nextPostings = { ...state.postings };
    for (const p of scored) {
      nextPostings[p.id] = p;
    }
    const nextState: DiscoveryState = { ...state, postings: nextPostings };
    saveState(nextState);
    set({ state: nextState });
  },

  rescore: (cvs) => {
    const { prefs, state } = get();
    const all = Object.values(state.postings);
    const scored = scoreMany(all, prefs, cvs, state);
    const nextPostings: Record<string, ScoredPosting> = {};
    for (const p of scored) nextPostings[p.id] = p;
    const nextState = { ...state, postings: nextPostings };
    saveState(nextState);
    set({ state: nextState });
  },

  dismiss: (id) => {
    const { state } = get();
    const next: DiscoveryState = {
      ...state,
      dismissed: { ...state.dismissed, [id]: Date.now() },
      saved: omitKey(state.saved, id),
    };
    saveState(next);
    set({ state: next });
  },

  undismiss: (id) => {
    const { state } = get();
    const next: DiscoveryState = {
      ...state,
      dismissed: omitKey(state.dismissed, id),
    };
    saveState(next);
    set({ state: next });
  },

  save: (id) => {
    const { state } = get();
    const next: DiscoveryState = {
      ...state,
      saved: { ...state.saved, [id]: Date.now() },
      dismissed: omitKey(state.dismissed, id),
    };
    saveState(next);
    set({ state: next });
  },

  unsave: (id) => {
    const { state } = get();
    const next: DiscoveryState = {
      ...state,
      saved: omitKey(state.saved, id),
    };
    saveState(next);
    set({ state: next });
  },

  markFetched: (sourceKey) => {
    const { state } = get();
    const next: DiscoveryState = {
      ...state,
      lastFetchAt: { ...state.lastFetchAt, [sourceKey]: Date.now() },
    };
    saveState(next);
    set({ state: next });
  },

  clearAll: () => {
    saveState(EMPTY_DISCOVERY_STATE);
    set({ state: EMPTY_DISCOVERY_STATE });
  },
});

function omitKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}

export const useDiscovery = create<DiscoveryStore>()(creator);

// Selectors
export const selectVisiblePostings =
  (opts: { includeDismissed?: boolean; onlySaved?: boolean } = {}) =>
  (s: DiscoveryStore): ScoredPosting[] => {
    const all = Object.values(s.state.postings);
    return all.filter((p) => {
      if (p.hardReject) return false;
      if (opts.onlySaved) return Boolean(s.state.saved[p.id]);
      if (!opts.includeDismissed && s.state.dismissed[p.id]) return false;
      return true;
    });
  };
