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
  // #14: triage. A Job's state carries when it last changed and why (pass reason and note, how it
  // closed). Each save, pass, close or reopen is a Decision that remembers every Job's previous
  // state, so it can be undone, per Job.
  `ALTER TABLE job ADD COLUMN state_changed_at TEXT;
   ALTER TABLE job ADD COLUMN pass_reason TEXT;
   ALTER TABLE job ADD COLUMN pass_note TEXT;
   ALTER TABLE job ADD COLUMN closed_how TEXT;
   CREATE TABLE decision (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE decision_job (
     decision_id TEXT NOT NULL REFERENCES decision(id),
     job_id TEXT NOT NULL REFERENCES job(id),
     prev_state TEXT NOT NULL,
     prev_changed_at TEXT,
     prev_pass_reason TEXT,
     prev_pass_note TEXT,
     prev_closed_how TEXT,
     undone_at TEXT,
     PRIMARY KEY (decision_id, job_id)
   );
   CREATE INDEX decision_job_job ON decision_job(job_id);`,
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
