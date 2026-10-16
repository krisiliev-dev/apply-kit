// The extension stays user-driven (Capture spec: never scroll, page or open listings; Apply spec and
// ADR 0005: nothing runs on a portal until Kris clicks). This guard reads the extension's own source
// and manifest and fails if anything that could drive a page, open tabs, run in the background or run
// on pages by itself creeps in. It backs up code review; it doesn't replace it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../wxt.config.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sources(path);
    return /\.(ts|tsx|html)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}
const read = (file: string) => readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");

/** The one background script: it only makes the toolbar icon and the keyboard command open the panel. */
const background = "src/entrypoints/background.ts";

/**
 * Page actions: the one module that sets values, sends input events, scrolls a field into view and
 * chooses inside a form control (a yes/no button, a typeahead's suggestion), inside a fill Kris clicked.
 */
const pageActions = "src/fill/page-actions.ts";

const forbidden: [RegExp, string][] = [
  [/\bscroll(To|By)\b|\.scrollTop\s*=|\.scrollLeft\s*=/, "scrolls a page"],
  [/\.click\(\)|new (Mouse|Keyboard|Pointer)Event/, "clicks or types on a page"],
  [/tabs\.(create|update|reload|duplicate)|windows\.create|window\.open\(/, "opens or navigates tabs"],
  [/location\.(assign|replace)\(|location\.href\s*=|history\.(pushState|replaceState)/, "navigates a page"],
  [/\balarms\b|defineContentScript|content_scripts|registerContentScripts|webNavigation|webRequest/, "runs on pages or in the background by itself"],
  [/MutationObserver|requestAnimationFrame/, "watches a page for more to load"],
];

/** The source of every handler registered for a tab changing; none may put code into a page. */
function tabListeners(text: string): string[] {
  const found: string[] = [];
  const start = /tabs\.on(Updated|Activated|Replaced|Created|Attached)\.addListener\(/g;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    found.push(text.slice(m.index, i));
  }
  return found;
}
/** Page actions' choose(): the source of the one function allowed to click. */
function choosing(text: string): string {
  const at = text.indexOf("export function choose(");
  if (at < 0) return "";
  let depth = 0;
  let i = text.indexOf("{", at);
  for (; i < text.length; i++) {
    depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
    if (depth === 0) break;
  }
  return text.slice(at, i + 1);
}
const injects = /executeScript|insertCSS|grabPage|\bfill\w*\(|\bcapture\w*\(/i;

describe("the extension only acts when Kris clicks", () => {
  const files = sources(root);

  it("has the files this guard is meant to read", () => {
    expect(files.some((f) => f.endsWith("grab.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith(join("sidepanel", "main.ts")))).toBe(true);
    expect(files.some((f) => f.endsWith(background))).toBe(true);
  });

  it("never scrolls, clicks, pages, opens listings or runs by itself", () => {
    // Page actions' one click, choosing inside a form control, is checked on its own below.
    const text = (file: string) => (file.slice(root.length) === pageActions ? read(file).replace(choosing(read(file)), "") : read(file));
    const found = files.flatMap((file) => forbidden.filter(([re]) => re.test(text(file))).map(([, what]) => `${file.slice(root.length)} ${what}`));
    expect(found).toEqual([]);
  });

  it("sends events and scrolls a field into view only from the page-actions module", () => {
    expect(files.map((f) => f.slice(root.length))).toContain(pageActions);
    const outside = files.filter((f) => f.slice(root.length) !== pageActions && /dispatchEvent\(|scrollIntoView|\.focus\(/.test(read(f)) && !f.includes(join("entrypoints", "sidepanel")));
    expect(outside.map((f) => f.slice(root.length))).toEqual([]);
    // The panel's own document may focus its own controls, but never sends events into a page.
    expect(read(join(root, "src/entrypoints/sidepanel/main.ts"))).not.toMatch(/dispatchEvent\(|scrollIntoView/);
    // Page actions press nothing (no form submission, no made-up mouse or key events) and click only
    // to choose inside a form control: once, in choose(), after choiceRefusal has said yes.
    const actions = read(join(root, pageActions));
    expect(actions).not.toMatch(/\.submit\(|requestSubmit|new (Mouse|Keyboard|Pointer)Event/);
    expect(actions.match(/\.click\(/g)).toHaveLength(1);
    expect(choosing(actions)).toMatch(/^export function choose\(el: Element\): boolean \{\s*if \(choiceRefusal\(el\)\) return false;\s*\(el as HTMLElement\)\.click\(\);/);
  });

  it("keeps in the browser's session storage only which fill session each tab is in", () => {
    const users = files.filter((f) => /storage\.session/.test(read(f))).map((f) => f.slice(root.length));
    expect(users).toEqual(["src/entrypoints/sidepanel/main.ts"]);
    expect(read(join(root, "src/entrypoints/sidepanel/main.ts")).match(/.*storage\.session.*/g)).toEqual([expect.stringMatching(/createTabSessions\(browser\.storage\.session\)/)]);
  });

  it("declares no content scripts and no background beyond opening the panel", () => {
    const entrypoints = files.filter((f) => f.includes(`${join("src", "entrypoints")}`)).map((f) => f.slice(root.length));
    expect(entrypoints.filter((f) => /content/i.test(f))).toEqual([]);
    expect(entrypoints.filter((f) => /background/i.test(f))).toEqual([background]);
    const bg = read(join(root, background));
    expect(bg).not.toMatch(/scripting|executeScript|tabs\.|storage|fetch\(|runtime\.on(Message|Connect)/);
  });

  it("only notes a tab's address changing: no tab handler puts code into a page", () => {
    // The detector itself must catch the thing it's here to catch.
    expect(tabListeners("browser.tabs.onUpdated.addListener((id, info) => { if (info.url) browser.scripting.executeScript({ target: { tabId: id }, func }); });").filter((l) => injects.test(l))).toHaveLength(1);
    const found = files.flatMap((file) => tabListeners(read(file)).filter((l) => injects.test(l)).map(() => file.slice(root.length)));
    expect(found).toEqual([]);
  });

  it("asks Chrome for no access to job sites at install, only for the tab Kris opens it on and this laptop", () => {
    const manifest = config.manifest as Record<string, unknown>;
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage", "sidePanel"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*", "http://localhost/*"]);
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest.action).not.toHaveProperty("default_popup");
    expect(files.filter((f) => f.includes(join("entrypoints", "popup")))).toEqual([]);
  });

  it("asks for the six portals only as optional hosts, granted from a click", () => {
    const manifest = config.manifest as Record<string, unknown>;
    expect(manifest.optional_host_permissions).toEqual([
      "https://*.myworkdayjobs.com/*",
      "https://*.myworkdaysite.com/*",
      "https://*.greenhouse.io/*",
      "https://*.lever.co/*",
      "https://*.smartrecruiters.com/*",
      "https://*.workable.com/*",
      "https://*.ashbyhq.com/*",
    ]);
    const requests = files.filter((f) => /permissions\.request\(/.test(read(f)));
    expect(requests.map((f) => f.slice(root.length))).toEqual(["src/entrypoints/sidepanel/main.ts"]);
  });

  it("declares a remappable Fill this page command", () => {
    const manifest = config.manifest as { commands?: Record<string, { suggested_key?: { default?: string }; description?: string }> };
    expect(manifest.commands?.["fill-this-page"]).toEqual({ suggested_key: { default: "Alt+Shift+F" }, description: "Fill this page" });
  });
});
