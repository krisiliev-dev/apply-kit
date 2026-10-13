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
  // #8: pausing and removing Sources. Removal is a soft delete, so its Postings keep their Source
  // and undoing the removal (the Decision that closed its Jobs) brings it back.
  `ALTER TABLE source ADD COLUMN paused_at TEXT;
   ALTER TABLE source ADD COLUMN removed_at TEXT;
   ALTER TABLE source ADD COLUMN removed_decision_id TEXT;`,
  // #12: dealbreakers. Kris's search settings as saved from the settings form (one row; none means
  // the defaults). A Job Kris chose to show despite a dealbreaker ("Show this job") is remembered
  // with the Decision that showed it, so undo hides it again. "Not a dealbreaker for me" changes a
  // rule and is kept as a record of what changed, from which Job, so it can be listed and undone.
  `CREATE TABLE search_settings (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE job_unhidden (
     job_id TEXT PRIMARY KEY REFERENCES job(id),
     decision_id TEXT NOT NULL REFERENCES decision(id),
     unhidden_at TEXT NOT NULL
   );
   CREATE TABLE rule_change (
     id TEXT PRIMARY KEY,
     job_id TEXT NOT NULL REFERENCES job(id),
     rule TEXT NOT NULL,
     reason_key TEXT NOT NULL,
     reason_text TEXT NOT NULL,
     change_text TEXT NOT NULL,
     before_value TEXT NOT NULL,
     after_value TEXT NOT NULL,
     created_at TEXT NOT NULL,
     undone_at TEXT
   );`,
  // #16: closing rules. A Posting its Source no longer lists is gone (when, and the Decision that
  // marked it, so undoing that Decision brings it back). A Check far below the Source's normal volume
  // is unusual: nothing is marked gone. Kris confirming an unusual drop is remembered until undone.
  `ALTER TABLE posting ADD COLUMN gone_at TEXT;
   ALTER TABLE posting ADD COLUMN gone_decision_id TEXT;
   ALTER TABLE source_check ADD COLUMN unusual INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE drop_confirmation (
     decision_id TEXT PRIMARY KEY REFERENCES decision(id),
     source_id TEXT NOT NULL REFERENCES source(id),
     check_id INTEGER NOT NULL REFERENCES source_check(id),
     confirmed_at TEXT NOT NULL,
     undone_at TEXT
   );
   CREATE INDEX drop_confirmation_source ON drop_confirmation(source_id);`,
  // #20: coverage checks. Each manual search Kris recorded (site, words, location, how many results he
  // saw) and every listing he gave, with what it was when checked: found (and as which Job) or
  // missing, with the reason and fixes offered then.
  `CREATE TABLE coverage_check (
     id TEXT PRIMARY KEY,
     checked_at TEXT NOT NULL,
     site TEXT NOT NULL,
     query TEXT NOT NULL,
     location TEXT,
     result_count INTEGER NOT NULL,
     app_had INTEGER NOT NULL
   );
   CREATE INDEX coverage_check_at ON coverage_check(checked_at);
   CREATE TABLE coverage_listing (
     check_id TEXT NOT NULL REFERENCES coverage_check(id),
     position INTEGER NOT NULL,
     title TEXT NOT NULL,
     company TEXT NOT NULL,
     location TEXT,
     url TEXT,
     status TEXT NOT NULL,
     job_id TEXT,
     reason TEXT,
     PRIMARY KEY (check_id, position)
   );`,
  // #15: learned ranking adjustments, created only when Kris opts in (a pass reason with the box
  // ticked, "Show this job" with the box ticked, or a boost). `matcher` (JSON) says which Jobs it
  // moves; `points` is added to their Fit. Kept after undo (undone_at) so the list can say so.
  `CREATE TABLE learned_adjustment (
     id TEXT PRIMARY KEY,
     origin TEXT NOT NULL,
     matcher TEXT NOT NULL,
     points REAL NOT NULL,
     job_id TEXT NOT NULL REFERENCES job(id),
     decision_id TEXT REFERENCES decision(id),
     pass_reason TEXT,
     created_at TEXT NOT NULL,
     undone_at TEXT
   );`,
  // #19: the Chrome extension, paired once. The code the app shows while Kris pairs (one at a time),
  // and each paired extension with a hash of its token (the token itself is never stored).
  `CREATE TABLE pairing_code (
     code TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     wrong_tries INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE extension_device (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     paired_at TEXT NOT NULL,
     last_used_at TEXT NOT NULL
   );`,
  // Review fixes: each Posting's link key (see capture/links.ts linkKey), indexed, so a link is found
  // by lookup instead of re-reading every Posting's link. Filled for older Postings on start (backfillLinkKeys).
  `ALTER TABLE posting ADD COLUMN link_key TEXT;
   CREATE INDEX posting_link_key ON posting(link_key);`,
  // #25: the mail store (ADR 0004). Every email in the job mailbox once, by Message-ID, read once per
  // check and shared by Discover's alert Sources and Track. Recipients, thread headers and attachment
  // names (never contents) are kept as JSON lists. A read records the time it looked back to, so the
  // next one starts from the last good read that filled the store, minus a day.
  `CREATE TABLE mail_message (
     id TEXT PRIMARY KEY,
     from_header TEXT NOT NULL,
     to_list TEXT NOT NULL,
     cc_list TEXT NOT NULL,
     subject TEXT NOT NULL,
     received_at TEXT NOT NULL,
     html TEXT NOT NULL,
     text TEXT NOT NULL,
     in_reply_to TEXT,
     reference_list TEXT NOT NULL,
     attachments TEXT NOT NULL,
     stored_at TEXT NOT NULL
   );
   CREATE INDEX mail_message_received ON mail_message(received_at);
   ALTER TABLE mailbox_read ADD COLUMN since TEXT;`,
  // Track #26: Applications (owned by the tracker), their append-only Events (each with its cause;
  // undo marks an Event undone and records the reversal as its own Event), and the addresses or
  // domains whose mail belongs to each. `job_id` is null only for one added by hand without a Job.
  `CREATE TABLE application (
     id TEXT PRIMARY KEY,
     job_id TEXT REFERENCES job(id),
     company TEXT NOT NULL,
     title TEXT NOT NULL,
     status TEXT NOT NULL,
     applied_on TEXT NOT NULL,
     created_how TEXT NOT NULL,
     created_at TEXT NOT NULL,
     posting_url TEXT,
     portal_url TEXT,
     package_id TEXT,
     angle TEXT,
     source TEXT NOT NULL,
     cv_version TEXT,
     language TEXT,
     removed_at TEXT
   );
   CREATE INDEX application_job ON application(job_id);
   CREATE TABLE application_event (
     id TEXT PRIMARY KEY,
     application_id TEXT NOT NULL REFERENCES application(id),
     at TEXT NOT NULL,
     kind TEXT NOT NULL,
     cause TEXT NOT NULL,
     from_status TEXT,
     to_status TEXT,
     text TEXT NOT NULL,
     undoes TEXT REFERENCES application_event(id),
     undone_at TEXT
   );
   CREATE INDEX application_event_app ON application_event(application_id);
   CREATE TABLE application_contact (
     application_id TEXT NOT NULL REFERENCES application(id),
     value TEXT NOT NULL,
     kind TEXT NOT NULL,
     added_at TEXT NOT NULL,
     PRIMARY KEY (application_id, value)
   );`,
  // Track #27: the CV attached to an Application added by hand (no Package), kept locally as sent.
  // Its label is the Application's CV version (application.cv_version).
  `CREATE TABLE application_cv (
     application_id TEXT PRIMARY KEY REFERENCES application(id),
     file_name TEXT NOT NULL,
     label TEXT NOT NULL,
     bytes BLOB NOT NULL,
     attached_at TEXT NOT NULL
   );`,
  // Track #29: follow-ups. One per stage of an Application, tied to the Event that began the stage
  // (`started_by`), so a Status change leaves it behind and undoing that change brings it back. Its
  // state (sent, skipped, snoozed) comes from the Events that name it (`follow_up_id`; a snooze keeps
  // the day in `due_on`). The text is kept as the user types it. The delays are settings (one row).
  `CREATE TABLE follow_up (
     id TEXT PRIMARY KEY,
     application_id TEXT NOT NULL REFERENCES application(id),
     kind TEXT NOT NULL,
     stage TEXT NOT NULL,
     started_by TEXT NOT NULL REFERENCES application_event(id),
     anchor_on TEXT NOT NULL,
     text TEXT NOT NULL DEFAULT '',
     text_saved_at TEXT,
     created_at TEXT NOT NULL,
     UNIQUE (started_by, kind)
   );
   CREATE INDEX follow_up_app ON follow_up(application_id);
   ALTER TABLE application_event ADD COLUMN follow_up_id TEXT REFERENCES follow_up(id);
   ALTER TABLE application_event ADD COLUMN due_on TEXT;
   CREATE TABLE track_settings (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // Track #31: email matching. Each stored email is classified once (by the Track assistant, by rules
  // when the AI budget is out, or not at all) and decided once: matched to an Application (with the
  // signals it matched on), waiting as "Email to match" (with the candidates and why), not about an
  // application, or left alone (job alerts, the user's own sent copies, unrelated mail). The user's
  // answers become sender rules (an address, or a domain that isn't a shared mail provider; a null
  // Application means "not about an application"). An Event caused by an email names it.
  `CREATE TABLE email_classification (
     email_id TEXT PRIMARY KEY REFERENCES mail_message(id),
     by TEXT NOT NULL,
     kind TEXT,
     confidence REAL,
     company TEXT,
     job_title TEXT,
     stage TEXT,
     language TEXT,
     summary TEXT,
     model TEXT,
     classified_at TEXT NOT NULL
   );
   CREATE TABLE email_match (
     email_id TEXT PRIMARY KEY REFERENCES mail_message(id),
     state TEXT NOT NULL,
     application_id TEXT REFERENCES application(id),
     signals TEXT NOT NULL DEFAULT '[]',
     candidates TEXT NOT NULL DEFAULT '[]',
     reason TEXT,
     how TEXT,
     decided_at TEXT NOT NULL,
     confirmed_at TEXT
   );
   CREATE INDEX email_match_state ON email_match(state);
   CREATE TABLE sender_rule (
     sender TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     application_id TEXT REFERENCES application(id),
     created_at TEXT NOT NULL
   );
   ALTER TABLE application_event ADD COLUMN email_id TEXT;
   ALTER TABLE application_event ADD COLUMN email_kind TEXT;`,
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
