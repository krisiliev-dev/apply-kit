import type { SourceAdapter } from "./adapter.ts";
import { ashby } from "./ashby.ts";
import { greenhouse } from "./greenhouse.ts";
import { lever } from "./lever.ts";
import { recruitee } from "./recruitee.ts";

/** Every Source type the engine can check, by kind. New adapters register here. */
export const adapters: Record<string, SourceAdapter<unknown>> = {
  [greenhouse.kind]: greenhouse as SourceAdapter<unknown>,
  [lever.kind]: lever as SourceAdapter<unknown>,
  [ashby.kind]: ashby as SourceAdapter<unknown>,
  [recruitee.kind]: recruitee as SourceAdapter<unknown>,
};

export function adapterFor(kind: string): SourceAdapter<unknown> {
  const a = adapters[kind];
  if (!a) throw new Error(`Unknown source type "${kind}". Known: ${Object.keys(adapters).join(", ")}`);
  return a;
}
