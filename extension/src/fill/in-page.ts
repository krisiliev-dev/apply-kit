// The one call the panel makes into the portal tab after injecting the filler (entrypoints/filler.ts):
// read, fill, retry, replace, fillOne, undo, show or describe, on the page's document. Chrome serialises this function into the
// tab, so it must not use anything from outside its own body.
export function runFiller(command: "read" | "fill" | "retry" | "replace" | "fillOne" | "undo" | "show" | "describe" | "pick" | "removeEntries", args: unknown[]): unknown {
  const filler = (globalThis as unknown as { applyKitFiller?: Record<string, ((doc: Document, ...a: unknown[]) => unknown) | undefined> }).applyKitFiller;
  const run = filler?.[command];
  return run ? run(document, ...args) : null;
}
