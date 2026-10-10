import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the IDB shim with a simple in-memory Map. This avoids fake-indexeddb's
// structured-clone enforcement, which drops method properties (FSA handles
// carry them — and real browsers natively serialize them into IDB).

vi.mock("@/lib/settings/idb", () => {
  const store = new Map<string, unknown>();
  return {
    idbPut: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    idbGet: async (key: string) => store.get(key),
    idbDelete: async (key: string) => {
      store.delete(key);
    },
    __reset: () => store.clear(),
  };
});

import * as idb from "@/lib/settings/idb";
import {
  checkBackupStatus,
  clearBackupDirectory,
  isFSASupported,
  pickBackupDirectory,
} from "@/lib/settings/autoBackup";

type PermissionState = "granted" | "denied" | "prompt";

type MockHandle = {
  kind: "directory";
  name: string;
  queryPermission: () => Promise<PermissionState>;
  requestPermission: () => Promise<PermissionState>;
};

function makeHandle(state: PermissionState): MockHandle {
  return {
    kind: "directory",
    name: "mock-backup",
    async queryPermission() {
      return state;
    },
    async requestPermission() {
      return state;
    },
  };
}

const realShowDirectoryPicker = (
  window as unknown as { showDirectoryPicker?: unknown }
).showDirectoryPicker;

beforeEach(async () => {
  localStorage.clear();
  await clearBackupDirectory();
  // Also wipe the mocked store in case clearBackupDirectory wasn't enough.
  const resettable = idb as unknown as { __reset?: () => void };
  resettable.__reset?.();
});

afterEach(() => {
  if (realShowDirectoryPicker === undefined) {
    delete (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker;
  } else {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker =
      realShowDirectoryPicker;
  }
});

describe("auto-backup permission branching", () => {
  it("reports unsupported when showDirectoryPicker is missing", async () => {
    delete (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker;
    expect(isFSASupported()).toBe(false);
    const status = await checkBackupStatus();
    expect(status.kind).toBe("unsupported");
  });

  it("reports no-handle when FSA is supported but no folder picked", async () => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker =
      vi.fn();
    expect(isFSASupported()).toBe(true);
    const status = await checkBackupStatus();
    expect(status.kind).toBe("no-handle");
  });

  it("pickBackupDirectory throws on unsupported browsers", async () => {
    delete (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker;
    await expect(pickBackupDirectory()).rejects.toThrow(/File System Access/i);
  });

  it("pickBackupDirectory completes when a picker is wired up", async () => {
    const granted = makeHandle("granted");
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker =
      vi.fn(async () => granted);
    await expect(pickBackupDirectory()).resolves.toBeUndefined();
    const status = await checkBackupStatus();
    expect(status.kind).toBe("ready");
  });

  it("surfaces needs-permission when the stored handle is revoked", async () => {
    const pending = makeHandle("prompt");
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker =
      vi.fn(async () => pending);
    await pickBackupDirectory();
    const status = await checkBackupStatus();
    expect(status.kind).toBe("needs-permission");
  });
});
