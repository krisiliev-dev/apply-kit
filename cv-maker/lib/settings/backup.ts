"use client";

// Export / import of every `cv-maker:*` localStorage key as a single JSON
// payload. Used by:
//   - Settings > Backup tab (manual download / upload)
//   - Auto-backup loop (writes the same payload to a chosen folder)
//   - Onboarding wizard (import as a start path)
//
// Deliberately skips any `cv-maker:pairing:*` keys on export — we never want
// device tokens shipped out in a user-downloaded JSON file. Import is
// symmetric: pairing keys are left alone on restore.

export const BACKUP_VERSION = 1 as const;
export const KEY_PREFIX = "cv-maker:";
export const PAIRING_PREFIX = "cv-maker:pairing";

export type BackupPayload = {
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  state: Record<string, unknown>;
};

export type RestoreSummary = {
  restored: number;
  skipped: string[];
};

function isPairingSecretKey(key: string): boolean {
  // Anything under the pairing namespace is treated as sensitive.
  return key.startsWith(PAIRING_PREFIX);
}

/**
 * Walks localStorage, collecting every `cv-maker:*` entry into a JSON-safe
 * payload. Malformed JSON values are preserved as their raw string so a
 * round-trip is non-lossy; callers that need strict typing should validate
 * per-key on restore.
 */
export function collectAllState(): BackupPayload {
  const state: Record<string, unknown> = {};
  if (typeof window === "undefined") {
    return { version: BACKUP_VERSION, exportedAt: Date.now(), state };
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      if (isPairingSecretKey(key)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      try {
        state[key] = JSON.parse(raw);
      } catch {
        // Non-JSON value (e.g. a bare number string under `cv-maker:effort-
        // target`). Store the raw string so restore is exact.
        state[key] = raw;
      }
    }
  } catch (err) {
    // Very unlikely — localStorage access denied mid-iteration.
    console.warn("[backup] collectAllState partial:", err);
  }
  return { version: BACKUP_VERSION, exportedAt: Date.now(), state };
}

/**
 * Validates payload shape (lightly), then writes each key back. Replaces —
 * does NOT merge. Skips malformed entries and reports them in the summary.
 * Pairing keys are never touched, in or out.
 */
export function restoreAllState(payload: unknown): RestoreSummary {
  const skipped: string[] = [];
  let restored = 0;
  if (typeof window === "undefined") return { restored, skipped };

  if (!isBackupPayload(payload)) {
    throw new Error(
      "Backup file is not a valid cv-maker backup (missing version/state).",
    );
  }

  // Wipe existing non-pairing keys first so a restore is idempotent — the
  // user's intent with "restore" is "make my data look like this file".
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      if (isPairingSecretKey(key)) continue;
      toRemove.push(key);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch (err) {
    console.warn("[backup] failed to clear existing keys:", err);
  }

  for (const [key, value] of Object.entries(payload.state)) {
    if (!key.startsWith(KEY_PREFIX)) {
      skipped.push(key);
      continue;
    }
    if (isPairingSecretKey(key)) {
      skipped.push(key);
      continue;
    }
    try {
      const serialized =
        typeof value === "string" ? value : JSON.stringify(value);
      localStorage.setItem(key, serialized);
      restored++;
    } catch (err) {
      console.warn(`[backup] failed to restore key ${key}:`, err);
      skipped.push(key);
    }
  }

  return { restored, skipped };
}

export function isBackupPayload(x: unknown): x is BackupPayload {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  return (
    p.version === BACKUP_VERSION &&
    typeof p.exportedAt === "number" &&
    p.state !== null &&
    typeof p.state === "object"
  );
}

/** YYYY-MM-DD-HHmm in local time — stable, sortable, unambiguous in filenames. */
export function formatTimestampForFilename(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}-${hh}${mi}`;
}

/** YYYY-MM-DD — used for the daily rolling auto-backup file. */
export function formatDateForFilename(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Triggers a browser download of the current state as pretty-printed JSON. */
export function downloadBackup(): void {
  if (typeof window === "undefined") return;
  const payload = collectAllState();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cv-maker-backup-${formatTimestampForFilename()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Release the object URL on the next tick — Safari is touchy about immediate revoke.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a user-picked .json file and parse it into a payload. Throws on bad JSON. */
export async function readBackupFile(file: File): Promise<BackupPayload> {
  const text = await file.text();
  const parsed = JSON.parse(text) as unknown;
  if (!isBackupPayload(parsed)) {
    throw new Error(
      "This file doesn't look like a cv-maker backup (expected { version: 1, exportedAt, state }).",
    );
  }
  return parsed;
}

/** Best-effort estimate of how many bytes a stored key occupies. */
export function estimateKeySize(key: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return 0;
    // UTF-16 characters are 2 bytes in the spec but most browsers cap at
    // length. For a rough UI estimate, key + value length is good enough.
    return key.length + raw.length;
  } catch {
    return 0;
  }
}

/** List every `cv-maker:*` key currently in localStorage, sorted lexically. */
export function listAllKeys(): string[] {
  if (typeof window === "undefined") return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      keys.push(key);
    }
  } catch {
    return [];
  }
  keys.sort();
  return keys;
}
