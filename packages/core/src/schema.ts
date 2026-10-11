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
  // #9: merging Postings into Jobs. Each Posting carries its match key (normalised company and title)
  // and why it joined its Job. A Job merged into another keeps its row (state and decisions intact)
  // and points at the Job that absorbed it, so a split can bring it back. Kris's chosen target
  // posting is kept on the Job; splits are remembered as pairs of Postings that never merge again.
  `ALTER TABLE posting ADD COLUMN match_key TEXT;
   ALTER TABLE posting ADD COLUMN merge_reason TEXT;
   CREATE INDEX posting_match ON posting(match_key);
   CREATE INDEX posting_url ON posting(url);
   ALTER TABLE job ADD COLUMN merged_into TEXT REFERENCES job(id);
   ALTER TABLE job ADD COLUMN target_posting_id TEXT REFERENCES posting(id);
   CREATE TABLE posting_split (
     a TEXT NOT NULL REFERENCES posting(id),
     b TEXT NOT NULL REFERENCES posting(id),
     created_at TEXT NOT NULL,
     PRIMARY KEY (a, b)
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
