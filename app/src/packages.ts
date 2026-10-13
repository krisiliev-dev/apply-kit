// The packages folder (ADR 0003): generated PDFs in `packages/<package id>/` beside the database.
// A draft render replaces the previous draft of the same document; each folder remembers which
// file is the current draft of each document in a small `.draft-<kind>` note.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackageFolder } from "@apply-kit/core";

const SAFE_ID = /^[A-Za-z0-9-]+$/;
const SAFE_NAME = /^[A-Za-z0-9_.-]+\.pdf$/;

export function createPackageFolder(dataDir: string): PackageFolder {
  return {
    async saveDraft(packageId, kind, fileName, bytes) {
      if (!SAFE_ID.test(packageId)) throw new Error(`Not a package id: ${packageId}`);
      if (!SAFE_NAME.test(fileName) || fileName.startsWith(".")) throw new Error(`Not an ASCII PDF file name: ${fileName}`);
      const dir = join(dataDir, "packages", packageId);
      await mkdir(dir, { recursive: true });
      const note = join(dir, `.draft-${kind}`);
      const previous = await readFile(note, "utf8").catch(() => null);
      await writeFile(join(dir, fileName), bytes);
      if (previous && previous !== fileName && SAFE_NAME.test(previous)) await rm(join(dir, previous), { force: true });
      await writeFile(note, fileName);
      return { path: `packages/${packageId}/${fileName}` };
    },
  };
}
