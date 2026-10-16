import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openSpendLedger } from "./ledger.ts";

const october = () => new Date("2026-10-12T09:30:00Z");

function serviceDb() {
  const path = join(mkdtempSync(join(tmpdir(), "apply-kit-ledger-")), "apply-kit.db");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE ai_spend (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, month TEXT NOT NULL, task TEXT NOT NULL, posting_id TEXT, cost_usd REAL NOT NULL)");
  db.prepare("INSERT INTO ai_spend (at, month, task, posting_id, cost_usd) VALUES (?, ?, 'extraction', 'p1', ?)").run("2026-10-01T10:00:00Z", "2026-10", 1.25);
  db.prepare("INSERT INTO ai_spend (at, month, task, posting_id, cost_usd) VALUES (?, ?, 'extraction', 'p2', ?)").run("2026-09-30T10:00:00Z", "2026-09", 4);
  db.close();
  return path;
}

describe("the evaluation's spending ledger", () => {
  it("counts this month's spending by the service and books evaluation reads into the same ledger", () => {
    const path = serviceDb();
    const ledger = openSpendLedger(path, october);

    expect(ledger.spentThisMonthUsd()).toBeCloseTo(1.25);
    ledger.record(0.002);
    expect(ledger.spentThisMonthUsd()).toBeCloseTo(1.252);
    ledger.close();

    const db = new DatabaseSync(path);
    expect(db.prepare("SELECT task, posting_id, month FROM ai_spend WHERE cost_usd = 0.002").get()).toEqual({ task: "evaluation", posting_id: null, month: "2026-10" });
    db.close();
  });

  it("refuses to spend before the service has created its persistent ledger", () => {
    const path = join(mkdtempSync(join(tmpdir(), "apply-kit-ledger-")), "apply-kit.db");
    expect(() => openSpendLedger(path, october)).toThrow("Start apply-kit once");
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a database without a spending table", () => {
    const path = join(mkdtempSync(join(tmpdir(), "apply-kit-ledger-")), "apply-kit.db");
    new DatabaseSync(path).close();
    expect(() => openSpendLedger(path, october)).toThrow("Start apply-kit once");
  });
});
