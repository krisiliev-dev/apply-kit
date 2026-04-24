// Pure analytics helpers for the /applications/review page.
// Every function takes Application[] and returns plain data — no React, no
// side effects. Tested informally via the comments below each helper that
// show expected outputs for a small fixture.
//
// Fixture shape used in comments:
//   const now = 1700000000000;
//   const apps = [
//     { id: "a", dateCreated: now - 5*DAY,  status: "rejected", cvSlug: "default",
//       events: [{ at: now - 4*DAY, kind: "status-change", from: "applied", to: "screen" },
//                { at: now - 2*DAY, kind: "status-change", from: "screen",  to: "rejected" }],
//       rejection: { kind: "post-screen", closedAt: now-2*DAY, aiSummary: "...",
//                    lessonsForFuture: ["Open intro with shipping-speed story"],
//                    extractedSignals: { ..., stageLost: "screen", politeness: "standard" } } },
//     { id: "b", dateCreated: now - 30*DAY, status: "offer", cvSlug: "engineer",
//       events: [{ at: now - 28*DAY, kind: "status-change", from: "applied", to: "screen" },
//                { at: now - 20*DAY, kind: "status-change", from: "screen",  to: "interview" },
//                { at: now - 10*DAY, kind: "status-change", from: "interview", to: "offer" }] },
//   ];

import type {
  Application,
  ApplicationEvent,
  ApplicationStatus,
  RejectionStageLost,
} from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const NINETY_DAYS_MS = 90 * DAY_MS;

// ———————————————————————————————————————————————
// Windowing
// ———————————————————————————————————————————————

export function within90Days(apps: Application[], now: number = Date.now()): Application[] {
  const cutoff = now - NINETY_DAYS_MS;
  return apps.filter((a) => a.dateCreated >= cutoff);
}

// ———————————————————————————————————————————————
// Funnel
// ———————————————————————————————————————————————

export type FunnelCounts = {
  applied: number;
  screen: number;
  interview: number;
  offer: number;
  rejected: number;
  withdrawn: number;
  ghosted: number; // ghosted-short + ghosted-long
  total: number;
};

// Counts the HIGH-WATER-MARK stage each application reached (plus terminal
// outcomes). An application that reached `interview` but is now `rejected`
// increments interview AND rejected — because we want to understand where
// people fell off.
//
// For fixture `apps`:
//   funnel(apps) => { applied: 2, screen: 2, interview: 1, offer: 1, rejected: 1, withdrawn: 0, ghosted: 0, total: 2 }
export function funnel(apps: Application[]): FunnelCounts {
  const counts: FunnelCounts = {
    applied: 0,
    screen: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
    ghosted: 0,
    total: apps.length,
  };

  for (const a of apps) {
    const reached = reachedStages(a);
    if (reached.has("applied")) counts.applied += 1;
    if (reached.has("screen")) counts.screen += 1;
    if (reached.has("interview")) counts.interview += 1;
    if (reached.has("offer")) counts.offer += 1;
    if (a.status === "rejected") counts.rejected += 1;
    if (a.status === "withdrawn") counts.withdrawn += 1;
    if (a.status === "ghosted-short" || a.status === "ghosted-long") {
      counts.ghosted += 1;
    }
  }
  return counts;
}

function reachedStages(a: Application): Set<ApplicationStatus> {
  const reached = new Set<ApplicationStatus>();
  // Everything with a dateCreated has at least been drafted. Any non-draft
  // status means the user applied.
  if (a.status !== "draft") reached.add("applied");
  for (const e of a.events ?? []) {
    if (e.kind !== "status-change") continue;
    if (e.to) reached.add(e.to);
  }
  reached.add(a.status);
  return reached;
}

// ———————————————————————————————————————————————
// Response-rate trend (weekly)
// ———————————————————————————————————————————————

export type WeekBucket = {
  weekStart: number; // ms timestamp for the start of the week
  label: string; // e.g. "Mar 04"
  sent: number; // applications created in this week
  responded: number; // applications that received ANY forward movement within the 90-day window
};

// Weekly buckets over the last 13 weeks (~90 days). Each application
// contributes to the week of its `dateCreated` for `sent`, and to the same
// week for `responded` if it eventually moved past `applied` at any point.
//
// For fixture `apps`: two weeks ago sent 1, responded 1; four weeks ago sent 1, responded 1.
export function responseRateByWeek(
  apps: Application[],
  now: number = Date.now(),
): WeekBucket[] {
  const weeks = 13;
  const buckets: WeekBucket[] = [];
  const startOfToday = startOfDay(now);
  const anchor = startOfToday - ((weeks - 1) * 7 * DAY_MS);

  for (let i = 0; i < weeks; i++) {
    const weekStart = anchor + i * 7 * DAY_MS;
    buckets.push({
      weekStart,
      label: monthDayLabel(weekStart),
      sent: 0,
      responded: 0,
    });
  }

  for (const a of apps) {
    const idx = weekIndex(a.dateCreated, anchor, weeks);
    if (idx < 0) continue;
    buckets[idx].sent += 1;
    if (hasResponse(a)) buckets[idx].responded += 1;
  }

  return buckets;
}

