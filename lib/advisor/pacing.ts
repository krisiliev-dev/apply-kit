// Pure pacing math. No LLM, no side effects. Callable from both the client
// (on-mount banner in /applications) and the server (/api/advisor/pacing).
//
// Signal: "sprint detected" when last-7-day volume exceeds the user's
// sustainable weekly pace by more than 30% AND there hasn't been a >=2-day
// gap in the window. The second condition matters: a normal user who applies
// twice a week can still exceed a low sustainable baseline, but if they're
// spacing it out we don't need to intervene.

import type { Application } from "@/lib/app/types";
import type { PacingSnapshot } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_SUSTAINABLE_PER_WEEK = 5; // ~20/month — matches the roadmap's effort-budget hint

// Inputs: application list + user's monthly effort target (if any). We accept
// either a raw `sustainablePerWeek` or a monthly-target to keep the API
// flexible for callers that haven't wired a preference yet.
export type PacingInput = {
  applications: Pick<Application, "dateCreated">[];
  sustainablePerWeek?: number;
  monthlyTarget?: number;
  now?: number;
};

export function computePacing(input: PacingInput): PacingSnapshot {
  const now = input.now ?? Date.now();
  const sustainablePerWeek =
    input.sustainablePerWeek ??
    (typeof input.monthlyTarget === "number"
      ? input.monthlyTarget / 4
      : DEFAULT_SUSTAINABLE_PER_WEEK);

  const dates = input.applications
    .map((a) => a.dateCreated)
    .filter((t): t is number => typeof t === "number" && !Number.isNaN(t))
    .sort((a, b) => a - b);

  const last7Cutoff = now - 7 * DAY_MS;
  const last30Cutoff = now - 30 * DAY_MS;
  const last7Days = dates.filter((t) => t >= last7Cutoff).length;
  const last30Days = dates.filter((t) => t >= last30Cutoff).length;

  const sprintThreshold = Math.ceil(sustainablePerWeek * 1.3);
  const hasGap = hasGapInWindow(dates, last7Cutoff, now, 2 * DAY_MS);
  const sprintDetected = last7Days > sprintThreshold && !hasGap;

  const daysSinceLastGap = daysSinceLastGapOf(dates, now, 2 * DAY_MS);

  const guidance = buildGuidance({
    last7Days,
    last30Days,
    sustainablePerWeek,
    sprintDetected,
    daysSinceLastGap,
  });

  return {
    last7Days,
    last30Days,
    sustainablePerWeek: round1(sustainablePerWeek),
    sprintDetected,
    daysSinceLastGap,
    guidance,
    generatedAt: now,
  };
}

// Returns true if there's a contiguous stretch of at least `minGapMs` between
// any two consecutive applications inside the window. An empty window counts
// as "yes, gap everywhere".
function hasGapInWindow(
  sortedDates: number[],
  from: number,
  to: number,
  minGapMs: number,
): boolean {
  const inWindow = sortedDates.filter((t) => t >= from && t <= to);
  if (inWindow.length === 0) return true;
  // Gap between window-start and first app
  if (inWindow[0] - from >= minGapMs) return true;
  for (let i = 1; i < inWindow.length; i++) {
    if (inWindow[i] - inWindow[i - 1] >= minGapMs) return true;
  }
  // Gap between last app and now
  if (to - inWindow[inWindow.length - 1] >= minGapMs) return true;
  return false;
}

// Days since the most recent gap of at least `minGapMs`. If there's never
// been a gap (or only one application total), returns days since earliest
// application or 0 if none.
function daysSinceLastGapOf(
  sortedDates: number[],
  now: number,
  minGapMs: number,
): number {
  if (sortedDates.length === 0) return 0;
  let lastGapEnd: number | null = null;
  for (let i = 1; i < sortedDates.length; i++) {
    if (sortedDates[i] - sortedDates[i - 1] >= minGapMs) {
      lastGapEnd = sortedDates[i];
    }
  }
  // Also consider the "gap from now" — if the user hasn't applied in 2+ days,
  // that IS a gap, so days-since-last-gap is zero.
  if (now - sortedDates[sortedDates.length - 1] >= minGapMs) {
    return 0;
  }
  if (lastGapEnd === null) {
    return Math.floor((now - sortedDates[0]) / DAY_MS);
  }
  return Math.floor((now - lastGapEnd) / DAY_MS);
}

// Canned guidance strings, selected by which branch of the state machine we're
// in. No LLM — the roadmap says pacing is math + templates.
function buildGuidance(args: {
  last7Days: number;
  last30Days: number;
  sustainablePerWeek: number;
  sprintDetected: boolean;
  daysSinceLastGap: number;
}): string {
  const { last7Days, last30Days, sustainablePerWeek, sprintDetected, daysSinceLastGap } = args;

  if (last30Days === 0) {
    return "No applications in the last 30 days. If you're between pushes, that's fine — no action needed.";
  }

  if (sprintDetected) {
    return `You logged ${last7Days} applications in the last 7 days against a sustainable pace of ~${round1(
      sustainablePerWeek,
    )}/week, and you haven't taken a day off. Consider a 1–2 day pause — quality tends to drop faster than volume rises past this point.`;
  }

  if (last7Days > Math.ceil(sustainablePerWeek)) {
    return `Slightly above your sustainable pace (${last7Days} vs ~${round1(
      sustainablePerWeek,
    )}/week). Not a sprint yet, but worth watching the tailoring quality on the next few.`;
  }

  if (last7Days === 0 && last30Days > 0) {
    return "Nothing in the last 7 days. Recovering from a sprint, or a natural lull — either is fine.";
  }

  if (daysSinceLastGap >= 14) {
    return `You've applied steadily for ${daysSinceLastGap} days without a break. A deliberate rest day improves the next cover letter more than the raw volume does.`;
  }

  return `On pace: ${last7Days} in the last 7 days, ${last30Days} in the last 30. Sustainable baseline is ~${round1(
    sustainablePerWeek,
  )}/week.`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
