"use client";

import Link from "next/link";
import { AppNav } from "@/components/nav/AppNav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/lib/settings/store";
import {
  DEFAULT_SETTINGS,
  type ModelChoice,
  type ModelFeature,
  type ModelProvider,
  type Settings,
} from "@/lib/settings/types";
import {
  downloadBackup,
  estimateKeySize,
  listAllKeys,
  readBackupFile,
  restoreAllState,
  type BackupPayload,
} from "@/lib/settings/backup";
import {
  checkBackupStatus,
  clearBackupDirectory,
  isFSASupported,
  pickBackupDirectory,
  requestBackupPermission,
  type AutoBackupStatus,
} from "@/lib/settings/autoBackup";
import {
  clearLocalBase,
  getBaseProfile,
  hasLocalBase,
  parseBaseImport,
  pushBaseToServer,
  setLocalBase,
} from "@/lib/profile/base";

// The single /settings page. Inline tabs to keep the scope small — four tabs
// with no nested routes. Each tab is a simple stateless section that talks
// to the settings store and/or the backup helpers.
//
// Style mirrors other pages in the app: mono caps for labels, display font
// for headings, generous negative space, subtle underlines for interactive
// elements.

type TabId = "models" | "backup" | "data" | "general";

const TABS: { id: TabId; label: string }[] = [
  { id: "models", label: "Models" },
  { id: "backup", label: "Backup" },
  { id: "data", label: "Data" },
  { id: "general", label: "General" },
];

const FEATURES: ModelFeature[] = [
  "default",
  "chat",
  "draft",
  "evaluator",
  "narrative",
  "paraphrase",
];

const FEATURE_COPY: Record<ModelFeature, { label: string; blurb: string }> = {
  default: {
    label: "Default model",
    blurb: "Used for any feature without its own override.",
  },
  chat: {
    label: "Chat copilot",
    blurb: "Editor copilot on /cv/[slug] — tool-calling, streaming.",
  },
  draft: {
    label: "Drafting (tailored CVs, cover letters)",
    blurb: "Higher output volume; favour speed over peak quality here.",
  },
  evaluator: {
    label: "Evaluation pipeline",
    blurb: "Recruiter-eye, refine loop. Accuracy matters more than latency.",
  },
  narrative: {
    label: "Narrative / advisor",
    blurb: "Career narrative, skill-gap, ceiling analyses. Deep but rare.",
  },
  paraphrase: {
    label: "Inline paraphrase",
    blurb: "Selected-text rewrite. Needs to be fast.",
  },
};

type Preset = {
  id: string;
  label: string;
  choice: ModelChoice;
};

const PRESETS: Preset[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 (default)",
    choice: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
    },
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5 (cheap hosted)",
    choice: {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
    },
  },
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7 (slow + strong)",
    choice: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      label: "Claude Opus 4.7",
    },
  },
  {
    id: "ollama-qwen",
    label: "Ollama — qwen2.5-coder:32b",
    choice: {
      provider: "ollama-openai-compat",
      model: "qwen2.5-coder:32b",
      baseUrl: "http://localhost:11434/v1",
      label: "Ollama qwen2.5-coder",
    },
  },
  {
    id: "ollama-llama32",
    label: "Ollama — llama3.2:latest",
    choice: {
      provider: "ollama-openai-compat",
      model: "llama3.2:latest",
      baseUrl: "http://localhost:11434/v1",
      label: "Ollama llama3.2",
    },
  },
];

// ———————————————————————————————————————————————————————————————
// Page shell
// ———————————————————————————————————————————————————————————————

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("models");
  const loaded = useSettings((s) => s.loaded);
  const load = useSettings((s) => s.load);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <AppNav />
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Settings
        </p>
        <h1 className="font-display text-5xl mt-2 tracking-tight">
          Settings <em>&amp; durability</em>
        </h1>
        <p className="mt-4 text-ink/70 max-w-prose">
          Everything here lives in your browser — models you want to use,
          backup folder, data inventory, UI toggles. No sync, no cloud.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-6 border-b border-ink/10 mb-8"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              "font-mono text-[11px] uppercase tracking-[0.25em] pb-3 -mb-px border-b-2 transition-colors " +
              (tab === t.id
                ? "text-ink border-ink"
                : "text-ink/60 border-transparent hover:text-ink")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <p className="font-mono text-[11px] text-ink/40">Loading…</p>
      ) : tab === "models" ? (
        <ModelsTab />
      ) : tab === "backup" ? (
        <BackupTab />
      ) : tab === "data" ? (
        <DataTab />
      ) : (
        <GeneralTab />
      )}
    </main>
  );
}

