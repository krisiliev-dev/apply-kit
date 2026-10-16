// The one call the panel makes into the portal tab after injecting the filler (entrypoints/filler.ts):
// read, fill, replace, undo or show, on the page's document. Chrome serialises this function into the
// tab, so it must not use anything from outside its own body.
export function runFiller(command: "read" | "fill" | "replace" | "undo" | "show", args: unknown[]): unknown {
  const filler = (globalThis as unknown as { applyKitFiller?: Record<string, (doc: Document, ...a: unknown[]) => unknown> }).applyKitFiller;
  return filler ? filler[command]!(document, ...args) : null;
}

// Run in the tab's top page on a Fill click, to find a portal's form embedded in a company page.
// Like runFiller, it must not use anything from outside its own body.
export function frameSources(): string[] {
  return Array.from(document.querySelectorAll("iframe")).map((f) => f.src);
}

/** Run in every frame Chrome lets apply-kit into, to find the embedded form's frame by its address. */
export function frameAddress(): string {
  return location.href;
}
