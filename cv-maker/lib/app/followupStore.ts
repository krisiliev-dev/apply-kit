"use client";

import { create, type StateCreator } from "zustand";
import type { FollowUp } from "./types";
import {
  loadFollowUpsFromStorage,
  saveFollowUpsToStorage,
} from "./followupPersist";

const DAY_MS = 24 * 60 * 60 * 1000;

type State = {
  items: FollowUp[];
  loaded: boolean;
};

type Actions = {
  load: () => void;
  /** Insert or replace by id. */
  add: (f: FollowUp) => void;
  update: (id: string, patch: Partial<Omit<FollowUp, "id">>) => void;
  remove: (id: string) => void;
  /** Refresh in-memory state from storage (used for cross-tab sync). */
  refresh: () => void;
};

export type FollowUpStore = State & Actions;

const creator: StateCreator<FollowUpStore> = (set, get) => ({
  items: [],
  loaded: false,

  load: () => {
    if (get().loaded) return;
    const items = loadFollowUpsFromStorage();
    set({ items, loaded: true });
  },

  refresh: () => {
    const items = loadFollowUpsFromStorage();
    set({ items, loaded: true });
  },

  add: (f) => {
    const { items } = get();
    const idx = items.findIndex((x) => x.id === f.id);
    const next =
      idx >= 0 ? items.map((x) => (x.id === f.id ? f : x)) : [...items, f];
    saveFollowUpsToStorage(next);
    set({ items: next });
  },

  update: (id, patch) => {
    const next = get().items.map((x) =>
      x.id === id ? ({ ...x, ...patch } as FollowUp) : x,
    );
    saveFollowUpsToStorage(next);
    set({ items: next });
  },

  remove: (id) => {
    const next = get().items.filter((x) => x.id !== id);
    saveFollowUpsToStorage(next);
    set({ items: next });
  },
});

export const useFollowUps = create<FollowUpStore>()(creator);

// ———————————————————————————————————————————————
// Selectors
// ———————————————————————————————————————————————

export const selectForApplication = (appId: string) => (s: FollowUpStore) =>
  s.items.filter((f) => f.applicationId === appId);

export const selectDueSoon = (appId: string, now: number = Date.now()) =>
  (s: FollowUpStore) =>
    s.items.some(
      (f) =>
        f.applicationId === appId &&
        f.status === "pending" &&
        f.scheduledFor < now + 2 * DAY_MS,
    );

/** Pending items that should surface as "due" anywhere in the tracker. */
export const selectAllDueSoon = (now: number = Date.now()) =>
  (s: FollowUpStore) =>
    s.items.filter(
      (f) => f.status === "pending" && f.scheduledFor < now + 2 * DAY_MS,
    );
