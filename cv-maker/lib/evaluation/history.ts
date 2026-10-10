"use client";

import type { CvEvaluation } from "./types";

// ————————————————————————————————————————————————
// Score history.
//
// Every evaluation is appended to localStorage under a per-slug key so the
// EvalPanel can render a sparkline and show whether the current CV is
// trending up or down. We cap the history at 20 entries — enough to see a
// shape, cheap to keep.
// ————————————————————————————————————————————————

export type HistoryEntry = {
  overall: number;
  parseability: number;
  keywords: number;
  evaluatedAt: number;
  runId: string;
};

const HISTORY_LIMIT = 20;
const keyFor = (slug: string) => `cv-maker:eval-history:${slug}`;

export function appendToHistory(slug: string, evaluation: CvEvaluation): void {
  if (typeof window === "undefined") return;
  const list = readHistory(slug);
  const entry: HistoryEntry = {
    overall: evaluation.overall,
    parseability: evaluation.parseability.score,
    keywords: evaluation.keywords.score,
    evaluatedAt: evaluation.evaluatedAt,
    runId: evaluation.runId,
  };
  list.push(entry);
  const trimmed = list.slice(-HISTORY_LIMIT);
  try {
    window.localStorage.setItem(keyFor(slug), JSON.stringify(trimmed));
  } catch {
    // ignore quota
  }
}

export function readHistory(slug: string): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(slug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry);
  } catch {
    return [];
  }
}

export function clearHistory(slug: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(slug));
  } catch {
    // ignore
  }
}

function isHistoryEntry(v: unknown): v is HistoryEntry {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.overall === "number" &&
    typeof r.parseability === "number" &&
    typeof r.keywords === "number" &&
    typeof r.evaluatedAt === "number" &&
    typeof r.runId === "string"
  );
}
