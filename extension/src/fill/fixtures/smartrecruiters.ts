// SmartRecruiters' web components on the synthetic OneClick pages (smartrecruiters-*.html), for the
// SmartRecruiters filler's tests. The setup turns each `<template data-shadow>` into its host's shadow
// root (open or closed) and simulates the component: it keeps its own value and registers what's in
// its inner control only when an `input` or `change` event reaches the host from inside (as typing
// would; a direct write to the inner control is ignored). The CV drop zone takes a file from its
// input's change, only from a drop, or not at all, and shows the accepted file's name. Navigation
// buttons note any press, which fails a test.
import { openFixture, type FixturePage } from "./load.ts";

export const oneClickUrl = "https://jobs.smartrecruiters.com/oneclick-ui/company/NordlichtBank/publication/9b1c4e2a-7d3f-4a8b-b5c6-1e2f3a4b5c6d?dcr_ci=NordlichtBank";

export interface SmartRecruitersOptions {
  /** How the drop zone takes the CV (as `openFixture`'s `uploads`). */
  uploads?: "change" | "drop-only" | "reject";
  /** SmartRecruiters reads the CV once it's attached and, after `delayMs`, puts these values into these components (by host id). */
  cvParser?: { delayMs: number; values: Record<string, string> };
}

export interface SmartRecruitersPage extends FixturePage {
  /** The value a component registered (what SmartRecruiters would send), by its host id. */
  registered(hostId: string): string;
  /** A component's inner control, open or closed root alike (the test's view, not the filler's). */
  inner(hostId: string): HTMLInputElement;
  /** The file name the drop zone shows. */
  shownFile(): string;
}

export function openSmartRecruiters(name: string, { uploads = "change", cvParser }: SmartRecruitersOptions = {}, url = oneClickUrl): SmartRecruitersPage {
  const page = openFixture(name, url);
  const doc = page.document;
  const roots = new Map<string, ShadowRoot>();
  const state = new Map<string, () => string>();
  const write = new Map<string, (v: string) => void>();

  for (const template of Array.from(doc.querySelectorAll<HTMLTemplateElement>("template[data-shadow]"))) {
    const host = template.parentElement!;
    const root = host.attachShadow({ mode: template.getAttribute("data-shadow") === "closed" ? "closed" : "open" });
    root.append(template.content.cloneNode(true));
    template.remove();
    roots.set(host.id, root);
    for (const b of Array.from(root.querySelectorAll("button"))) b.addEventListener("click", () => page.presses.push(`pressed ${b.textContent?.trim()}`));

    const control = root.querySelector<HTMLInputElement>("input:not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea");
    if (!control) continue;
    const proto = Object.getPrototypeOf(control) as object;
    const native = Object.getOwnPropertyDescriptor(proto, "value") ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), "value")!;
    let value = native.get!.call(control) as string;
    Object.defineProperty(control, "value", { configurable: true, get: () => value, set: () => {} });
    // The component hears its control only through events that leave the shadow root, as typed input does.
    const register = (e: Event) => { if (e.composedPath()[0] === control) value = native.get!.call(control) as string; };
    host.addEventListener("input", register);
    host.addEventListener("change", register);
    state.set(host.id, () => value);
    write.set(host.id, (v) => { native.set!.call(control, v); value = v; });
  }

  const zone = roots.get("resume");
  const fileInput = zone?.querySelector<HTMLInputElement>("input[type=file]") ?? null;
  if (zone && fileInput) {
    const box = fileInput.closest(".dropzone")!;
    const accept = (file: File | undefined) => {
      if (!file) return;
      if (uploads === "reject") {
        box.querySelector(".filename")!.textContent = "";
        box.append(Object.assign(doc.createElement("p"), { className: "error", textContent: "We couldn't upload this file. Please try again." }));
        return;
      }
      box.querySelector(".filename")!.textContent = file.name;
      if (cvParser) setTimeout(() => { for (const [id, v] of Object.entries(cvParser.values)) write.get(id)?.(v); }, cvParser.delayMs);
    };
    fileInput.addEventListener("change", () => { if (uploads !== "drop-only") accept(fileInput.files?.[0]); });
    box.addEventListener("dragover", (e) => e.preventDefault());
    box.addEventListener("drop", (e) => { e.preventDefault(); accept((e as DragEvent).dataTransfer?.files[0]); });
  }

  return {
    ...page,
    registered: (id) => state.get(id)?.() ?? "",
    inner: (id) => roots.get(id)!.querySelector<HTMLInputElement>("input, select, textarea")!,
    shownFile: () => zone?.querySelector(".filename")?.textContent ?? "",
  };
}
