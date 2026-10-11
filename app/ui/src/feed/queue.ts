import type { FeedJob } from "@apply-kit/core";

// "Lists don't move under you" (DESIGN.md): rows found while the Feed is open wait behind the
// "N new jobs found · Show them" bar and join the list only when asked.

export interface ShownFeed {
  /** Rows on screen, in the order they were shown. */
  shown: FeedJob[];
  /** Rows found since, waiting behind the bar, in Feed order. */
  queued: FeedJob[];
}

/**
 * Takes a fresh Feed answer. Rows already on screen keep their place (and pick up updated
 * details); rows not seen before join the queue. An empty list has nothing to move, so new rows
 * go straight in.
 */
export function receive(current: ShownFeed, incoming: FeedJob[]): ShownFeed {
  if (current.shown.length === 0) return { shown: incoming, queued: [] };
  const latest = new Map(incoming.map((j) => [j.id, j]));
  const onScreen = new Set(current.shown.map((j) => j.id));
  return {
    shown: current.shown.map((j) => latest.get(j.id) ?? j),
    queued: incoming.filter((j) => !onScreen.has(j.id)),
  };
}

/** "Show them": every row on screen or waiting, in the Feed's own order. */
export function showQueued(current: ShownFeed, latest: FeedJob[]): FeedJob[] {
  const wanted = new Set([...current.shown, ...current.queued].map((j) => j.id));
  const ordered = latest.filter((j) => wanted.has(j.id));
  const placed = new Set(ordered.map((j) => j.id));
  // A row the Feed no longer lists stays until the next fresh load rather than vanishing mid-read.
  return [...ordered, ...current.shown.filter((j) => !placed.has(j.id))];
}