// ———————————————————————————————————————————————————————————————
// Models tab
// ———————————————————————————————————————————————————————————————

function ModelsTab() {
  const models = useSettings((s) => s.models);
  const setModelFeature = useSettings((s) => s.setModelFeature);
  const [expanded, setExpanded] = useState<Record<ModelFeature, boolean>>({
    default: true,
    chat: false,
    draft: false,
    evaluator: false,
    narrative: false,
    paraphrase: false,
  });

  const resolveCurrent = useCallback(
    (f: ModelFeature): ModelChoice | null => {
      if (f === "default") return models.default;
      return models[f] ?? null;
    },
    [models],
  );

  const applyPreset = useCallback(
    (feature: ModelFeature, presetId: string) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      setModelFeature(feature, { ...preset.choice });
    },
    [setModelFeature],
  );

  return (
    <section className="space-y-4">
      {FEATURES.map((feature) => {
        const current = resolveCurrent(feature);
        const isDefault = feature === "default";
        const isOverriding = isDefault || current !== null;
        const open = expanded[feature];
        return (
          <div
            key={feature}
            className="border border-ink/10 rounded-sm"
          >
            <button
              type="button"
              className="w-full flex items-baseline justify-between px-4 py-3 text-left hover:bg-ink/[0.02]"
              onClick={() =>
                setExpanded((e) => ({ ...e, [feature]: !e[feature] }))
              }
              aria-expanded={open}
            >
              <div>
                <div className="font-display text-xl">
                  {FEATURE_COPY[feature].label}
                </div>
                <div className="font-mono text-[11px] text-ink/50">
                  {FEATURE_COPY[feature].blurb}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-ink/50">
                  {isOverriding && current
                    ? describeChoice(current)
                    : "uses default"}
                </span>
                <span className="font-mono text-[11px] text-ink/40">
                  {open ? "–" : "+"}
                </span>
              </div>
            </button>
            {open ? (
              <div className="border-t border-ink/10 px-4 py-4 space-y-4 bg-ink/[0.015]">
                {!isDefault ? (
                  <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70">
                    <input
                      type="checkbox"
                      checked={current === null}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setModelFeature(feature, null);
                        } else {
                          setModelFeature(feature, { ...models.default });
                        }
                      }}
                    />
                    Use default
                  </label>
                ) : null}
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 block mb-1">
                    Preset
                  </label>
                  <select
                    className="w-full border border-ink/20 bg-surface px-3 py-2 font-mono text-sm"
                    onChange={(e) => {
                      if (!e.target.value) return;
                      applyPreset(feature, e.target.value);
                    }}
                    value=""
                  >
                    <option value="">Select a preset…</option>
                    {PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                {current || isDefault ? (
                  <ChoiceEditor
                    choice={current ?? models.default}
                    disabled={current === null && !isDefault}
                    onChange={(next) => setModelFeature(feature, next)}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function describeChoice(c: ModelChoice): string {
  const prefix = c.provider === "anthropic" ? "anthropic" : "ollama";
  return `${prefix} / ${c.model}`;
}

type ChoiceEditorProps = {
  choice: ModelChoice;
  disabled: boolean;
  onChange: (next: ModelChoice) => void;
};

function ChoiceEditor({ choice, disabled, onChange }: ChoiceEditorProps) {
  const [testResult, setTestResult] = useState<
    { kind: "ok"; models: string[] } | { kind: "error"; message: string } | null
  >(null);
  const [testing, setTesting] = useState(false);

  const isOllama = choice.provider === "ollama-openai-compat";

  const runTest = useCallback(async () => {
    if (!choice.baseUrl) {
      setTestResult({
        kind: "error",
        message: "No base URL set.",
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const url = choice.baseUrl.replace(/\/$/, "") + "/models";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { id?: string }[] };
      const models = Array.isArray(body.data)
        ? body.data
            .map((m) => m.id)
            .filter((x): x is string => typeof x === "string")
        : [];
      setTestResult({ kind: "ok", models });
    } catch (err) {
      setTestResult({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setTesting(false);
    }
  }, [choice.baseUrl]);

  return (
    <div className={"space-y-3 " + (disabled ? "opacity-40 pointer-events-none" : "")}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 block mb-1">
            Provider
          </label>
          <select
            className="w-full border border-ink/20 bg-surface px-3 py-2 font-mono text-sm"
            value={choice.provider}
            onChange={(e) =>
              onChange({
                ...choice,
                provider: e.target.value as ModelProvider,
                baseUrl:
                  e.target.value === "ollama-openai-compat"
                    ? choice.baseUrl ?? "http://localhost:11434/v1"
                    : undefined,
              })
            }
          >
            <option value="anthropic">anthropic</option>
            <option value="ollama-openai-compat">ollama-openai-compat</option>
          </select>
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 block mb-1">
            Model
          </label>
          <input
            type="text"
            className="w-full border border-ink/20 bg-surface px-3 py-2 font-mono text-sm"
            value={choice.model}
            onChange={(e) => onChange({ ...choice, model: e.target.value })}
            placeholder={
              isOllama ? "qwen2.5-coder:32b" : "claude-sonnet-4-6"
            }
          />
        </div>
      </div>
      {isOllama ? (
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 block mb-1">
            Base URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 border border-ink/20 bg-surface px-3 py-2 font-mono text-sm"
              value={choice.baseUrl ?? ""}
              onChange={(e) => onChange({ ...choice, baseUrl: e.target.value })}
              placeholder="http://localhost:11434/v1"
            />
            <button
              type="button"
              onClick={runTest}
              disabled={testing}
              className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/20 px-3 py-2 hover:border-ink/50 disabled:opacity-40"
            >
              {testing ? "Testing…" : "Test"}
            </button>
          </div>
          {testResult ? (
            <div className="mt-2 font-mono text-[11px]">
              {testResult.kind === "ok" ? (
                <span className="text-green-400">
                  OK — {testResult.models.length} model
                  {testResult.models.length === 1 ? "" : "s"} visible
                  {testResult.models.length
                    ? `: ${testResult.models.slice(0, 6).join(", ")}`
                    : ""}
                </span>
              ) : (
                <span className="text-red-400">
                  Failed: {testResult.message}
                </span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <div>
        <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 block mb-1">
          Label (optional)
        </label>
        <input
          type="text"
          className="w-full border border-ink/20 bg-surface px-3 py-2 font-mono text-sm"
          value={choice.label ?? ""}
          onChange={(e) => onChange({ ...choice, label: e.target.value })}
          placeholder="Shown in the UI"
        />
      </div>
    </div>
  );
}

// ———————————————————————————————————————————————————————————————
// Backup tab
// ———————————————————————————————————————————————————————————————

function BackupTab() {
  const backup = useSettings((s) => s.backup);
  const setBackup = useSettings((s) => s.setBackup);
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restorePending, setRestorePending] = useState<BackupPayload | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshStatus = useCallback(async () => {
    const s = await checkBackupStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const onPickFolder = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      await pickBackupDirectory();
      setBackup({ autoBackupHandleRegistered: true });
      setNotice("Folder picked. Auto-backup will use it on the next tick.");
      await refreshStatus();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return; // user cancelled; no need to shout
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [setBackup, refreshStatus]);

  const onForgetFolder = useCallback(async () => {
    await clearBackupDirectory();
    setBackup({ autoBackupHandleRegistered: false });
    setNotice("Folder forgotten.");
    await refreshStatus();
  }, [setBackup, refreshStatus]);

  const onRequestPermission = useCallback(async () => {
    const ok = await requestBackupPermission();
    if (!ok) {
      setError("Permission denied.");
    } else {
      setNotice("Permission granted.");
    }
    await refreshStatus();
  }, [refreshStatus]);

  const onFileChosen = useCallback(async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const payload = await readBackupFile(file);
      setRestorePending(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onConfirmRestore = useCallback(() => {
    if (!restorePending) return;
    try {
      const summary = restoreAllState(restorePending);
      setNotice(
        `Restored ${summary.restored} key${summary.restored === 1 ? "" : "s"}.` +
          (summary.skipped.length
            ? ` Skipped: ${summary.skipped.join(", ")}.`
            : ""),
      );
      setRestorePending(null);
      // Reload so every store re-hydrates from the restored data.
      window.setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [restorePending]);

  const supported = isFSASupported();

  return (
    <section className="space-y-8">
      <div>
        <h2 className="font-display text-2xl mb-3">Auto-backup</h2>
        {!supported ? (
          <p className="text-sm text-ink/70 max-w-prose">
            Your browser doesn't support the File System Access API. Chrome,
            Edge, and Arc do; Safari and Firefox don't yet. Use{" "}
            <span className="font-mono">Download backup</span> below on a
            schedule you like until they catch up.
          </p>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-3 font-mono text-[12px]">
              <input
                type="checkbox"
                checked={backup.autoBackupEnabled}
                onChange={(e) =>
                  setBackup({ autoBackupEnabled: e.target.checked })
                }
              />
              Enable auto-backup
            </label>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 block mb-1">
                Interval
              </label>
              <select
                className="border border-ink/20 bg-surface px-3 py-2 font-mono text-sm"
                value={backup.autoBackupIntervalMinutes}
                onChange={(e) =>
                  setBackup({
                    autoBackupIntervalMinutes: Number(e.target.value),
                  })
                }
              >
                <option value={15}>every 15 minutes</option>
                <option value={30}>every 30 minutes</option>
                <option value={60}>every hour</option>
                <option value={120}>every 2 hours</option>
              </select>
            </div>
            <div className="flex gap-3 flex-wrap">
              <button
                type="button"
                onClick={onPickFolder}
                className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink"
              >
                Choose backup folder
              </button>
              {status?.kind === "needs-permission" ? (
                <button
                  type="button"
                  onClick={onRequestPermission}
                  className="font-mono text-[11px] uppercase tracking-[0.2em] border border-amber-500/40 text-amber-400 px-4 py-2 hover:border-amber-500/50"
                >
                  Re-grant permission
                </button>
              ) : null}
              {status?.kind !== "no-handle" && status?.kind !== "unsupported" ? (
                <button
                  type="button"
                  onClick={onForgetFolder}
                  className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/15 text-ink/60 px-4 py-2 hover:border-ink/30"
                >
                  Forget folder
                </button>
              ) : null}
            </div>
            <p className="font-mono text-[11px] text-ink/60">
              Status:{" "}
              {status?.kind === "ready"
                ? "ready — writing daily rolling files"
                : status?.kind === "no-handle"
                  ? "no folder chosen"
                  : status?.kind === "needs-permission"
                    ? "folder remembered, permission expired"
                    : status?.kind === "unsupported"
                      ? "unsupported"
                      : "checking…"}
            </p>
            {backup.lastBackupAt ? (
              <p className="font-mono text-[11px] text-ink/60">
                Last auto-backup: {relativeTime(backup.lastBackupAt)}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-display text-2xl mb-3">Manual backup</h2>
        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              try {
                downloadBackup();
                setNotice("Backup downloaded.");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
            className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink"
          >
            Download backup (.json)
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink"
          >
            Restore from backup…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFileChosen(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {notice ? (
        <p className="font-mono text-[11px] text-green-400">{notice}</p>
      ) : null}
      {error ? (
        <p className="font-mono text-[11px] text-red-400">{error}</p>
      ) : null}

      {restorePending ? (
        <RestoreConfirmModal
          payload={restorePending}
          onCancel={() => setRestorePending(null)}
          onConfirm={onConfirmRestore}
        />
      ) : null}
    </section>
  );
}

function RestoreConfirmModal({
  payload,
  onCancel,
  onConfirm,
}: {
  payload: BackupPayload;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const keys = Object.keys(payload.state);
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface max-w-lg w-full p-6 border border-ink/20 rounded-sm">
        <h3 className="font-display text-2xl mb-2">Restore this backup?</h3>
        <p className="text-sm text-ink/70 mb-3">
          Exported {new Date(payload.exportedAt).toLocaleString()}. This will
          replace every <span className="font-mono">cv-maker:*</span> key in
          your browser.
        </p>
        <div className="max-h-40 overflow-y-auto border border-ink/10 p-2 mb-4 font-mono text-[11px] text-ink/70">
          {keys.length ? (
            <ul>
              {keys.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          ) : (
            <span>(empty)</span>
          )}
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/15 text-ink/60 px-4 py-2 hover:border-ink/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink"
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// ———————————————————————————————————————————————————————————————
// Data tab
// ———————————————————————————————————————————————————————————————

function DataTab() {
  const [keys, setKeys] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setKeys(listAllKeys());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onClearKey = useCallback(
    (key: string) => {
      const ok = window.confirm(`Remove ${key}? This cannot be undone.`);
      if (!ok) return;
      try {
        localStorage.removeItem(key);
        setNotice(`Removed ${key}.`);
        refresh();
      } catch (err) {
        console.warn(err);
      }
    },
    [refresh],
  );

  const onClearAll = useCallback(() => {
    const ok = window.confirm(
      "Nuke every cv-maker:* key? This deletes CVs, applications, follow-ups, advisor artifacts, settings — everything. No undo.",
    );
    if (!ok) return;
    const ok2 = window.confirm("Really? This is the last chance.");
    if (!ok2) return;
    try {
      for (const k of listAllKeys()) localStorage.removeItem(k);
      setNotice("Everything wiped. Reloading…");
      window.setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      console.warn(err);
    }
  }, []);

  const total = useMemo(() => keys.reduce((n, k) => n + estimateKeySize(k), 0), [keys]);

  return (
    <section className="space-y-6">
      <BaseDataPanel />
      <div>
        <h2 className="font-display text-2xl mb-1">Stored data</h2>
        <p className="font-mono text-[11px] text-ink/60">
          {keys.length} key{keys.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(total)} total
        </p>
      </div>
      <ul className="divide-y divide-ink/10 border-y border-ink/10">
        {keys.map((k) => (
          <li key={k} className="flex items-center justify-between py-3 gap-4">
            <div className="min-w-0">
              <div className="font-mono text-[12px] truncate">{k}</div>
              <div className="font-mono text-[10px] text-ink/50">
                {formatBytes(estimateKeySize(k))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onClearKey(k)}
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 border border-ink/15 px-3 py-1.5 hover:border-red-500/50 hover:text-red-400 shrink-0"
            >
              Clear
            </button>
          </li>
        ))}
        {!keys.length ? (
          <li className="py-6 text-ink/50 font-mono text-[11px]">
            No data yet.
          </li>
        ) : null}
      </ul>
      <div>
        <button
          type="button"
          onClick={onClearAll}
          className="font-mono text-[11px] uppercase tracking-[0.2em] border border-red-500/40 text-red-400 px-4 py-2 hover:border-red-500/50 hover:bg-red-500/10"
        >
          Clear ALL cv-maker data
        </button>
      </div>
      {notice ? (
        <p className="font-mono text-[11px] text-green-400">{notice}</p>
      ) : null}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Base CV & profile — the identity the AI tailors FROM. Stored only in this
// browser's localStorage (never committed), so a public repo stays clean.
function BaseDataPanel() {
  const [hasLocal, setHasLocal] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const local = hasLocalBase();
    setHasLocal(local);
    setName(local ? getBaseProfile().name : null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onLoad = useCallback(() => {
    setError(null);
    setNotice(null);
    try {
      const parsed = parseBaseImport(paste);
      setLocalBase(parsed);
      // Mirror to the shared store so the MCP bridge + tailor_cv can use it.
      void pushBaseToServer(parsed);
      setNotice(
        `Loaded ${parsed.profile.name}. This is now the base for fit-checks, drafts, follow-ups, and advisor features. Reload open tabs to pick it up.`,
      );
      setPaste("");
      setOpen(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    }
  }, [paste, refresh]);

  const onClear = useCallback(() => {
    const ok = window.confirm(
      "Revert to the demo persona? Your loaded data is removed from this browser (your saved CVs and applications are NOT touched).",
    );
    if (!ok) return;
    clearLocalBase();
    setNotice("Reverted to the demo persona.");
    setError(null);
    refresh();
  }, [refresh]);

  return (
    <div className="border border-ink/15 rounded-sm p-5 bg-ink/[0.015]">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl mb-1">Base CV &amp; profile</h2>
          <p className="font-mono text-[11px] text-ink/60">
            {hasLocal ? (
              <>
                Using your data: <span className="text-ink">{name}</span>
              </>
            ) : (
              "On the demo persona (Ines Valverde). Load yours to tailor against your real background."
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setOpen((o) => !o);
              setError(null);
            }}
            className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink"
          >
            {hasLocal ? "Replace…" : "Load my data…"}
          </button>
          {hasLocal ? (
            <button
              type="button"
              onClick={onClear}
              className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/15 text-ink/60 px-4 py-2 hover:border-ink/30"
            >
              Revert to demo
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mt-4 space-y-3">
          <p className="font-mono text-[11px] text-ink/60 leading-relaxed">
            Paste a JSON object with <span className="text-ink">profile</span>{" "}
            and <span className="text-ink">cv</span> keys. Ask the chat copilot
            to &ldquo;structure my CV into base-data JSON&rdquo; if you don&apos;t
            have it yet. Nothing is uploaded — it stays in this browser.
          </p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={
              '{\n  "profile": { "name": "…", "email": "…", "title": "…" },\n  "cv": { "targetRole": "…", "experiences": [], "education": [], "skills": [] }\n}'
            }
            className="w-full border border-ink/20 bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed resize-y"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onLoad}
              disabled={!paste.trim()}
              className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Load
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPaste("");
                setError(null);
              }}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 font-mono text-[11px] text-red-400">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-3 font-mono text-[11px] text-green-400">{notice}</p>
      ) : null}
    </div>
  );
}

// ———————————————————————————————————————————————————————————————
// General tab
// ———————————————————————————————————————————————————————————————

function GeneralTab() {
  const ui = useSettings((s) => s.ui);
  const setUi = useSettings((s) => s.setUi);
  const discovery = useSettings((s) => s.discovery);
  const setDiscovery = useSettings((s) => s.setDiscovery);
  const reset = useSettings((s) => s.reset);

  const onReset = useCallback(() => {
    const ok = window.confirm(
      "Reset all settings to defaults? Your CVs and applications are NOT touched — only the settings blob.",
    );
    if (!ok) return;
    reset();
  }, [reset]);

  const onReopenOnboarding = useCallback(() => {
    setUi({ showOnboarding: true });
  }, [setUi]);

  return (
    <section className="space-y-6 max-w-prose">
      <div className="space-y-4">
        <label className="flex items-center gap-3 font-mono text-[12px]">
          <input
            type="checkbox"
            checked={ui.showCostPill}
            onChange={(e) => setUi({ showCostPill: e.target.checked })}
          />
          Show running cost pill in headers when AI calls land
        </label>
        <label className="flex items-center gap-3 font-mono text-[12px]">
          <input
            type="checkbox"
            checked={ui.showOnboarding}
            onChange={(e) => setUi({ showOnboarding: e.target.checked })}
          />
          Show first-run onboarding overlay
        </label>
      </div>

      <div className="space-y-3 border-t border-ink/10 pt-5">
        <label className="flex items-center gap-3 font-mono text-[12px]">
          <input
            type="checkbox"
            checked={discovery.autoRefreshEnabled}
            onChange={(e) => setDiscovery({ autoRefreshEnabled: e.target.checked })}
          />
          Auto-refresh discovery while the app is open
        </label>
        <p className="font-mono text-[10px] text-ink/50 max-w-prose">
          Periodically crawls your sources (dev.bg, ATS, aggregators, HN/RSS) and
          ingests job-alert emails — the legitimate, ToS-clean pulls. For always-on
          (app closed), point a cron at /api/discover/run + /api/discover/email-sync
          (see docs/email-alerts.md).
        </p>
        {discovery.autoRefreshEnabled ? (
          <div className="flex items-center gap-2">
            <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
              Every
            </label>
            <select
              className="border border-ink/20 bg-surface px-3 py-1.5 font-mono text-sm"
              value={discovery.autoRefreshIntervalMinutes}
              onChange={(e) =>
                setDiscovery({ autoRefreshIntervalMinutes: Number(e.target.value) })
              }
            >
              <option value={30}>30 minutes</option>
              <option value={60}>hour</option>
              <option value={180}>3 hours</option>
              <option value={360}>6 hours</option>
              <option value={720}>12 hours</option>
            </select>
            {discovery.lastRefreshAt ? (
              <span className="font-mono text-[10px] text-ink/40">
                last: {relativeTime(discovery.lastRefreshAt)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onReopenOnboarding}
          className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/20 px-4 py-2 hover:border-ink"
        >
          Reopen onboarding
        </button>
        <button
          type="button"
          onClick={onReset}
          className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/15 text-ink/60 px-4 py-2 hover:border-ink/30"
        >
          Reset settings to defaults
        </button>
      </div>
      <p className="font-mono text-[10px] text-ink/40">
        Defaults: provider {DEFAULT_SETTINGS.models.default.provider}, model{" "}
        {DEFAULT_SETTINGS.models.default.model}.
      </p>
      <DebugBlob />
    </section>
  );
}

function DebugBlob() {
  const all = useSettings((s): Settings => ({
    models: s.models,
    backup: s.backup,
    ui: s.ui,
    discovery: s.discovery,
  }));
  return (
    <details className="mt-6">
      <summary className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40 cursor-pointer">
        Raw settings JSON
      </summary>
      <pre className="mt-2 font-mono text-[10px] bg-ink/[0.03] p-3 border border-ink/10 overflow-x-auto">
        {JSON.stringify(all, null, 2)}
      </pre>
    </details>
  );
}
