// "Show in Finder" (Apply #39): reveals a package file in Kris's Packages folder with macOS's `open -R`,
// which selects the file in a Finder window. Only files inside the Packages folder are revealed.
import { execFile } from "node:child_process";
import { relative, isAbsolute, resolve } from "node:path";
import type { Revealer } from "./fill-api.ts";

export function createFinderRevealer(packagesDir: string): Revealer {
  const root = resolve(packagesDir);
  return {
    reveal(path) {
      const rel = relative(root, resolve(path));
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) return Promise.reject(new Error("Only files in the Packages folder are shown in Finder"));
      return new Promise((done, fail) => execFile("open", ["-R", resolve(path)], (err) => (err ? fail(err) : done())));
    },
  };
}
