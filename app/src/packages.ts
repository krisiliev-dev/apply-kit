// The packages folder (ADR 0003): generated PDFs in `packages/<package id>/` beside the database.
// A draft render replaces the previous draft of the same document; each folder remembers which
// file is the current draft of each document in a small `.draft-<kind>` note. Approving a package
// (#67) freezes its files in `packages/<package id>/v<version>/`, written once and never again, and
// copies them to Kris's Packages folder (APPLY_KIT_PACKAGES_DIR, inside Documents by default).
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackageFolder } from "@apply-kit/core";

const SAFE_ID = /^[A-Za-z0-9-]+$/;
const SAFE_NAME = /^[A-Za-z0-9_.-]+\.pdf$/;
const VERSION = /^v[1-9]\d*$/;

const safeName = (fileName: string) => SAFE_NAME.test(fileName) && !fileName.startsWith(".");

export function createPackageFolder(dataDir: string, packagesDir?: string): PackageFolder {
  return {
    async saveDraft(packageId, kind, fileName, bytes) {
      if (!SAFE_ID.test(packageId)) throw new Error(`Not a package id: ${packageId}`);
      if (!safeName(fileName)) throw new Error(`Not an ASCII PDF file name: ${fileName}`);
      const dir = join(dataDir, "packages", packageId);
      await mkdir(dir, { recursive: true });
      const note = join(dir, `.draft-${kind}`);
      const previous = await readFile(note, "utf8").catch(() => null);
      await writeFile(join(dir, fileName), bytes);
      if (previous && previous !== fileName && SAFE_NAME.test(previous)) await rm(join(dir, previous), { force: true });
      await writeFile(note, fileName);
      return { path: `packages/${packageId}/${fileName}` };
    },
    async freeze(packageId, version, fileName, bytes) {
      if (!SAFE_ID.test(packageId)) throw new Error(`Not a package id: ${packageId}`);
      if (!safeName(fileName)) throw new Error(`Not an ASCII PDF file name: ${fileName}`);
      if (!Number.isInteger(version) || version < 1) throw new Error(`Not a version: ${version}`);
      const dir = join(dataDir, "packages", packageId, `v${version}`);
      await mkdir(dir, { recursive: true });
      // "wx": a frozen file is written once; writing it again fails rather than change it.
      await writeFile(join(dir, fileName), bytes, { flag: "wx" });
      let copy: string | null = null;
      if (packagesDir) {
        try {
          await mkdir(packagesDir, { recursive: true });
          await copyFile(join(dir, fileName), join(packagesDir, fileName));
          copy = join(packagesDir, fileName);
        } catch {
          copy = null;
        }
      }
      return { path: `packages/${packageId}/v${version}/${fileName}`, copy };
    },
    async read(path) {
      const parts = path.split("/");
      const [top, packageId] = parts;
      const version = parts.length === 4 ? parts[2]! : null;
      const fileName = parts[parts.length - 1]!;
      if (top !== "packages" || (parts.length !== 3 && parts.length !== 4) || !SAFE_ID.test(packageId ?? "") || !safeName(fileName) || (version !== null && !VERSION.test(version))) {
        throw new Error(`Not a package file: ${path}`);
      }
      return readFile(join(dataDir, ...parts)).then((b) => new Uint8Array(b), () => null);
    },
  };
}
