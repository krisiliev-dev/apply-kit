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
