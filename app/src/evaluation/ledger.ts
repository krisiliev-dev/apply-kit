// The evaluation spends from the same monthly AI budget as the service: it reads what the service
// has spent this month from its database and books each evaluation read there (task "evaluation"),
// so the service's own cap check counts it too.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SpendLedger } from "./cli.ts";

/** Calendar month (UTC) the spending counts towards, as the engine keys it, e.g. "2026-10". */
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export function openSpendLedger(dbPath: string, now: () => Date = () => new Date()): SpendLedger {
  const unavailable = () => new Error("Start apply-kit once before running an evaluation, so spending is recorded in its persistent monthly ledger.");
  if (!existsSync(dbPath)) throw unavailable();
  const db = new DatabaseSync(dbPath);
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_spend'").get()) {
    db.close();
    throw unavailable();
  }
  db.exec("PRAGMA busy_timeout = 5000");
  return {
    spentThisMonthUsd() {
      return Number(db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_spend WHERE month = ?").get(monthOf(now()))?.s ?? 0);
    },
    record(costUsd) {
      db.prepare("INSERT INTO ai_spend (at, month, task, posting_id, cost_usd) VALUES (?, ?, 'evaluation', NULL, ?)")
        .run(now().toISOString(), monthOf(now()), costUsd);
    },
    close() {
      db.close();
    },
  };
}
