// Opens a recorded synthetic portal page (fixtures/*.html, made-up companies) in happy-dom at its
// portal address, for the fillers' tests. It simulates what makes real portals hard: React-style
// controlled inputs that ignore direct `value` writes, and Submit buttons and forms that note any
// press (a test fails if one happens).
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

export interface FixturePage {
  document: Document;
  /** Every Submit or button press and form submission the page saw. Must stay empty. */
  presses: string[];
  field(id: string): HTMLInputElement;
}

export interface FixtureOptions {
  /** React-style inputs that ignore direct `value` writes. */
  controlled?: boolean;
  /**
   * How the page's upload boxes take a file: from the input's `change` (the default), only from a
   * `drop` on the box (the input ignores `change`), or not at all (the box rejects the file and says so).
   * An accepted file's name shows in the box, as portals show it.
   */
  uploads?: "change" | "drop-only" | "reject";
  /** The portal reads the CV once it's attached and, after `delayMs`, writes what it read into these fields. */
  cvParser?: { delayMs: number; values: Record<string, string> };
}

export function openFixture(name: string, url: string, { controlled = false, uploads = "change", cvParser }: FixtureOptions = {}): FixturePage {
  const window = new Window({ url, settings: { disableJavaScriptEvaluation: true, navigation: { disableMainFrameNavigation: true } } });
  const document = window.document as unknown as Document;
  document.body.innerHTML = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  const presses: string[] = [];
  for (const b of Array.from(document.querySelectorAll("button, input[type=submit], input[type=button], a"))) {
    b.addEventListener("click", () => presses.push(`pressed ${b.textContent?.trim() || b.getAttribute("value")}`));
  }
  for (const f of Array.from(document.querySelectorAll("form"))) f.addEventListener("submit", (e) => { e.preventDefault(); presses.push("submitted the form"); });

  if (controlled) {
    // React keeps the value in its own state: a direct write is ignored; an input event makes it read the DOM value.
    for (const el of Array.from(document.querySelectorAll<HTMLInputElement>("input:not([type=checkbox]):not([type=file]), textarea"))) {
      const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!;
      let state = native.get!.call(el) as string;
      Object.defineProperty(el, "value", { configurable: true, get: () => state, set: () => {} });
      el.addEventListener("input", () => { state = native.get!.call(el) as string; });
    }
  }
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>("input[type=file]"))) {
    const box = input.closest(".field, .file-upload")!;
    const accept = (file: File | undefined) => {
      if (!file) return;
      if (uploads === "reject") {
        input.value = "";
        box.querySelector(".filename")!.textContent = "";
        box.append(Object.assign(document.createElement("p"), { className: "error", textContent: "We couldn't read this file. Try another one." }));
        return;
      }
      box.querySelector(".filename")!.textContent = file.name;
      if (cvParser && input.id === "resume") {
        setTimeout(() => { for (const [id, v] of Object.entries(cvParser.values)) (document.getElementById(id) as HTMLInputElement).value = v; }, cvParser.delayMs);
      }
    };
    input.addEventListener("change", () => { if (uploads !== "drop-only") accept(input.files?.[0]); });
    box.addEventListener("dragover", (e) => e.preventDefault());
    box.addEventListener("drop", (e) => { e.preventDefault(); accept((e as DragEvent).dataTransfer?.files[0]); });
  }
  return { document, presses, field: (id) => document.getElementById(id) as HTMLInputElement };
}
