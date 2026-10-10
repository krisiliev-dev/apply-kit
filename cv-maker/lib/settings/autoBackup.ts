"use client";

// File System Access API auto-backup. Chromium-only today; we detect and
// surface a friendly fallback on Safari/Firefox.
//
// The granted `FileSystemDirectoryHandle` is not JSON-serializable, so we
// stash it in IndexedDB (which IS allowed to persist handles). localStorage
// only remembers a boolean flag ("we have a handle registered") so the UI
// can show status without poking IDB on every render.

import {
  BACKUP_VERSION,
  collectAllState,
  formatDateForFilename,
} from "./backup";
import { idbDelete, idbGet, idbPut } from "./idb";

const HANDLE_KEY = "cv-maker:backup-handle";
const DAILY_FILE_PREFIX = "cv-maker-";
const DAILY_FILE_SUFFIX = ".json";
const MAX_DAILY_FILES = 7;

export type AutoBackupStatus =
  | { kind: "unsupported" }
  | { kind: "no-handle" }
  | { kind: "needs-permission" }
  | { kind: "ready" };

// ———————————————————————————————————————————————————————————————
// FSA detection
// ———————————————————————————————————————————————————————————————

export function isFSASupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "showDirectoryPicker" in window &&
    typeof (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker === "function"
  );
}

// ———————————————————————————————————————————————————————————————
// FSA typed shims
// The DOM lib ships these types in recent TS releases but not all our
// transitive consumers expose them. We declare the minimum surface we call.
// ———————————————————————————————————————————————————————————————

type PermissionState = "granted" | "denied" | "prompt";

type FSPermissionDescriptor = { mode?: "read" | "readwrite" };

interface FSFileHandleLike {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: BlobPart): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface FSDirectoryHandleLike {
  kind: "directory";
  name: string;
  queryPermission(descriptor: FSPermissionDescriptor): Promise<PermissionState>;
  requestPermission(
    descriptor: FSPermissionDescriptor,
  ): Promise<PermissionState>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FSFileHandleLike>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterableIterator<[string, FSFileHandleLike | FSDirectoryHandleLike]>;
}

interface ShowDirectoryPickerWindow extends Window {
  showDirectoryPicker: (opts?: {
    mode?: "read" | "readwrite";
  }) => Promise<FSDirectoryHandleLike>;
}

// ———————————————————————————————————————————————————————————————
// Public API
// ———————————————————————————————————————————————————————————————

/**
 * Prompts the user to pick a folder and stores the granted handle in IDB.
 * Throws on unsupported browsers or user cancellation.
 */
export async function pickBackupDirectory(): Promise<void> {
  if (!isFSASupported()) {
    throw new Error(
      "Your browser doesn't support the File System Access API. " +
        "Chrome, Edge, and Arc work. Safari/Firefox don't yet — use manual " +
        "backups via 'Download backup' until they do.",
    );
  }
  const w = window as unknown as ShowDirectoryPickerWindow;
  // Can throw AbortError if the user cancels — we let that bubble so the UI
  // knows to not show a "success" toast.
  const handle = await w.showDirectoryPicker({ mode: "readwrite" });
  await idbPut(HANDLE_KEY, handle);
}

export async function clearBackupDirectory(): Promise<void> {
  await idbDelete(HANDLE_KEY);
}

export async function getBackupHandle(): Promise<FSDirectoryHandleLike | null> {
  if (!isFSASupported()) return null;
  const h = await idbGet<FSDirectoryHandleLike>(HANDLE_KEY);
  return h ?? null;
}

/**
 * Checks whether a handle exists AND permission is still granted. If the
 * browser dropped permission we try one re-request; the caller can decide
 * what to do with a "needs-permission" state (typically: prompt user).
 */
export async function checkBackupStatus(): Promise<AutoBackupStatus> {
  if (!isFSASupported()) return { kind: "unsupported" };
  const h = await getBackupHandle();
  if (!h) return { kind: "no-handle" };
  try {
    const state = await h.queryPermission({ mode: "readwrite" });
    if (state === "granted") return { kind: "ready" };
    return { kind: "needs-permission" };
  } catch {
    return { kind: "needs-permission" };
  }
}

/** Asks the user to re-grant readwrite permission on the stored handle. */
export async function requestBackupPermission(): Promise<boolean> {
  const h = await getBackupHandle();
  if (!h) return false;
  try {
    const state = await h.requestPermission({ mode: "readwrite" });
    return state === "granted";
  } catch {
    return false;
  }
}

/**
 * Writes a daily rolling backup. Name: `cv-maker-YYYY-MM-DD.json`. Same day
 * overwrites in place; new day creates a new file. After writing, prunes so
 * at most MAX_DAILY_FILES (7) backup files remain — oldest-first deletion.
 *
 * Returns the timestamp written, or null if FSA isn't usable right now.
 */
export async function runAutoBackup(): Promise<number | null> {
  const status = await checkBackupStatus();
  if (status.kind !== "ready") return null;

  const handle = await getBackupHandle();
  if (!handle) return null;

  const now = Date.now();
  const filename =
    DAILY_FILE_PREFIX + formatDateForFilename(new Date(now)) + DAILY_FILE_SUFFIX;
  const payload = collectAllState();
  // Stamp the payload's exportedAt to match the backup time.
  payload.exportedAt = now;
  const body = JSON.stringify(payload, null, 2);

  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(body);
  } finally {
    await writable.close();
  }

  await pruneOldBackups(handle);
  return now;
}

async function pruneOldBackups(handle: FSDirectoryHandleLike): Promise<void> {
  const matches: { name: string; modified: number }[] = [];
  try {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind !== "file") continue;
      if (!name.startsWith(DAILY_FILE_PREFIX)) continue;
      if (!name.endsWith(DAILY_FILE_SUFFIX)) continue;
      // Skip the version-stamped manual backup files — those have an `-HHmm`
      // segment and are user-triggered, not ours to rotate.
      const middle = name.slice(
        DAILY_FILE_PREFIX.length,
        -DAILY_FILE_SUFFIX.length,
      );
      if (!/^\d{4}-\d{2}-\d{2}$/.test(middle)) continue;
      try {
        const f = await entry.getFile();
        matches.push({ name, modified: f.lastModified });
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.warn("[backup] failed to enumerate backup files:", err);
    return;
  }
  if (matches.length <= MAX_DAILY_FILES) return;
  matches.sort((a, b) => a.modified - b.modified);
  const toDelete = matches.slice(0, matches.length - MAX_DAILY_FILES);
  for (const m of toDelete) {
    try {
      await handle.removeEntry(m.name);
    } catch (err) {
      console.warn(`[backup] failed to remove old backup ${m.name}:`, err);
    }
  }
}

/** Re-export the version for the UI to label files with. */
export { BACKUP_VERSION };
