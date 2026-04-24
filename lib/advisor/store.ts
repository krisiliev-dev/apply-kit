"use client";

import { create, type StateCreator } from "zustand";
import {
  DECISIONS_HISTORY_MAX,
  EMPTY_ADVISOR_STATE,
  type AdvisorState,
  type CareerNarrative,
  type DecisionAnalysis,
  type PacingSnapshot,
  type SkillGapAnalysis,
  type StrategicProfile,
} from "./types";
import {
  clearAllAdvisor,
  loadAdvisorState,
  saveCeiling,
  saveDecisions,
  saveNarrative,
  savePacing,
  saveSkills,
} from "./persist";

// Zustand store mirroring the /applications pattern. Each artifact has its
// own setter so the UI doesn't need to rehydrate the whole payload on each
// update. Decisions are a capped-length history; everything else is a single
// latest value.

type State = AdvisorState & { loaded: boolean };

type Actions = {
  load: () => void;
  setNarrative: (n: CareerNarrative | null) => void;
  setSkills: (s: SkillGapAnalysis | null) => void;
  setCeiling: (c: StrategicProfile | null) => void;
  addDecision: (d: DecisionAnalysis) => void;
  removeDecision: (id: string) => void;
  clearDecisions: () => void;
  setPacing: (p: PacingSnapshot | null) => void;
  clearAll: () => void;
};

export type AdvisorStore = State & Actions;

const creator: StateCreator<AdvisorStore> = (set, get) => ({
  ...EMPTY_ADVISOR_STATE,
  loaded: false,

  load: () => {
    if (get().loaded) return;
    const s = loadAdvisorState();
    set({ ...s, loaded: true });
  },

  setNarrative: (n) => {
    saveNarrative(n);
    set({ narrative: n });
  },

  setSkills: (s) => {
    saveSkills(s);
    set({ skills: s });
  },

  setCeiling: (c) => {
    saveCeiling(c);
    set({ ceiling: c });
  },

  addDecision: (d) => {
    const next = [d, ...get().decisions].slice(0, DECISIONS_HISTORY_MAX);
    saveDecisions(next);
    set({ decisions: next });
  },

  removeDecision: (id) => {
    const next = get().decisions.filter((d) => d.id !== id);
    saveDecisions(next);
    set({ decisions: next });
  },

  clearDecisions: () => {
    saveDecisions([]);
    set({ decisions: [] });
  },

  setPacing: (p) => {
    savePacing(p);
    set({ pacing: p });
  },

  clearAll: () => {
    clearAllAdvisor();
    set({ ...EMPTY_ADVISOR_STATE });
  },
});

export const useAdvisor = create<AdvisorStore>()(creator);
