// The file store (ADR 0003): files Kris brings are copied into the `files/` folder beside the
// database, named by their SHA-256. Their original names and types are kept in the database.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileStore } from "@apply-kit/core";

const SHA256 = /^[0-9a-f]{64}$/;

export function createFileStore(dir: string): FileStore {
  const pathOf = (sha256: string) => {
    if (!SHA256.test(sha256)) throw new Error(`Not a SHA-256 file name: ${sha256}`);
    return join(dir, sha256);
  };
  return {
    async put(bytes) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await mkdir(dir, { recursive: true });
      // Same bytes, same name: storing a file again leaves the one copy as it is.
      await writeFile(pathOf(sha256), bytes, { flag: "wx" }).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "EEXIST") throw err;
      });
      return { sha256, size: bytes.byteLength };
    },
    async get(sha256) {
      try {
        return new Uint8Array(await readFile(pathOf(sha256)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async remove(sha256) {
      await rm(pathOf(sha256), { force: true });
    },
  };
}
