import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from "@/lib/settings/types";
import {
  loadSettingsFromStorage,
  mergeWithDefaults,
  saveSettingsToStorage,
} from "@/lib/settings/persist";

// These tests run under vitest's jsdom env so `window.localStorage` is a
// real(ish) in-memory store — good enough for round-trip / merging tests.

beforeEach(() => {
  localStorage.clear();
});

describe("settings defaults merging", () => {
  it("returns DEFAULT_SETTINGS when nothing is stored", () => {
    expect(loadSettingsFromStorage()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a full settings blob", () => {
    const filled = {
      models: {
        default: {
          provider: "ollama-openai-compat" as const,
          model: "qwen2.5-coder:32b",
          baseUrl: "http://localhost:11434/v1",
          label: "Local qwen",
        },
        chat: {
          provider: "anthropic" as const,
          model: "claude-haiku-4-5",
          label: "Haiku",
        },
      },
      backup: {
        autoBackupEnabled: true,
        autoBackupIntervalMinutes: 60,
        autoBackupHandleRegistered: true,
        lastBackupAt: 1_700_000_000_000,
      },
      ui: {
        showCostPill: false,
        showOnboarding: false,
      },
      discovery: {
        autoRefreshEnabled: true,
        autoRefreshIntervalMinutes: 180,
      },
    };
    saveSettingsToStorage(filled);
    const loaded = loadSettingsFromStorage();
    expect(loaded).toEqual(filled);
  });

  it("merges partial saved data with DEFAULT_SETTINGS", () => {
    const partial = {
      ui: { showCostPill: false },
    };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(partial));
    const loaded = loadSettingsFromStorage();
    expect(loaded.ui.showCostPill).toBe(false);
    expect(loaded.ui.showOnboarding).toBe(DEFAULT_SETTINGS.ui.showOnboarding);
    expect(loaded.models.default).toEqual(DEFAULT_SETTINGS.models.default);
    expect(loaded.backup).toEqual(DEFAULT_SETTINGS.backup);
  });

  it("falls back cleanly on malformed JSON", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, "not json{{{");
    expect(loadSettingsFromStorage()).toEqual(DEFAULT_SETTINGS);
  });

  it("mergeWithDefaults tolerates null / undefined", () => {
    expect(mergeWithDefaults(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeWithDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("mergeWithDefaults preserves per-feature overrides even when default is absent", () => {
    const partial = {
      models: {
        chat: {
          provider: "anthropic" as const,
          model: "claude-haiku-4-5",
        },
      },
    };
    const merged = mergeWithDefaults(partial);
    expect(merged.models.default).toEqual(DEFAULT_SETTINGS.models.default);
    expect(merged.models.chat?.model).toBe("claude-haiku-4-5");
  });
});
