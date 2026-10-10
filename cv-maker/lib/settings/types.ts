// ————————————————————————————————————————————————
// App-wide settings: model selection, backup, UI toggles.
// Lives in localStorage under `cv-maker:settings`. The store is owned by
// `lib/settings/store.ts` (hydrated SSR-safe).
//
// Two agents read this: the durability/settings UI agent owns the store
// and page; the provider-swap agent reads `models.*` to decide which
// provider/model to instantiate per route. Keep this file additive —
// backward-compat matters because we persist it to disk.
// ————————————————————————————————————————————————

export type ModelProvider = "anthropic" | "ollama-openai-compat";

export type ModelChoice = {
  provider: ModelProvider;
  /** For anthropic: e.g. "claude-sonnet-4-6". For ollama: the local tag, e.g. "qwen2.5-coder:32b". */
  model: string;
  /** For ollama-openai-compat: the base URL of the server, e.g. "http://localhost:11434/v1". */
  baseUrl?: string;
  /** Optional free-form label shown in the UI. */
  label?: string;
};

/**
 * One `ModelChoice` per feature class. Allows "fast+cheap for drafting,
 * slower+stronger for evaluation". Features that are not explicitly set
 * fall through to `default`.
 */
export type ModelsConfig = {
  default: ModelChoice;
  chat?: ModelChoice;
  draft?: ModelChoice;
  evaluator?: ModelChoice;
  narrative?: ModelChoice;
  paraphrase?: ModelChoice;
};

export type BackupConfig = {
  /** Master switch for the File System Access API auto-backup. */
  autoBackupEnabled: boolean;
  /** Minimum gap between auto-backups, in minutes. */
  autoBackupIntervalMinutes: number;
  /** Serialized identifier for the granted FSA handle. The actual handle
   * object isn't JSON-serializable and must be re-acquired; this field
   * just tracks whether one is remembered. */
  autoBackupHandleRegistered?: boolean;
  /** Last successful auto-backup timestamp. */
  lastBackupAt?: number;
};

export type UiConfig = {
  /** Show a running cost pill in the header when AI calls have landed this session. */
  showCostPill: boolean;
  /** Show the first-run onboarding overlay until dismissed. */
  showOnboarding: boolean;
};

export type DiscoveryScheduleConfig = {
  /** Master switch for hands-off discovery: periodically run all sources +
   * email-alert ingestion while the app is open. */
  autoRefreshEnabled: boolean;
  /** Minimum gap between auto-refreshes, in minutes. */
  autoRefreshIntervalMinutes: number;
  /** Last successful auto-refresh timestamp. */
  lastRefreshAt?: number;
};

export type Settings = {
  models: ModelsConfig;
  backup: BackupConfig;
  ui: UiConfig;
  discovery: DiscoveryScheduleConfig;
};

export const DEFAULT_SETTINGS: Settings = {
  models: {
    default: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6 (hosted)",
    },
  },
  backup: {
    autoBackupEnabled: false,
    autoBackupIntervalMinutes: 30,
  },
  ui: {
    showCostPill: true,
    showOnboarding: true,
  },
  discovery: {
    autoRefreshEnabled: false,
    autoRefreshIntervalMinutes: 360,
  },
};

export const SETTINGS_STORAGE_KEY = "cv-maker:settings";

/** Features that can have their own model override. Keep stable. */
export type ModelFeature =
  | "default"
  | "chat"
  | "draft"
  | "evaluator"
  | "narrative"
  | "paraphrase";

/** Resolve which ModelChoice a given feature should use. */
export function resolveModelFor(
  settings: Settings,
  feature: ModelFeature,
): ModelChoice {
  if (feature === "default") return settings.models.default;
  return settings.models[feature] ?? settings.models.default;
}
