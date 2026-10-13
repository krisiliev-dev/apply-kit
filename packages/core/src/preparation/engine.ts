// The preparation engine: Prepare's deep module, beside the discovery engine and sharing its
// database, clock, settings and AI budget. It will own the master profile, angles, answer bank,
// voice, imports, the coach interview and packages (spec #51); each ticket adds its operations here.
import { migrate } from "../schema.ts";
import type { BudgetInfo } from "../budget.ts";
import type { PreparationDeps } from "./ports.ts";
import { createProfileStore, type DeletedPiece, type PieceInput, type PieceList, type PieceOrigin, type PieceQuery, type ProfileSummary, type SavePieceResult } from "./profile.ts";

export interface PreparationEngine {
  /** This month's AI spending against the cap, shared with Discover, so Prepare can say when a part must wait. */
  budget(): BudgetInfo;

  /**
   * Adds a piece (no id) or saves an edit to one, after the honesty checks. A refused piece comes back
   * with every problem, each tied to its field, and one-click honest fixes where there are any.
   * Kris's own pieces are confirmed; import, the coach and packages pass where theirs came from.
   */
  savePiece(input: PieceInput, origin?: PieceOrigin): SavePieceResult;
  /**
   * Deletes a piece. Pieces under a deleted role stay, tied to no role. Packages already approved or
   * submitted keep their files as they are.
   */
  deletePiece(id: string): DeletedPiece;
  /** How many pieces Profile holds, and what waits for Kris in each section (for the nav badge). */
  profileSummary(): ProfileSummary;
  /** The master profile grouped by role (roles, then education, then pieces tied to neither), filtered. */
  listPieces(query?: PieceQuery): PieceList;
}

export function createPreparationEngine(deps: PreparationDeps): PreparationEngine {
  migrate(deps.db);
  const profile = createProfileStore(deps);
  return {
    budget: () => deps.budget.info(),
    savePiece: (input, origin) => profile.save(input, origin),
    deletePiece: (id) => profile.remove(id),
    listPieces: (query) => profile.list(query),
    profileSummary: () => profile.summary(),
  };
}
