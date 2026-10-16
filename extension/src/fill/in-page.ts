// The one call the panel makes into the portal tab after injecting the filler (entrypoints/filler.ts):
// read, fill, replace, fillOne, undo or show, on the page's document. Chrome serialises this function into the
// tab, so it must not use anything from outside its own body.
export function runFiller(command: "read" | "fill" | "replace" | "fillOne" | "undo" | "show", args: unknown[]): unknown {
  const filler = (globalThis as unknown as { applyKitFiller?: Record<string, (doc: Document, ...a: unknown[]) => unknown> }).applyKitFiller;
  return filler ? filler[command]!(document, ...args) : null;
}
