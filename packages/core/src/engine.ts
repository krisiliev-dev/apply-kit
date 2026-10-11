import { migrate } from "./schema.ts";
import type { EngineDeps } from "./ports.ts";

export type FeedView = "new" | "saved" | "open" | "passed";

export interface FeedQuery {
  view: FeedView;
}

/** One row of the Feed. Filled in by the ingestion tickets. */
export interface FeedJob {
  id: string;
  title: string;
  company: string;
}

export type HealthState = "no-sources" | "working";

export interface FeedResult {
  view: FeedView;
  /** When this answer was computed, from the injected clock (ISO 8601). */
  asOf: string;
  /** True until the first source is connected: the UI shows the first-run state. */
  firstRun: boolean;
  jobs: FeedJob[];
  counts: { new: number; saved: number; open: number; passed: number; hidden: number };
  health: { state: HealthState; sources: number };
  ranking: { learnedAdjustments: number };
}

export interface DiscoveryEngine {
  queryFeed(query: FeedQuery): Promise<FeedResult>;
}

export function createEngine(deps: EngineDeps): DiscoveryEngine {
  const { db, clock } = deps;
  migrate(db);

  const count = (sql: string) => Number(db.prepare(sql).get()?.n ?? 0);

  return {
    async queryFeed(query) {
      const sources = count("SELECT COUNT(*) AS n FROM source");
      return {
        view: query.view,
        asOf: clock.now().toISOString(),
        firstRun: sources === 0,
        jobs: [],
        counts: { new: 0, saved: 0, open: 0, passed: 0, hidden: 0 },
        health: { state: sources === 0 ? "no-sources" : "working", sources },
        ranking: { learnedAdjustments: 0 },
      };
    },
  };
}
