"use client";

import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type BackupConfig,
  type ModelsConfig,
  type Settings,
  type UiConfig,
} from "./types";

// The merge input is deliberately shaped looser than `Partial<Settings>` —
// `Settings.models.default` is required, but saved blobs from older versions
// might not include it, and we want to *fill it in from defaults* rather than
// reject the whole blob.
export type RawSettings = {
  models?: Partial<ModelsConfig>;
  backup?: Partial<BackupConfig>;
  ui?: Partial<UiConfig>;
};

// Single-blob persistence under `cv-maker:settings`. Merges with
// DEFAULT_SETTINGS on load so new fields added later don't break old data.
//
// Kept as plain functions so the store can be tested without mocking Zustand,
// and so the shape is identical to the other `persist.ts` modules in the repo
// (advisor, app, followups, discovery).

export function loadSettingsFromStorage(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as RawSettings | null;
    return mergeWithDefaults(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettingsToStorage(settings: Settings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota errors: settings are tiny, shouldn't happen, but fail silently
    // rather than crash the UI.
  }
}

export function clearSettingsFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Deep-merge raw parsed JSON with DEFAULT_SETTINGS. Structure-only — doesn't
// validate enum values; if `models.default.provider` is bogus, we let the UI
// surface it rather than silently rewriting. The goal here is "don't lose
// user fields that the current code doesn't yet know about" AND "don't
// crash when a new required field was added since last save."
export function mergeWithDefaults(
  raw: RawSettings | null | undefined,
): Settings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;

  const models: ModelsConfig = {
    default: raw.models?.default ?? DEFAULT_SETTINGS.models.default,
    chat: raw.models?.chat,
    draft: raw.models?.draft,
    evaluator: raw.models?.evaluator,
    narrative: raw.models?.narrative,
    paraphrase: raw.models?.paraphrase,
  };

  const backup: BackupConfig = {
    autoBackupEnabled:
      typeof raw.backup?.autoBackupEnabled === "boolean"
        ? raw.backup.autoBackupEnabled
        : DEFAULT_SETTINGS.backup.autoBackupEnabled,
    autoBackupIntervalMinutes:
      typeof raw.backup?.autoBackupIntervalMinutes === "number"
        ? raw.backup.autoBackupIntervalMinutes
        : DEFAULT_SETTINGS.backup.autoBackupIntervalMinutes,
    autoBackupHandleRegistered:
      raw.backup?.autoBackupHandleRegistered ?? undefined,
    lastBackupAt: raw.backup?.lastBackupAt ?? undefined,
  };

  const ui: UiConfig = {
    showCostPill:
      typeof raw.ui?.showCostPill === "boolean"
        ? raw.ui.showCostPill
        : DEFAULT_SETTINGS.ui.showCostPill,
    showOnboarding:
      typeof raw.ui?.showOnboarding === "boolean"
        ? raw.ui.showOnboarding
        : DEFAULT_SETTINGS.ui.showOnboarding,
  };

  return { models, backup, ui };
}
