import type { SourceAdapter } from "./adapter.ts";
import { greenhouse } from "./greenhouse.ts";

/** Every Source type the engine can check, by kind. New adapters register here. */
export const adapters: Record<string, SourceAdapter<unknown>> = {
  [greenhouse.kind]: greenhouse as SourceAdapter<unknown>,
};

export function adapterFor(kind: string): SourceAdapter<unknown> {
  const a = adapters[kind];
  if (!a) throw new Error(`Unknown source type "${kind}". Known: ${Object.keys(adapters).join(", ")}`);
  return a;
}
