"use client";

import {
  ADVISOR_KEYS,
  DECISIONS_HISTORY_MAX,
  EMPTY_ADVISOR_STATE,
  type AdvisorState,
  type CareerNarrative,
  type DecisionAnalysis,
  type PacingSnapshot,
  type SkillGapAnalysis,
  type StrategicProfile,
} from "./types";

// Per-artifact localStorage I/O. Keeps keys short and independent so a bad
// blob in one artifact never blocks reading the others.

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

function remove(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function loadAdvisorState(): AdvisorState {
  const narrative = readJson<CareerNarrative>(ADVISOR_KEYS.narrative);
  const skills = readJson<SkillGapAnalysis>(ADVISOR_KEYS.skills);
  const ceiling = readJson<StrategicProfile>(ADVISOR_KEYS.ceiling);
  const decisionsRaw = readJson<DecisionAnalysis[]>(ADVISOR_KEYS.decisions);
  const pacing = readJson<PacingSnapshot>(ADVISOR_KEYS.pacing);

  const decisions = Array.isArray(decisionsRaw)
    ? decisionsRaw.slice(0, DECISIONS_HISTORY_MAX)
    : EMPTY_ADVISOR_STATE.decisions;

  return {
    narrative,
    skills,
    ceiling,
    decisions,
    pacing,
  };
}

export function saveNarrative(n: CareerNarrative | null) {
  if (n === null) return remove(ADVISOR_KEYS.narrative);
  writeJson(ADVISOR_KEYS.narrative, n);
}

export function saveSkills(s: SkillGapAnalysis | null) {
  if (s === null) return remove(ADVISOR_KEYS.skills);
  writeJson(ADVISOR_KEYS.skills, s);
}

export function saveCeiling(c: StrategicProfile | null) {
  if (c === null) return remove(ADVISOR_KEYS.ceiling);
  writeJson(ADVISOR_KEYS.ceiling, c);
}

export function saveDecisions(list: DecisionAnalysis[]) {
  writeJson(ADVISOR_KEYS.decisions, list.slice(0, DECISIONS_HISTORY_MAX));
}

export function savePacing(p: PacingSnapshot | null) {
  if (p === null) return remove(ADVISOR_KEYS.pacing);
  writeJson(ADVISOR_KEYS.pacing, p);
}

export function clearAllAdvisor() {
  remove(ADVISOR_KEYS.narrative);
  remove(ADVISOR_KEYS.skills);
  remove(ADVISOR_KEYS.ceiling);
  remove(ADVISOR_KEYS.decisions);
  remove(ADVISOR_KEYS.pacing);
}
