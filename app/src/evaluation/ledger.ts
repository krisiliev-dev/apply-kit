// The evaluation spends from the same monthly AI budget as the service: it reads what the service
// has spent this month from its database and books each evaluation read there (task "evaluation"),
// so the service's own cap check counts it too.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SpendLedger } from "./cli.ts";

/** Calendar month (UTC) the spending counts towards, as the engine keys it, e.g. "2026-10". */
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export function openSpendLedger(dbPath: string, now: () => Date = () => new Date()): SpendLedger {
  // No service database (or one from before reading postings existed): count this run on its own.
  const db = existsSync(dbPath) ? new DatabaseSync(dbPath) : null;
  const shared = db?.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_spend'").get() != null;
  if (db && !shared) db.close();
  // The service may be writing at the same time: wait for its lock rather than fail.
  if (shared) db!.exec("PRAGMA busy_timeout = 5000");
  let ownUsd = 0;
  return {
    spentThisMonthUsd() {
      if (!shared) return ownUsd;
      return Number(db!.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_spend WHERE month = ?").get(monthOf(now()))?.s ?? 0);
    },
    record(costUsd) {
      if (!shared) { ownUsd += costUsd; return; }
      db!.prepare("INSERT INTO ai_spend (at, month, task, posting_id, cost_usd) VALUES (?, ?, 'evaluation', NULL, ?)")
        .run(now().toISOString(), monthOf(now()), costUsd);
    },
    close() {
      if (shared) db!.close();
    },
  };
}
