"use client";

import { create, type StateCreator } from "zustand";
import type {
  Application,
  ApplicationEvent,
  ApplicationStatus,
  CoverLetter,
} from "./types";
import { loadAllFromStorage, saveAllToStorage } from "./persist";

// ———————————————————————————————————————————————
// Store shape
// ———————————————————————————————————————————————

type AppState = {
  applications: Application[];
  loaded: boolean;
};

type Actions = {
  /** Hydrate from localStorage. Safe to call multiple times. */
  load: () => void;
  /** Insert or replace (by id). */
  upsert: (app: Application) => void;
  /** Change status and record a status-change event. */
  updateStatus: (id: string, next: ApplicationStatus, note?: string) => void;
  /** Remove by id. */
  remove: (id: string) => void;
  /** Shortcut for notes. */
  setNotes: (id: string, notes: string) => void;
  /** Generic partial update — excludes id/dateCreated which are stable. */
  setField: (id: string, patch: Partial<Omit<Application, "id" | "dateCreated">>) => void;
  /** Set (or clear) the per-application cover letter. */
  setCoverLetter: (id: string, cl: CoverLetter | undefined) => void;
};

export type AppStore = AppState & Actions;

// ———————————————————————————————————————————————
// Helpers
// ———————————————————————————————————————————————

function persist(apps: Application[]) {
  saveAllToStorage(apps);
}

function applyPatch(
  app: Application,
  patch: Partial<Omit<Application, "id" | "dateCreated">>,
): Application {
  return { ...app, ...patch };
}

// ———————————————————————————————————————————————
// Store creator
// ———————————————————————————————————————————————

const creator: StateCreator<AppStore> = (set, get) => ({
  applications: [],
  loaded: false,

  load: () => {
    if (get().loaded) return;
    const apps = loadAllFromStorage();
    set({ applications: apps, loaded: true });
  },

  upsert: (app) => {
    const { applications } = get();
    const idx = applications.findIndex((a) => a.id === app.id);
    const next =
      idx >= 0
        ? applications.map((a) => (a.id === app.id ? app : a))
        : [...applications, app];
    persist(next);
    set({ applications: next });
  },

  updateStatus: (id, nextStatus, note) => {
    const { applications } = get();
    const next = applications.map((a) => {
      if (a.id !== id) return a;
      if (a.status === nextStatus) return a;
      const event: ApplicationEvent = {
        at: Date.now(),
        kind: "status-change",
        from: a.status,
        to: nextStatus,
        note,
      };
      return {
        ...a,
        status: nextStatus,
        events: [...(a.events ?? []), event],
      };
    });
    persist(next);
    set({ applications: next });
  },

  remove: (id) => {
    const next = get().applications.filter((a) => a.id !== id);
    persist(next);
    set({ applications: next });
  },

  setNotes: (id, notes) => {
    const next = get().applications.map((a) =>
      a.id === id ? { ...a, notes } : a,
    );
    persist(next);
    set({ applications: next });
  },

  setField: (id, patch) => {
    const next = get().applications.map((a) =>
      a.id === id ? applyPatch(a, patch) : a,
    );
    persist(next);
    set({ applications: next });
  },

  setCoverLetter: (id, cl) => {
    const next = get().applications.map((a) =>
      a.id === id ? { ...a, coverLetter: cl } : a,
    );
    persist(next);
    set({ applications: next });
  },
});

export const useApplications = create<AppStore>()(creator);

// Selectors
export const selectById = (id: string) => (s: AppStore) =>
  s.applications.find((a) => a.id === id);