function hasResponse(a: Application): boolean {
  const moved = (a.events ?? []).some(
    (e) =>
      e.kind === "status-change" &&
      e.from === "applied" &&
      e.to &&
      e.to !== "applied",
  );
  if (moved) return true;
  // If current status is past applied, count as responded even without an event.
  const forward: ApplicationStatus[] = ["screen", "interview", "offer"];
  return forward.includes(a.status);
}

// ———————————————————————————————————————————————
// Time-to-response distribution
// ———————————————————————————————————————————————

export type ResponseHistogram = {
  buckets: Array<{ label: string; minDays: number; maxDays: number; count: number }>;
  sampleCount: number;
  medianDays: number | null;
};

const HISTOGRAM_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "≤3d", min: 0, max: 3 },
  { label: "4–7d", min: 4, max: 7 },
  { label: "8–14d", min: 8, max: 14 },
  { label: "15–30d", min: 15, max: 30 },
  { label: "31–60d", min: 31, max: 60 },
  { label: "61d+", min: 61, max: Infinity },
];

// Distribution of days between `dateCreated` and the first status-change event
// that moves past `applied`. Applications that never moved are excluded.
//
// For fixture `apps`: response times are ~2 days and ~2 days -> both in ≤3d bucket.
export function responseTimeHistogram(apps: Application[]): ResponseHistogram {
  const days: number[] = [];
  for (const a of apps) {
    const firstMove = firstForwardEvent(a);
    if (!firstMove) continue;
    const delta = (firstMove.at - a.dateCreated) / DAY_MS;
    if (delta < 0) continue;
    days.push(delta);
  }

  const buckets = HISTOGRAM_BUCKETS.map((b) => ({
    label: b.label,
    minDays: b.min,
    maxDays: b.max,
    count: days.filter((d) => d >= b.min && d <= b.max).length,
  }));

  const sorted = [...days].sort((a, b) => a - b);
  const medianDays =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  return {
    buckets,
    sampleCount: days.length,
    medianDays: medianDays === null ? null : Math.round(medianDays * 10) / 10,
  };
}

function firstForwardEvent(a: Application): ApplicationEvent | undefined {
  const events = (a.events ?? [])
    .filter(
      (e) =>
        e.kind === "status-change" &&
        e.from === "applied" &&
        e.to &&
        e.to !== "applied",
    )
    .sort((a, b) => a.at - b.at);
  return events[0];
}

// ———————————————————————————————————————————————
// Variant performance
// ———————————————————————————————————————————————

export type VariantPerformance = {
  cvSlug: string;
  applied: number;
  screen: number;
  interview: number;
  offer: number;
  responseRate: number; // screen-or-past / applied
  interviewRate: number; // interview-or-past / applied
};

// Per-cvSlug counts. Applications without cvSlug are bucketed as "(none)".
// Ranked by interviewRate desc, then responseRate desc.
//
// For fixture `apps`: [{ cvSlug: "engineer", applied:1, screen:1, interview:1, offer:1, responseRate:1, interviewRate:1 }, ...]
export function variantPerformance(apps: Application[]): VariantPerformance[] {
  const bySlug = new Map<string, Application[]>();
  for (const a of apps) {
    const key = a.cvSlug ?? "(none)";
    const bucket = bySlug.get(key) ?? [];
    bucket.push(a);
    bySlug.set(key, bucket);
  }
  const rows: VariantPerformance[] = [];
  for (const [slug, group] of bySlug) {
    const c = funnel(group);
    const applied = Math.max(1, c.applied);
    rows.push({
      cvSlug: slug,
      applied: c.applied,
      screen: c.screen,
      interview: c.interview,
      offer: c.offer,
      responseRate: c.screen / applied,
      interviewRate: c.interview / applied,
    });
  }
  rows.sort((a, b) => {
    if (b.interviewRate !== a.interviewRate) return b.interviewRate - a.interviewRate;
    if (b.responseRate !== a.responseRate) return b.responseRate - a.responseRate;
    return b.applied - a.applied;
  });
  return rows;
}

// ———————————————————————————————————————————————
// Stall pattern
// ———————————————————————————————————————————————

export type StallPattern = {
  counts: Record<RejectionStageLost, number>;
  totalLosses: number;
  concentration?: {
    stage: RejectionStageLost;
    count: number;
    ratio: number;
  };
  flag?: string;
};

