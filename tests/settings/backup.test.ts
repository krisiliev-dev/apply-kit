import { describe, it, expect, beforeEach } from "vitest";
import {
  BACKUP_VERSION,
  collectAllState,
  estimateKeySize,
  isBackupPayload,
  listAllKeys,
  restoreAllState,
} from "@/lib/settings/backup";

// Round-trip test. Seed localStorage with several `cv-maker:*` keys plus a
// non-cv-maker key and a pairing secret — then export, wipe, and restore.

beforeEach(() => {
  localStorage.clear();
});

describe("export/import round-trip", () => {
  it("captures every cv-maker:* key and restores them exactly", () => {
    localStorage.setItem(
      "cv-maker:doc:default",
      JSON.stringify({ slug: "default", title: "demo" }),
    );
    localStorage.setItem(
      "cv-maker:applications",
      JSON.stringify([{ id: "a1", company: "Acme" }]),
    );
    localStorage.setItem("cv-maker:effort-target", "20"); // raw numeric string
    // Non-cv-maker key that must NOT be exported.
    localStorage.setItem("unrelated", "stay");
    // Pairing secret that must NOT be exported.
    localStorage.setItem("cv-maker:pairing:token", "super-secret");

    const payload = collectAllState();
    expect(payload.version).toBe(BACKUP_VERSION);
    expect(Object.keys(payload.state).sort()).toEqual([
      "cv-maker:applications",
      "cv-maker:doc:default",
      "cv-maker:effort-target",
    ]);
    expect("cv-maker:pairing:token" in payload.state).toBe(false);
    expect("unrelated" in payload.state).toBe(false);

    // Wipe (but keep the pairing & unrelated keys to verify restore doesn't clobber them).
    localStorage.removeItem("cv-maker:doc:default");
    localStorage.removeItem("cv-maker:applications");
    localStorage.removeItem("cv-maker:effort-target");

    const summary = restoreAllState(payload);
    expect(summary.restored).toBe(3);
    expect(summary.skipped).toEqual([]);

    expect(JSON.parse(localStorage.getItem("cv-maker:doc:default")!)).toEqual({
      slug: "default",
      title: "demo",
    });
    expect(localStorage.getItem("cv-maker:effort-target")).toBe("20");
    // Pairing + unrelated untouched.
    expect(localStorage.getItem("cv-maker:pairing:token")).toBe("super-secret");
    expect(localStorage.getItem("unrelated")).toBe("stay");
  });

  it("restoreAllState throws on a non-backup payload", () => {
    expect(() => restoreAllState({})).toThrow();
    expect(() => restoreAllState({ version: 999, state: {} })).toThrow();
    expect(() => restoreAllState(null)).toThrow();
  });

  it("isBackupPayload accepts valid and rejects invalid shapes", () => {
    expect(
      isBackupPayload({
        version: BACKUP_VERSION,
        exportedAt: Date.now(),
        state: {},
      }),
    ).toBe(true);
    expect(isBackupPayload({ version: BACKUP_VERSION, state: {} })).toBe(false);
    expect(isBackupPayload({ version: 2, exportedAt: 0, state: {} })).toBe(
      false,
    );
  });

  it("restoreAllState replaces existing keys instead of merging", () => {
    localStorage.setItem("cv-maker:old", JSON.stringify({ keep: false }));
    const payload = {
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      state: {
        "cv-maker:new": { fresh: true },
      },
    };
    const summary = restoreAllState(payload);
    expect(summary.restored).toBe(1);
    expect(localStorage.getItem("cv-maker:old")).toBeNull();
    expect(JSON.parse(localStorage.getItem("cv-maker:new")!)).toEqual({
      fresh: true,
    });
  });

  it("collectAllState preserves raw string values when JSON.parse fails", () => {
    localStorage.setItem("cv-maker:weird", "definitely-not-json{");
    const payload = collectAllState();
    expect(payload.state["cv-maker:weird"]).toBe("definitely-not-json{");
  });

  it("listAllKeys only returns cv-maker:* keys, sorted", () => {
    localStorage.setItem("cv-maker:z", "1");
    localStorage.setItem("cv-maker:a", "1");
    localStorage.setItem("other", "1");
    expect(listAllKeys()).toEqual(["cv-maker:a", "cv-maker:z"]);
  });

  it("estimateKeySize returns non-zero for a stored key", () => {
    localStorage.setItem("cv-maker:size", JSON.stringify({ hi: "there" }));
    const size = estimateKeySize("cv-maker:size");
    expect(size).toBeGreaterThan(10);
  });
});
