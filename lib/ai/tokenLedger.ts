"use client";

import { useSyncExternalStore } from "react";
import type { UsageEnvelope } from "./tokenTracker";
import { USAGE_HEADER, decodeUsageHeader } from "./tokenTracker";

// ————————————————————————————————————————————————
// Client-side token ledger.
//
// Intercepts fetch responses to AI-backed routes via `trackedFetch`, reads
// the `x-cv-usage` header, and appends to a rolling log under
// `cv-maker:token-ledger`. Cap is 500 entries — oldest drop off the front.
//
// We intentionally keep the store minimal: no framework subscriptions beyond
// `useSyncExternalStore`, no Zustand. This runs in the browser (marked
// `"use client"`) and degrades to a no-op server-side.
// ————————————————————————————————————————————————

const STORAGE_KEY = "cv-maker:token-ledger";
const MAX_ENTRIES = 500;

export type TokenLedgerSnapshot = {
  entries: UsageEnvelope[];
  sessionCost: number;
  sessionInput: number;
  sessionOutput: number;
};

const EMPTY_SNAPSHOT: TokenLedgerSnapshot = {
  entries: [],
  sessionCost: 0,
  sessionInput: 0,
  sessionOutput: 0,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: TokenLedgerSnapshot = EMPTY_SNAPSHOT;
let hydrated = false;

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = EMPTY_SNAPSHOT;
      return;
    }
    const parsed = JSON.parse(raw) as UsageEnvelope[];
    if (!Array.isArray(parsed)) return;
    cache = summarise(parsed);
  } catch {
    cache = EMPTY_SNAPSHOT;
  }
}

function persist(entries: UsageEnvelope[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota / disabled — silently drop. Ledger is best-effort.
  }
}

function summarise(entries: UsageEnvelope[]): TokenLedgerSnapshot {
  let cost = 0;
  let input = 0;
  let output = 0;
  for (const e of entries) {
    cost += e.costUsd || 0;
    input += e.inputTokens || 0;
    output += e.outputTokens || 0;
  }
  return {
    entries,
    sessionCost: cost,
    sessionInput: input,
    sessionOutput: output,
  };
}

function subscribe(listener: Listener): () => void {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): TokenLedgerSnapshot {
  hydrate();
  return cache;
}

function getServerSnapshot(): TokenLedgerSnapshot {
  return EMPTY_SNAPSHOT;
}

/** Append a usage entry to the ledger. Trims to `MAX_ENTRIES`. */
export function appendLedgerEntry(env: UsageEnvelope): void {
  hydrate();
  const next = [...cache.entries, env];
  if (next.length > MAX_ENTRIES) {
    next.splice(0, next.length - MAX_ENTRIES);
  }
  cache = summarise(next);
  persist(next);
  notify();
}

/** Clear the ledger entirely. */
export function clearLedger(): void {
  hydrate();
  cache = EMPTY_SNAPSHOT;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  notify();
}

/** React hook — returns a stable snapshot updated on every append. */
export function useTokenLedger(): TokenLedgerSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ————————————————————————————————————————————————
// trackedFetch — wrap `fetch` so any AI-backed response that carries the
// `x-cv-usage` header lands in the ledger. Pass through for everything else.
// ————————————————————————————————————————————————

export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  try {
    const header = res.headers.get(USAGE_HEADER);
    const env = decodeUsageHeader(header);
    if (env) appendLedgerEntry(env);
  } catch {
    // never let ledger bookkeeping break the fetch caller
  }
  return res;
}

/** Factory: returns a `fetch` bound to `trackedFetch` so SDK transports adopt it. */
export function makeTrackedFetch(): typeof fetch {
  return trackedFetch as unknown as typeof fetch;
}
