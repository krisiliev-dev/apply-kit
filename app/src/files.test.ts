import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileStore } from "./files.ts";

const dirs: string[] = [];
const freshDir = () => { const d = mkdtempSync(join(tmpdir(), "apply-kit-files-")); dirs.push(d); return join(d, "files"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const bytes = (s: string) => new TextEncoder().encode(s);

describe("file store", () => {
  it("keeps a file under its SHA-256 and gives the same bytes back", async () => {
    const dir = freshDir();
    const store = createFileStore(dir);

    const stored = await store.put(bytes("abc"));

    expect(stored).toEqual({ sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", size: 3 });
    expect(readdirSync(dir)).toEqual(["ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"]);
    expect(new TextDecoder().decode((await store.get(stored.sha256))!)).toBe("abc");
  });

  it("keeps one copy of the same bytes stored twice", async () => {
    const dir = freshDir();
    const store = createFileStore(dir);

    await store.put(bytes("Mira Petrova CV"));
    await store.put(bytes("Mira Petrova CV"));

    expect(readdirSync(dir)).toHaveLength(1);
  });

  it("removes a copy, and answers null for a file it doesn't have", async () => {
    const store = createFileStore(freshDir());
    const { sha256 } = await store.put(bytes("old cover letter"));

    await store.remove(sha256);
    await store.remove(sha256);

    expect(await store.get(sha256)).toBeNull();
  });

  it("refuses a name that isn't a SHA-256, so nothing outside the folder is touched", async () => {
    const store = createFileStore(freshDir());

    await expect(store.get("../apply-kit.db")).rejects.toThrow(/SHA-256/);
    await expect(store.remove("../apply-kit.db")).rejects.toThrow(/SHA-256/);
  });
});
