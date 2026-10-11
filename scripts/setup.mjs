// One-time setup: creates the data folder in Application Support (ADR 0001) and the repo's
// gitignored `data` shortcut pointing at it. Safe to run again.
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const dataDir = join(homedir(), "Library", "Application Support", "apply-kit");
const link = join(repoRoot, "data");

mkdirSync(dataDir, { recursive: true });
console.log(`Data folder: ${dataDir}`);

let linkStat = null;
try { linkStat = lstatSync(link); } catch { /* no link yet */ }

if (!linkStat) {
  symlinkSync(dataDir, link, "dir");
  console.log("Created the data shortcut: data -> " + dataDir);
} else if (linkStat.isSymbolicLink() && readlinkSync(link) === dataDir) {
  console.log("The data shortcut is already in place.");
} else {
  console.error(`Something else already exists at ${link}; leaving it alone. Move it, then run setup again.`);
  process.exit(1);
}

if (!existsSync(join(repoRoot, ".env"))) {
  console.log("No .env yet: copy .env.example to .env and fill in the values you need.");
}
