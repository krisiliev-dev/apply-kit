import type { SourceAdapter } from "./adapter.ts";
import { greenhouse } from "./greenhouse.ts";
import { workday } from "./workday.ts";
import { microsoft } from "./microsoft.ts";
import { amazon } from "./amazon.ts";
import { devbg } from "./devbg.ts";

/** Every Source type the engine can check, by kind. New adapters register here. */
export const adapters: Record<string, SourceAdapter<unknown>> = {
  [greenhouse.kind]: greenhouse as SourceAdapter<unknown>,
  [workday.kind]: workday as SourceAdapter<unknown>,
  [microsoft.kind]: microsoft as SourceAdapter<unknown>,
  [amazon.kind]: amazon as SourceAdapter<unknown>,
  [devbg.kind]: devbg as SourceAdapter<unknown>,
};

export function adapterFor(kind: string): SourceAdapter<unknown> {
  const a = adapters[kind];
  if (!a) throw new Error(`Unknown source type "${kind}". Known: ${Object.keys(adapters).join(", ")}`);
  return a;
}
