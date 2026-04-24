"use client";

import { create, type StateCreator } from "zustand";
import type {
  Application,
  ApplicationEvent,
  ApplicationStatus,
  CoverLetter,
  RejectionSignal,
  InterviewPrep,
  InterviewQuestion,
  PreScreen,
  PreScreenQuestion,
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
  /** Attach (or replace) the rejection-learning signal for an application. */
  setRejectionSignal: (id: string, signal: RejectionSignal) => void;
  /** Remove any rejection-learning signal from an application. */
  clearRejectionSignal: (id: string) => void;
  /** Set (or clear) the per-application interview prep. */
  setInterviewPrep: (id: string, prep: InterviewPrep | undefined) => void;
  /** Patch a single interview question by id on an application. */
  updateInterviewQuestion: (
    appId: string,
    questionId: string,
    patch: Partial<Omit<InterviewQuestion, "id">>,
  ) => void;
  /** Add an ad-hoc question to the prep (e.g. user-authored). */
  addInterviewQuestion: (appId: string, question: InterviewQuestion) => void;
  /** Remove a question from the prep. */
  removeInterviewQuestion: (appId: string, questionId: string) => void;
  /** Set (or clear) the per-application pre-screen bundle. */
  setPreScreen: (id: string, ps: PreScreen | undefined) => void;
  /** Patch a single pre-screen question. */
  updatePreScreenQuestion: (
    appId: string,
    questionId: string,
    patch: Partial<Omit<PreScreenQuestion, "id">>,
  ) => void;
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

  setRejectionSignal: (id, signal) => {
    const next = get().applications.map((a) =>
      a.id === id ? { ...a, rejection: signal } : a,
    );
    persist(next);
    set({ applications: next });
  },

  clearRejectionSignal: (id) => {
    const next = get().applications.map((a) => {
      if (a.id !== id) return a;
      const copy = { ...a };
      delete copy.rejection;
      return copy;
    });
    persist(next);
    set({ applications: next });
  },

  setInterviewPrep: (id, prep) => {
    const next = get().applications.map((a) =>
      a.id === id ? { ...a, interviewPrep: prep } : a,
    );
    persist(next);
    set({ applications: next });
  },

  updateInterviewQuestion: (appId, questionId, patch) => {
    const next = get().applications.map((a) => {
      if (a.id !== appId || !a.interviewPrep) return a;
      const questions = a.interviewPrep.questions.map((q) =>
        q.id === questionId ? { ...q, ...patch } : q,
      );
      return { ...a, interviewPrep: { ...a.interviewPrep, questions } };
    });
    persist(next);
    set({ applications: next });
  },

  addInterviewQuestion: (appId, question) => {
    const next = get().applications.map((a) => {
      if (a.id !== appId) return a;
      const prep: InterviewPrep = a.interviewPrep ?? {
        generatedAt: Date.now(),
        questions: [],
      };
      return {
        ...a,
        interviewPrep: {
          ...prep,
          questions: [...prep.questions, question],
        },
      };
    });
    persist(next);
    set({ applications: next });
  },

  removeInterviewQuestion: (appId, questionId) => {
    const next = get().applications.map((a) => {
      if (a.id !== appId || !a.interviewPrep) return a;
      const questions = a.interviewPrep.questions.filter(
        (q) => q.id !== questionId,
      );
      return { ...a, interviewPrep: { ...a.interviewPrep, questions } };
    });
    persist(next);
    set({ applications: next });
  },

  setPreScreen: (id, ps) => {
    const next = get().applications.map((a) =>
      a.id === id ? { ...a, preScreen: ps } : a,
    );
    persist(next);
    set({ applications: next });
  },

  updatePreScreenQuestion: (appId, questionId, patch) => {
    const next = get().applications.map((a) => {
      if (a.id !== appId || !a.preScreen) return a;
      const questions = a.preScreen.questions.map((q) =>
        q.id === questionId ? { ...q, ...patch } : q,
      );
      return { ...a, preScreen: { ...a.preScreen, questions } };
    });
    persist(next);
    set({ applications: next });
  },
});

export const useApplications = create<AppStore>()(creator);

// Selectors
export const selectById = (id: string) => (s: AppStore) =>
  s.applications.find((a) => a.id === id);
