import type { SqlDatabase } from "./ports.ts";

// Ordered, append-only migrations. Each runs once; PRAGMA user_version records how many ran.
// Never edit a shipped migration: add a new one.
const migrations: string[] = [
  `CREATE TABLE source (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE job (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     company TEXT NOT NULL,
     state TEXT NOT NULL DEFAULT 'new',
     created_at TEXT NOT NULL
   );`,
  // #3: Source config, and Postings tied to their Source with a stable (source, external id) identity.
  `ALTER TABLE source ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
   CREATE TABLE posting (
     id TEXT PRIMARY KEY,
     source_id TEXT NOT NULL REFERENCES source(id),
     external_id TEXT NOT NULL,
     job_id TEXT NOT NULL REFERENCES job(id),
     url TEXT NOT NULL,
     title TEXT NOT NULL,
     company TEXT NOT NULL,
     location TEXT,
     salary TEXT,
     posted_at TEXT,
     description_html TEXT,
     first_seen_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     UNIQUE (source_id, external_id)
   );
   CREATE INDEX posting_job ON posting(job_id);`,
  // #10: reading postings. One extraction per Posting (re-read when its text changes), the AI
  // spending ledger the monthly cap is checked against, and Kris's answers to low-confidence facts.
  `CREATE TABLE extraction (
     posting_id TEXT PRIMARY KEY REFERENCES posting(id),
     text_hash TEXT NOT NULL,
     status TEXT NOT NULL,
     facts TEXT,
     model TEXT,
     error TEXT,
     attempts INTEGER NOT NULL DEFAULT 1,
     read_at TEXT NOT NULL
   );
   CREATE TABLE ai_spend (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     month TEXT NOT NULL,
     task TEXT NOT NULL,
     posting_id TEXT,
     cost_usd REAL NOT NULL
   );
   CREATE INDEX ai_spend_month ON ai_spend(month);
   CREATE TABLE fact_confirmation (
     posting_id TEXT NOT NULL REFERENCES posting(id),
     fact_key TEXT NOT NULL,
     choice TEXT NOT NULL,
     confirmed_at TEXT NOT NULL,
     PRIMARY KEY (posting_id, fact_key)
   );`,
];

export function migrate(db: SqlDatabase): void {
  const row = db.prepare("PRAGMA user_version").get();
  const current = Number(row?.user_version ?? 0);
  for (let i = current; i < migrations.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(migrations[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
