// Capture stays user-driven (spec: never scroll, page or open listings; never automate LinkedIn).
// This guard reads the extension's own source and fails if anything that could drive a page, open
// tabs, run in the background or run on pages by itself creeps in. It backs up code review; it
// doesn't replace it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sources(path);
    return /\.(ts|tsx|html)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const forbidden: [RegExp, string][] = [
  [/\bscroll(To|By|IntoView)\b|\.scrollTop\s*=|\.scrollLeft\s*=/, "scrolls a page"],
  [/\.click\(\)|dispatchEvent\(|new (Mouse|Keyboard|Pointer)Event/, "clicks or types on a page"],
  [/tabs\.(create|update|reload|duplicate)|windows\.create|window\.open\(/, "opens or navigates tabs"],
  [/location\.(assign|replace)\(|location\.href\s*=|history\.(pushState|replaceState)/, "navigates a page"],
  [/\balarms\b|defineBackground|defineContentScript|content_scripts|webNavigation|webRequest/, "runs on pages or in the background by itself"],
  [/MutationObserver|requestAnimationFrame/, "watches a page for more to load"],
];

describe("the extension only acts when Kris clicks", () => {
  const files = sources(root);

  it("has the files this guard is meant to read", () => {
    expect(files.some((f) => f.endsWith("grab.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);
  });

  it("never scrolls, clicks, pages, opens listings or runs by itself", () => {
    const found = files.flatMap((file) => {
      const text = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
      return forbidden.filter(([re]) => re.test(text)).map(([, what]) => `${file.slice(root.length)} ${what}`);
    });
    expect(found).toEqual([]);
  });

  it("asks Chrome for no access to job sites, only for the tab Kris opens it on and this laptop", () => {
    const config = readFileSync(join(root, "wxt.config.ts"), "utf8");
    expect(config).toContain('permissions: ["activeTab", "scripting", "storage"]');
    expect(config).toContain('host_permissions: ["http://127.0.0.1/*", "http://localhost/*"]');
  });
});
