import type { SourceAdapter } from "./adapter.ts";
import { ashby } from "./ashby.ts";
import { greenhouse } from "./greenhouse.ts";
import { lever } from "./lever.ts";
import { personio } from "./personio.ts";
import { recruitee } from "./recruitee.ts";
import { smartrecruiters } from "./smartrecruiters.ts";
import { teamtailor } from "./teamtailor.ts";
import { workday } from "./workday.ts";
import { microsoft } from "./microsoft.ts";
import { amazon } from "./amazon.ts";
import { devbg } from "./devbg.ts";
import { jooble } from "./jooble.ts";
import { reed } from "./reed.ts";
import { eures } from "./eures.ts";

/** Every Source type the engine can check, by kind. New adapters register here. */
export const adapters: Record<string, SourceAdapter<unknown>> = {
  [greenhouse.kind]: greenhouse as SourceAdapter<unknown>,
  [lever.kind]: lever as SourceAdapter<unknown>,
  [ashby.kind]: ashby as SourceAdapter<unknown>,
  [recruitee.kind]: recruitee as SourceAdapter<unknown>,
  [smartrecruiters.kind]: smartrecruiters as SourceAdapter<unknown>,
  [personio.kind]: personio as SourceAdapter<unknown>,
  [teamtailor.kind]: teamtailor as SourceAdapter<unknown>,
  [workday.kind]: workday as SourceAdapter<unknown>,
  [microsoft.kind]: microsoft as SourceAdapter<unknown>,
  [amazon.kind]: amazon as SourceAdapter<unknown>,
  [devbg.kind]: devbg as SourceAdapter<unknown>,
  [jooble.kind]: jooble as SourceAdapter<unknown>,
  [reed.kind]: reed as SourceAdapter<unknown>,
  [eures.kind]: eures as SourceAdapter<unknown>,
};

export function adapterFor(kind: string): SourceAdapter<unknown> {
  const a = adapters[kind];
  if (!a) throw new Error(`Unknown source type "${kind}". Known: ${Object.keys(adapters).join(", ")}`);
  return a;
}

/** A Source type's display name ("Greenhouse", "dev.bg"). */
export function kindLabel(kind: string): string {
  return adapters[kind]?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}
