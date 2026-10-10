// Pure analytics for application velocity.
// Given a list of Application records + a window (default 30 days) + a
// user-configured target capacity (default 20), compute:
//   - appliedInWindow          how many applications were created in the window
//   - targetCapacity           the user's monthly goal
//   - qualityRatio             fraction that have both cvSlug and jobData
//   - responseRate             non-auto-rejected fraction
//   - burnRate                 "under" | "on-track" | "over" | "spray"
//   - guidance                 short diagnostic string
//
// Classification thresholds (documented here because the README references them):
//   - "spray":     appliedInWindow > 1.5 * targetCapacity AND qualityRatio < 0.5
//   - "over":      appliedInWindow > 1.2 * targetCapacity
//   - "on-track":  within [0.7, 1.2] of target
//   - "under":     < 0.7 * target
//
// No side effects, no React.

import type { Application } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const EFFORT_TARGET_STORAGE_KEY = "cv-maker:effort-target";
export const EFFORT_TARGET_DEFAULT = 20;

export type BurnRate = "under" | "on-track" | "over" | "spray";

export type EffortBudget = {
  appliedInWindow: number;
  targetCapacity: number;
  qualityRatio: number; // 0..1
  responseRate: number; // 0..1
  burnRate: BurnRate;
  guidance: string;
  windowDays: number;
};

export function computeEffortBudget(
  applications: Application[],
  opts: { windowDays?: number; targetCapacity?: number; now?: number } = {},
): EffortBudget {
  const windowDays = Math.max(1, Math.round(opts.windowDays ?? 30));
  const targetCapacity = Math.max(1, Math.round(opts.targetCapacity ?? EFFORT_TARGET_DEFAULT));
  const now = opts.now ?? Date.now();
  const cutoff = now - windowDays * DAY_MS;

  // Exclude drafts — an unsent draft isn't an application yet.
  const windowed = applications.filter(
    (a) => a.dateCreated >= cutoff && a.status !== "draft",
  );

  const appliedInWindow = windowed.length;
  const withQuality = windowed.filter(
    (a) => Boolean(a.cvSlug) && Boolean(a.jobData),
  ).length;
  const qualityRatio = appliedInWindow === 0 ? 0 : withQuality / appliedInWindow;
  const nonAutoRejected = windowed.filter((a) => !isAutoRejected(a)).length;
  const responseRate = appliedInWindow === 0 ? 0 : nonAutoRejected / appliedInWindow;

  const burnRate = classify(appliedInWindow, targetCapacity, qualityRatio);
  const guidance = guidanceFor(burnRate, {
    appliedInWindow,
    targetCapacity,
    qualityRatio,
    responseRate,
  });

  return {
    appliedInWindow,
    targetCapacity,
    qualityRatio,
    responseRate,
    burnRate,
    guidance,
    windowDays,
  };
}

function isAutoRejected(a: Application): boolean {
  // Treat auto-rejection as the specific reason kind or a resume-stage loss.
  const rk = a.rejection?.kind;
  if (rk === "auto-rejection") return true;
  const stage = a.rejection?.extractedSignals?.stageLost;
  if (stage === "resume") return true;
  return false;
}

function classify(
  applied: number,
  target: number,
  qualityRatio: number,
): BurnRate {
  if (applied > 1.5 * target && qualityRatio < 0.5) return "spray";
  if (applied > 1.2 * target) return "over";
  if (applied >= 0.7 * target && applied <= 1.2 * target) return "on-track";
  return "under";
}

function guidanceFor(
  burn: BurnRate,
  data: {
    appliedInWindow: number;
    targetCapacity: number;
    qualityRatio: number;
    responseRate: number;
  },
): string {
  const { appliedInWindow, targetCapacity, qualityRatio, responseRate } = data;
  const q = `${Math.round(qualityRatio * 100)}% tailored`;
  const r = `${Math.round(responseRate * 100)}% response`;
  switch (burn) {
    case "spray":
      return `${appliedInWindow} applications in the window — ${q}. Spray-and-pray territory. Cut volume, raise tailoring.`;
    case "over":
      return `${appliedInWindow} applications vs. target of ${targetCapacity}. Volume is high; watch for burnout.`;
    case "on-track":
      return `${appliedInWindow} / ${targetCapacity} on target — ${q}, ${r}.`;
    case "under":
    default:
      if (appliedInWindow === 0) {
        return `0 in the last ${targetCapacity ? "30 days" : "window"}. Either on purpose, or ghost-hunting.`;
      }
      return `${appliedInWindow} / ${targetCapacity} — under target. Space to add ${targetCapacity - appliedInWindow} high-quality ones.`;
  }
}

// ———————————————————————————————————————————————
// Target-capacity persistence (SSR-safe)
// ———————————————————————————————————————————————

export function loadTargetCapacity(): number {
  if (typeof window === "undefined") return EFFORT_TARGET_DEFAULT;
  try {
    const raw = localStorage.getItem(EFFORT_TARGET_STORAGE_KEY);
    if (!raw) return EFFORT_TARGET_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return EFFORT_TARGET_DEFAULT;
    return Math.round(n);
  } catch {
    return EFFORT_TARGET_DEFAULT;
  }
}

export function saveTargetCapacity(n: number) {
  if (typeof window === "undefined") return;
  try {
    const clean = Math.max(1, Math.min(200, Math.round(n)));
    localStorage.setItem(EFFORT_TARGET_STORAGE_KEY, String(clean));
  } catch {
    // ignore
  }
}

export const BURN_LABEL: Record<BurnRate, string> = {
  under: "Under",
  "on-track": "On track",
  over: "Over",
  spray: "Spray",
};
