"use client";

import { create, type StateCreator } from "zustand";
import {
  DEFAULT_SETTINGS,
  type BackupConfig,
  type DiscoveryScheduleConfig,
  type ModelChoice,
  type ModelFeature,
  type ModelsConfig,
  type Settings,
  type UiConfig,
} from "./types";
import {
  clearSettingsFromStorage,
  loadSettingsFromStorage,
  saveSettingsToStorage,
} from "./persist";

// Mirrors the shape of `lib/advisor/store.ts`. Single source of truth for
// settings; every mutation writes through to localStorage immediately so the
// next tab/reload sees the same config.
//
// SSR-safe: `load()` no-ops on the server and the initial state matches
// DEFAULT_SETTINGS. Clients call `load()` in an effect on mount.

type State = Settings & { loaded: boolean };

type Actions = {
  load: () => void;
  setModels: (models: ModelsConfig) => void;
  setModelFeature: (feature: ModelFeature, choice: ModelChoice | null) => void;
  setBackup: (patch: Partial<BackupConfig>) => void;
  setUi: (patch: Partial<UiConfig>) => void;
  setDiscovery: (patch: Partial<DiscoveryScheduleConfig>) => void;
  reset: () => void;
};

export type SettingsStore = State & Actions;

function snapshot(state: State): Settings {
  return {
    models: state.models,
    backup: state.backup,
    ui: state.ui,
    discovery: state.discovery,
  };
}

const creator: StateCreator<SettingsStore> = (set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  load: () => {
    if (get().loaded) return;
    if (typeof window === "undefined") return;
    const s = loadSettingsFromStorage();
    set({ ...s, loaded: true });
  },

  setModels: (models) => {
    const next: Settings = { ...snapshot(get()), models };
    saveSettingsToStorage(next);
    set({ models });
  },

  // Pass `null` to unset a per-feature override (falls through to default).
  // `feature === "default"` with null is a no-op — there must always be a
  // default model.
  setModelFeature: (feature, choice) => {
    const current = get().models;
    let nextModels: ModelsConfig;
    if (feature === "default") {
      if (choice === null) return;
      nextModels = { ...current, default: choice };
    } else {
      nextModels = { ...current };
      if (choice === null) {
        delete nextModels[feature];
      } else {
        nextModels[feature] = choice;
      }
    }
    const next: Settings = { ...snapshot(get()), models: nextModels };
    saveSettingsToStorage(next);
    set({ models: nextModels });
  },

  setBackup: (patch) => {
    const nextBackup: BackupConfig = { ...get().backup, ...patch };
    const next: Settings = { ...snapshot(get()), backup: nextBackup };
    saveSettingsToStorage(next);
    set({ backup: nextBackup });
  },

  setUi: (patch) => {
    const nextUi: UiConfig = { ...get().ui, ...patch };
    const next: Settings = { ...snapshot(get()), ui: nextUi };
    saveSettingsToStorage(next);
    set({ ui: nextUi });
  },

  setDiscovery: (patch) => {
    const nextDiscovery: DiscoveryScheduleConfig = { ...get().discovery, ...patch };
    const next: Settings = { ...snapshot(get()), discovery: nextDiscovery };
    saveSettingsToStorage(next);
    set({ discovery: nextDiscovery });
  },

  reset: () => {
    clearSettingsFromStorage();
    set({ ...DEFAULT_SETTINGS });
    saveSettingsToStorage(DEFAULT_SETTINGS);
  },
});

export const useSettings = create<SettingsStore>()(creator);
