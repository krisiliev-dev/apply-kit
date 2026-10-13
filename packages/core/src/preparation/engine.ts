// The preparation engine: Prepare's deep module, beside the discovery engine and sharing its
// database, clock, settings and AI budget. It will own the master profile, angles, answer bank,
// voice, imports, the coach interview and packages (spec #51); each ticket adds its operations here.
import { migrate } from "../schema.ts";
import type { BudgetInfo } from "../budget.ts";
import type { PreparationDeps } from "./ports.ts";

export interface PreparationEngine {
  /** This month's AI spending against the cap, shared with Discover, so Prepare can say when a part must wait. */
  budget(): BudgetInfo;
}

export function createPreparationEngine(deps: PreparationDeps): PreparationEngine {
  migrate(deps.db);
  return {
    budget: () => deps.budget.info(),
  };
}
