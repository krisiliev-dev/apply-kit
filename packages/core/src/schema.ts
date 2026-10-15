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
  // #53: the master profile (ADR 0003). Each profile piece with its tags and angles (JSON lists), the
  // role or education entry it belongs to, where a number in it comes from, its status and its source
  // (the file or conversation it came from and the quote, kept word for word). `entry` (JSON) holds a
  // role's or education's title, organisation, city and months. Contact details are one row (JSON),
  // with the optional photo kept in the file store under its SHA-256.
  `CREATE TABLE profile_piece (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     text TEXT NOT NULL,
     entry TEXT,
     belongs_to TEXT,
     tags TEXT NOT NULL,
     angles TEXT NOT NULL,
     number_source TEXT,
     status TEXT NOT NULL,
     source_from TEXT NOT NULL,
     source_quote TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX profile_piece_belongs_to ON profile_piece(belongs_to);
   CREATE TABLE profile_contact (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     details TEXT NOT NULL,
     photo_sha256 TEXT,
     photo_name TEXT,
     photo_size INTEGER,
     updated_at TEXT NOT NULL
   );`,
  // #58: angles. Kris's summary line per angle and the pieces that lead it, in order (a JSON list of
  // piece ids; NULL until he orders them, which means the default order). No row means neither is set.
  `CREATE TABLE angle (
     angle TEXT PRIMARY KEY,
     summary TEXT NOT NULL,
     leads TEXT,
     updated_at TEXT NOT NULL
   );`,
  // #56: the answer bank. Each answer with its wordings and per-language versions (JSON), its
  // category (standard or screening), kind, fill mode, rule (JSON), source (JSON), use count and last
  // use, and a portal edit waiting for "keep new or old" (JSON). Its history is one row per change (JSON:
  // what happened, where, and the text before and after).
  // `answer_seed` remembers which default answers were added (and the value they were added with),
  // so a deleted default isn't added again and an unedited one follows the contact details.
  `CREATE TABLE answer (
     id TEXT PRIMARY KEY,
     question TEXT NOT NULL,
     wordings TEXT NOT NULL,
     versions TEXT NOT NULL,
     category TEXT NOT NULL,
     kind TEXT NOT NULL,
     mode TEXT NOT NULL,
     rule TEXT,
     source TEXT NOT NULL,
     use_count INTEGER NOT NULL DEFAULT 0,
     last_used_at TEXT,
     portal_edit TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE answer_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     answer_id TEXT NOT NULL,
     at TEXT NOT NULL,
     detail TEXT NOT NULL
   );
   CREATE INDEX answer_history_answer ON answer_history(answer_id);
   CREATE TABLE answer_seed (
     key TEXT PRIMARY KEY,
     answer_id TEXT NOT NULL,
     value TEXT NOT NULL
   );`,
  // #54: imports. A run holds its sources in order (files, the LinkedIn export, GitHub, a portfolio),
  // each with its state, the text extracted from it (ADR 0003: the file itself is in the file store
  // under its SHA-256), why it couldn't be read and what Kris chose, and how many pieces it gave.
  // Merges record each source that said the same as a piece already there, so they can be shown.
  // Pieces read by text recognition are marked "check this" until confirmed.
  `CREATE TABLE import_run (
     id TEXT PRIMARY KEY,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     cancelled_at TEXT
   );
   CREATE TABLE import_item (
     id TEXT PRIMARY KEY,
     import_id TEXT NOT NULL REFERENCES import_run(id),
     position INTEGER NOT NULL,
     source TEXT NOT NULL,
     name TEXT NOT NULL,
     type TEXT NOT NULL,
     sha256 TEXT,
     size INTEGER,
     link TEXT,
     state TEXT NOT NULL,
     problem TEXT,
     waiting_for TEXT,
     detail TEXT,
     text TEXT,
     recognised INTEGER NOT NULL DEFAULT 0,
     pieces INTEGER NOT NULL DEFAULT 0,
     merged INTEGER NOT NULL DEFAULT 0,
     estimate_usd REAL,
     started_at TEXT,
     finished_at TEXT
   );
   CREATE INDEX import_item_import ON import_item(import_id, position);
   CREATE TABLE import_merge (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     import_id TEXT NOT NULL,
     item_id TEXT NOT NULL,
     piece_id TEXT NOT NULL,
     source_from TEXT NOT NULL,
     source_quote TEXT,
     text TEXT NOT NULL,
     at TEXT NOT NULL
   );
   CREATE INDEX import_merge_piece ON import_merge(piece_id);
   ALTER TABLE profile_piece ADD COLUMN check_this INTEGER NOT NULL DEFAULT 0;`,
  // #59: voice. Samples keep their text here (the file itself is in the file store under its
  // SHA-256) and how far learning has read them; rules keep their evidence, and a removed rule stays
  // (with when) so it doesn't come back unless new writing shows it. Edits to drafts are before/after
  // pairs, learned from once. Every voice excerpt sent to the model is recorded per call.
  `CREATE TABLE voice_sample (
     id TEXT PRIMARY KEY,
     position INTEGER NOT NULL,
     file_name TEXT NOT NULL,
     sha256 TEXT NOT NULL,
     size INTEGER NOT NULL,
     kind TEXT NOT NULL,
     language TEXT,
     words INTEGER NOT NULL DEFAULT 0,
     text TEXT,
     problem TEXT,
     learned_chunks INTEGER NOT NULL DEFAULT 0,
     added_at TEXT NOT NULL
   );
   CREATE TABLE voice_rule (
     id TEXT PRIMARY KEY,
     key TEXT NOT NULL UNIQUE,
     text TEXT NOT NULL,
     evidence TEXT NOT NULL,
     language TEXT,
     samples TEXT NOT NULL DEFAULT '[]',
     edits INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     removed_at TEXT
   );
   CREATE TABLE voice_edit (
     id TEXT PRIMARY KEY,
     at TEXT NOT NULL,
     draft TEXT NOT NULL,
     language TEXT NOT NULL,
     source TEXT,
     before TEXT NOT NULL,
     after TEXT NOT NULL,
     learned_at TEXT
   );
   CREATE TABLE voice_send (
     id TEXT PRIMARY KEY,
     at TEXT NOT NULL,
     purpose TEXT NOT NULL,
     language TEXT,
     excerpts TEXT NOT NULL,
     words INTEGER NOT NULL
   );
   CREATE TABLE voice_settings (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     learn_from_edits INTEGER NOT NULL DEFAULT 1
   );`,
  // #62: packages, one per Job. `job` (JSON) is the Job as it was when the package started (title,
  // company, requirements, postings), so the package reads the same however Discover changes later.
  // `approved` (JSON) maps each approved step to when, `reviewed_at` is Kris's first approval; `cv_draft` (JSON) is the CV's current draft file.
  // Each part (target, cv, letter, answers, ats) has a row with its state, attempts, error, cost and output.
  `CREATE TABLE package (
     id TEXT PRIMARY KEY,
     job_id TEXT NOT NULL UNIQUE,
     job TEXT NOT NULL,
     angle TEXT NOT NULL,
     angle_reason TEXT NOT NULL,
     language TEXT NOT NULL,
     target_posting_id TEXT NOT NULL,
     photo INTEGER NOT NULL DEFAULT 0,
     approved TEXT NOT NULL DEFAULT '{}',
     reviewed_at TEXT,
     cv_draft TEXT,
     started_at TEXT NOT NULL,
     stopped_at TEXT
   );
   CREATE TABLE package_part (
     package_id TEXT NOT NULL REFERENCES package(id),
     part TEXT NOT NULL,
     state TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     error TEXT,
     cost_usd REAL NOT NULL DEFAULT 0,
     output TEXT,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (package_id, part)
   );`,
  // Setup (#55): sources that disagree about a piece, discarded pieces (restorable), and where Kris is in setup.
  `ALTER TABLE profile_piece ADD COLUMN dispute TEXT;
   ALTER TABLE profile_piece ADD COLUMN discarded_at TEXT;
   CREATE TABLE setup_progress (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     step TEXT NOT NULL,
     skipped INTEGER NOT NULL DEFAULT 0,
     started_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     finished_at TEXT
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
