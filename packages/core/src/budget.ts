// The monthly AI budget both engines spend from: one hard cap over extraction (Discover) and
// writing (Prepare), checked before every model call, with every call's cost booked in the
// `ai_spend` ledger under its task. The service makes one and passes it to both engines.
import type { Clock, SqlDatabase } from "./ports.ts";
import type { WriterTask } from "./writing/writer.ts";

/** This month's AI spending against the cap. Once reached, unread Postings show as unscreened. */
export interface BudgetInfo {
  /** Calendar month the spending counts towards (UTC), e.g. "2026-10". */
  month: string;
  capUsd: number;
  spentUsd: number;
  reached: boolean;
}

/** What a model call is for, as booked in the ledger. */
export type AiTask = "extraction" | WriterTask;

export interface AiCharge {
  task: AiTask;
  /** The caller's cautious estimate of the call's cost in USD (from the extractor's or writer's estimate). */
  estimateUsd: number;
  /** The Posting a read is for, booked with the spend. */
  postingId?: string;
}

export type BudgetOutcome<T> = { refused: true } | { refused: false; result: T };

export interface AiBudget {
  /** This month's spending against the cap. */
  info(): BudgetInfo;
  /**
   * Makes one billed model call within the cap. A call whose estimate would cross the cap is not
   * made (`refused`). The estimate is held against the cap from before the call until it is billed,
   * so calls that start together can't all fit under the cap at once.
   *
   * Books the call's `costUsd` (the estimate when that isn't a valid amount). When the call throws,
   * books the error's numeric `costUsd` if the failed call was still billed, then rethrows.
   */
  call<T extends { costUsd: number }>(charge: AiCharge, run: () => Promise<T>): Promise<BudgetOutcome<T>>;
}

export interface AiBudgetDeps {
  /** A database the engines' migrations have run on (the `ai_spend` ledger). */
  db: SqlDatabase;
  clock: Clock;
  /** Hard monthly cap in USD (AI_MONTHLY_CAP_USD). Unset or 0 means no AI spending. */
  capUsd?: number;
}

export function createAiBudget({ db, clock, capUsd }: AiBudgetDeps): AiBudget {
  const month = () => clock.now().toISOString().slice(0, 7);
  const spentThisMonth = () =>
    Number(db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_spend WHERE month = ?").get(month())?.s ?? 0);
  const cap = () => Math.max(0, capUsd ?? 0);
  /** Estimated cost of the calls running right now, held against the cap until each one is billed. */
  let reservedUsd = 0;
  /** The month in which a call was last refused because it would have crossed the cap. */
  let refusedInMonth: string | null = null;

  const book = (charge: AiCharge, costUsd: number) => {
    db.prepare("INSERT INTO ai_spend (at, month, task, posting_id, cost_usd) VALUES (?, ?, ?, ?, ?)").run(
      clock.now().toISOString(), month(), charge.task, charge.postingId ?? null, costUsd,
    );
  };

  return {
    info() {
      const spentUsd = Math.round(spentThisMonth() * 1e6) / 1e6;
      const capUsd = cap();
      return { month: month(), capUsd, spentUsd, reached: capUsd <= 0 || spentUsd >= capUsd || refusedInMonth === month() };
    },

    async call(charge, run) {
      const estimate = charge.estimateUsd;
      // Checked and reserved before the first await (see `call`).
      if (spentThisMonth() + reservedUsd + estimate > cap()) {
        refusedInMonth = month();
        return { refused: true };
      }
      reservedUsd += estimate;
      let result;
      try {
        result = await run();
      } catch (err) {
        reservedUsd -= estimate;
        const billed = (err as { costUsd?: unknown } | null)?.costUsd;
        if (typeof billed === "number" && billed > 0) book(charge, billed);
        throw err;
      }
      reservedUsd -= estimate;
      book(charge, Number.isFinite(result.costUsd) && result.costUsd >= 0 ? result.costUsd : estimate);
      return { refused: false, result };
    },
  };
}