// Concentrates losses across stages. If >50% of losses happen at one stage,
// emits a flag string. "Losses" = anything with an attached rejection signal.
//
// For fixture `apps`: counts = { resume:0, screen:1, interview:0, final:0, offer:0 }, concentration at screen (1/1).
export function stallPattern(apps: Application[]): StallPattern {
  const counts: Record<RejectionStageLost, number> = {
    resume: 0,
    screen: 0,
    interview: 0,
    final: 0,
    offer: 0,
  };
  let totalLosses = 0;
  for (const a of apps) {
    const stage = a.rejection?.extractedSignals?.stageLost;
    if (!stage) continue;
    counts[stage] += 1;
    totalLosses += 1;
  }
  if (totalLosses === 0) return { counts, totalLosses };

  let maxStage: RejectionStageLost = "resume";
  let maxCount = 0;
  (Object.keys(counts) as RejectionStageLost[]).forEach((k) => {
    if (counts[k] > maxCount) {
      maxCount = counts[k];
      maxStage = k;
    }
  });
  const ratio = maxCount / totalLosses;
  const concentration = { stage: maxStage, count: maxCount, ratio };

  let flag: string | undefined;
  if (ratio > 0.5 && totalLosses >= 2) {
    flag = `Most losses: ${stageLabel(maxStage)} (${maxCount}/${totalLosses}). Consider prep focus there.`;
  }
  return { counts, totalLosses, concentration, flag };
}

export function stageLabel(stage: RejectionStageLost): string {
  switch (stage) {
    case "resume":
      return "resume screen";
    case "screen":
      return "recruiter screen";
    case "interview":
      return "interview loop";
    case "final":
      return "final round";
    case "offer":
      return "offer stage";
  }
}

// ———————————————————————————————————————————————
// Recent lessons (deduplicated)
// ———————————————————————————————————————————————

export type RecurringLesson = {
  text: string; // representative phrasing (first occurrence)
  occurrences: number;
  sourceApplicationIds: string[];
};

// Simple token-overlap fuzzy matcher. Two lessons are "the same" if they
// share at least 4 non-trivial tokens (length >=4) OR their Jaccard overlap
// on significant tokens is >=0.5. No embeddings — cheap and deterministic.
//
// For a fixture where three rejections yielded ["Open intro with shipping
// speed story", "Lead with shipping speed in intros", "Ask about team
// cadence"], output ranks the shipping-speed pair as one theme with 2 hits.
export function recurringLessons(
  apps: Application[],
  topN = 5,
): RecurringLesson[] {
  type Entry = { text: string; tokens: Set<string>; appIds: string[] };
  const entries: Entry[] = [];

  for (const a of apps) {
    const lessons = a.rejection?.lessonsForFuture ?? [];
    for (const raw of lessons) {
      const text = raw.trim();
      if (!text) continue;
      const tokens = significantTokens(text);
      if (tokens.size === 0) continue;

      const match = entries.find((e) => sameTheme(e.tokens, tokens));
      if (match) {
        match.appIds.push(a.id);
      } else {
        entries.push({ text, tokens, appIds: [a.id] });
      }
    }
  }

  return entries
    .map((e) => ({
      text: e.text,
      occurrences: e.appIds.length,
      sourceApplicationIds: e.appIds,
    }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, topN);
}

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "been",
  "before",
  "being",
  "between",
  "doing",
  "during",
  "each",
  "from",
  "further",
  "have",
  "having",
  "here",
  "into",
  "just",
  "more",
  "most",
  "once",
  "only",
  "other",
  "over",
  "same",
  "some",
  "such",
  "than",
  "that",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "very",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
  "yours",
  "will",
  "should",
  "could",
  "might",
  "must",
  "like",
  "even",
  "when",
]);

function significantTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t)),
  );
}

function sameTheme(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  if (shared >= 4) return true;
  const union = new Set<string>();
  a.forEach((t) => union.add(t));
  b.forEach((t) => union.add(t));
  const jaccard = shared / union.size;
  return jaccard >= 0.5;
}

// ———————————————————————————————————————————————
// Utilities
// ———————————————————————————————————————————————

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function weekIndex(ts: number, anchor: number, weeks: number): number {
  const diff = ts - anchor;
  if (diff < 0) return -1;
  const idx = Math.floor(diff / (7 * DAY_MS));
  if (idx >= weeks) return -1;
  return idx;
}

function monthDayLabel(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

// ———————————————————————————————————————————————
// Composite snapshot (convenience for UI)
// ———————————————————————————————————————————————

export type ReviewSnapshot = {
  windowStart: number;
  windowEnd: number;
  funnel: FunnelCounts;
  weekly: WeekBucket[];
  histogram: ResponseHistogram;
  variants: VariantPerformance[];
  stall: StallPattern;
  lessons: RecurringLesson[];
};

export function buildReviewSnapshot(
  allApps: Application[],
  now: number = Date.now(),
): ReviewSnapshot {
  const windowed = within90Days(allApps, now);
  return {
    windowStart: now - NINETY_DAYS_MS,
    windowEnd: now,
    funnel: funnel(windowed),
    weekly: responseRateByWeek(windowed, now),
    histogram: responseTimeHistogram(windowed),
    variants: variantPerformance(windowed),
    stall: stallPattern(windowed),
    lessons: recurringLessons(windowed, 5),
  };
}
