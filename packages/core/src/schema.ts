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
  // #4: every Check of a Source (time, outcome, count in Kris's locations, total), kept as history.
  `CREATE TABLE source_check (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     source_id TEXT NOT NULL REFERENCES source(id),
     checked_at TEXT NOT NULL,
     outcome TEXT NOT NULL,
     in_locations INTEGER,
     total INTEGER,
     error TEXT
   );
   CREATE INDEX source_check_source ON source_check(source_id, checked_at);`,
  // #17: alert emails each email Source received (by Message-ID, so a re-delivered copy is one row),
  // for its usual rhythm; and every read of the job mailbox, for mailbox errors on Sources.
  `CREATE TABLE alert_email (
     source_id TEXT NOT NULL REFERENCES source(id),
     email_id TEXT NOT NULL,
     received_at TEXT NOT NULL,
     subject TEXT NOT NULL,
     postings INTEGER NOT NULL,
     PRIMARY KEY (source_id, email_id)
   );
   CREATE INDEX alert_email_received ON alert_email(source_id, received_at);
   CREATE TABLE mailbox_read (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     read_at TEXT NOT NULL,
     outcome TEXT NOT NULL,
     reason TEXT,
     error TEXT,
     emails INTEGER
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
