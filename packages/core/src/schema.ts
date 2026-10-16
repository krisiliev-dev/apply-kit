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
  // #57: the coach interview (table coach_interview; `interview` is Track's job interviews). One interview per scope ("setup", or "angle:<angle>" for a thin angle):
  // the question it's on, whether it's paused or finished, and the last failure (with when it tries
  // again) or that it waits for the budget. Questions keep their topic (JSON) and how they ended
  // (answered, "I don't remember", skipped: skipped ones come back in packages). Turns are the
  // transcript; Kris's answer is saved before it's sent (sent = 0), so a timeout loses nothing.
  // Items are what the interview wrote (a piece, new or updated with its earlier version, or a
  // standard answer), each citing the turn it came from, until Kris finishes (settled_at).
  `CREATE TABLE coach_interview (
     id TEXT PRIMARY KEY,
     angle TEXT,
     current_key TEXT,
     paused_at TEXT,
     finished_at TEXT,
     failures INTEGER NOT NULL DEFAULT 0,
     error TEXT,
     retry_at TEXT,
     waits_for_budget INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE interview_question (
     interview_id TEXT NOT NULL,
     key TEXT NOT NULL,
     kind TEXT NOT NULL,
     topic TEXT NOT NULL,
     state TEXT NOT NULL,
     opened_at TEXT NOT NULL,
     ended_at TEXT,
     PRIMARY KEY (interview_id, key)
   );
   CREATE TABLE interview_turn (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     interview_id TEXT NOT NULL,
     question_key TEXT NOT NULL,
     who TEXT NOT NULL,
     text TEXT NOT NULL,
     sent INTEGER NOT NULL DEFAULT 1,
     at TEXT NOT NULL
   );
   CREATE TABLE interview_item (
     id TEXT PRIMARY KEY,
     interview_id TEXT NOT NULL,
     turn_id TEXT NOT NULL,
     type TEXT NOT NULL,
     piece_id TEXT,
     change TEXT,
     before TEXT,
     near TEXT,
     decision TEXT,
     answer TEXT,
     removed_at TEXT,
     settled_at TEXT,
     created_at TEXT NOT NULL
   );`,
  // #63: the package's CV version: the changes tailoring made to the master profile's CV (each
  // undoable), how it fits one page, and what the honesty validator caught.
  `ALTER TABLE package ADD COLUMN cv_version TEXT;`,
  // #64: pieces a package learned from Kris's answers to its gap questions: used only in that
  // package until Kris confirms them in Profile, with the question and her original answer.
  `CREATE TABLE package_piece (
     package_id TEXT NOT NULL REFERENCES package(id),
     piece_id TEXT NOT NULL,
     flag_id TEXT NOT NULL,
     question TEXT NOT NULL,
     answer TEXT NOT NULL,
     near TEXT,
     created_at TEXT NOT NULL
   );`,
  // #66: the package's screening answers (JSON): where the questions came from and each question's
  // answer with its origin (bank, adapted, new, needs you, translated).
  `ALTER TABLE package ADD COLUMN screening TEXT;`,
  // #65: the cover letter's drafts, kept and paged: what the writer wrote (null for one Kris writes
  // herself), the text as Kris edited it, the instruction it was asked with, the voice excerpts it
  // sent, and the voice edit recording Kris's changes to it. The package shows one draft at a time,
  // and keeps the letter's printed draft PDF.
  `CREATE TABLE package_letter (
     package_id TEXT NOT NULL REFERENCES package(id),
     number INTEGER NOT NULL,
     origin TEXT NOT NULL,
     instruction TEXT,
     written TEXT,
     content TEXT NOT NULL,
     excerpts TEXT NOT NULL DEFAULT '[]',
     voice_edit_id TEXT,
     cost_usd REAL NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     edited_at TEXT,
     PRIMARY KEY (package_id, number)
   );
   ALTER TABLE package ADD COLUMN letter_draft INTEGER;
   ALTER TABLE package ADD COLUMN letter_file TEXT;`,
  // #67: approving a package freezes it as a version: the files (by SHA-256, in packages/<id>/v<n>/)
  // and what Apply and Track read, as JSON that never changes. Editing a part afterwards reopens it
  // (approved_version back to NULL) and the next approval is the next version. A version is marked
  // submitted once, when Track records the submission. Failing ATS checks Kris accepted knowingly,
  // and contact facts she gave the ATS fix for this package only, sit on the package.
  `CREATE TABLE package_version (
     package_id TEXT NOT NULL REFERENCES package(id),
     version INTEGER NOT NULL,
     approved_at TEXT NOT NULL,
     snapshot TEXT NOT NULL,
     submitted_at TEXT,
     submitted_via TEXT,
     portal_url TEXT,
     PRIMARY KEY (package_id, version)
   );
   ALTER TABLE package ADD COLUMN approved_version INTEGER;
   ALTER TABLE package ADD COLUMN ats_accepted TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE package ADD COLUMN contact_fix TEXT;`,
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
  // Track #36: visits to Applications, for "Since your last visit". A visit lasts while the page is
  // opened again within 30 minutes; `since` is where the visit before it ended.
  `CREATE TABLE track_visit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     started_at TEXT NOT NULL,
     seen_at TEXT NOT NULL,
     since TEXT
   );`,
  // Track #32: a follow-up's draft from the Track assistant (kept once made, with the Master profile
  // origin of each number in it), and when what the user sent went to Prepare's voice as an edit
  // (once per follow-up; the voice itself is Prepare's, #59).
  `ALTER TABLE follow_up ADD COLUMN draft_text TEXT;
   ALTER TABLE follow_up ADD COLUMN draft_language TEXT;
   ALTER TABLE follow_up ADD COLUMN draft_numbers TEXT;
   ALTER TABLE follow_up ADD COLUMN draft_model TEXT;
   ALTER TABLE follow_up ADD COLUMN drafted_at TEXT;
   ALTER TABLE follow_up ADD COLUMN voice_edit_at TEXT;`,
  // Track #33: interviews (local time plus IANA time zone, with the instants beside them; the invite
  // email they were read from until edited), the details an invite's classification read, thank-you
  // notes and check-ins tied to an interview (a follow-up's `interview_id`; the topic the user gives),
  // and the prep sheet (built once per Application; practised marks and the user's own stories kept
  // in its questions).
  `CREATE TABLE interview (
     id TEXT PRIMARY KEY,
     application_id TEXT NOT NULL REFERENCES application(id),
     created_by TEXT NOT NULL REFERENCES application_event(id),
     start_local TEXT,
     end_local TEXT,
     time_zone TEXT NOT NULL,
     start_at TEXT,
     end_at TEXT,
     format TEXT,
     place TEXT,
     people TEXT NOT NULL DEFAULT '[]',
     round TEXT,
     notes TEXT,
     email_id TEXT,
     edited_at TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX interview_app ON interview(application_id);
   ALTER TABLE email_classification ADD COLUMN interview TEXT;
   ALTER TABLE follow_up ADD COLUMN interview_id TEXT REFERENCES interview(id);
   ALTER TABLE follow_up ADD COLUMN topic TEXT NOT NULL DEFAULT '';
   ALTER TABLE application_event ADD COLUMN interview_id TEXT;
   CREATE TABLE prep_sheet (
     application_id TEXT PRIMARY KEY REFERENCES application(id),
     facts TEXT NOT NULL,
     questions TEXT NOT NULL,
     model TEXT,
     built_at TEXT NOT NULL
   );`,
  // Track #34: offers and closing. A withdrawal is a follow-up on another open Application, offered
  // by the Event that accepted an offer (`accepted_by`); it stands while that Event does. A Status
  // Event may carry a reason ("declined offer"). Offer details are pre-filled from the offer email
  // (its reading keeps them) until the user saves their own; a rejection keeps an optional lesson and
  // likely reason.
  `ALTER TABLE follow_up ADD COLUMN accepted_by TEXT REFERENCES application_event(id);
   ALTER TABLE application_event ADD COLUMN reason TEXT;
   ALTER TABLE email_classification ADD COLUMN offer TEXT;
   CREATE TABLE offer_details (
     application_id TEXT PRIMARY KEY REFERENCES application(id),
     base_salary TEXT,
     start_date TEXT,
     work_pattern TEXT,
     contract TEXT,
     other TEXT,
     from_email TEXT,
     saved_by TEXT NOT NULL,
     saved_at TEXT NOT NULL
   );
   CREATE TABLE rejection_note (
     application_id TEXT PRIMARY KEY REFERENCES application(id),
     lesson TEXT,
     reason TEXT,
     saved_at TEXT NOT NULL
   );`,
  // #68: switching a package's language keeps the drafts and decisions it had in the language it
  // leaves (the CV version, the screening answers, the letter draft shown and the parts' states, as
  // JSON), so switching back brings them back without the model. Each letter draft knows its language.
  `CREATE TABLE package_language (
     package_id TEXT NOT NULL REFERENCES package(id),
     language TEXT NOT NULL,
     state TEXT NOT NULL,
     kept_at TEXT NOT NULL,
     PRIMARY KEY (package_id, language)
   );
   ALTER TABLE package_letter ADD COLUMN language TEXT;`,
  // Apply #38: a fill session ties a browser tab's application to one approved package (the tab
  // keeps only the session id). Each page filled is recorded with its counts and, per field, the
  // label, kind, outcome and source: never a value.
  `CREATE TABLE fill_session (
     id TEXT PRIMARY KEY,
     package_id TEXT NOT NULL,
     portal TEXT NOT NULL,
     host TEXT NOT NULL,
     job_ref TEXT,
     started_at TEXT NOT NULL,
     ended_at TEXT,
     end_reason TEXT
   );
   CREATE TABLE fill_page (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT NOT NULL REFERENCES fill_session(id),
     step_label TEXT,
     page_kind TEXT NOT NULL,
     filled_at TEXT NOT NULL,
     counts TEXT NOT NULL,
     fields TEXT NOT NULL
   );`,
  // Apply #41: "Mark as submitted" creates the Application through the tracker's record submission
  // (which Track #35 extends): the package it was made from (package_id, portal_url, already there),
  // the portal, when it was submitted and how ("extension" or "app").
  `ALTER TABLE application ADD COLUMN portal TEXT;
   ALTER TABLE application ADD COLUMN submitted_at TEXT;
   ALTER TABLE application ADD COLUMN submitted_via TEXT;
   CREATE INDEX application_package ON application(package_id);`,
  // Apply #48: "Report this field" keeps a portal field's structure (tag, type, role, attributes,
  // label chain, options, as JSON) with the portal, host and path (never the query) and step label:
  // never a value. Settings › Extension lists them with Copy as fixture and Delete.
  `CREATE TABLE field_report (
     id TEXT PRIMARY KEY,
     portal TEXT NOT NULL,
     host TEXT NOT NULL,
     path TEXT NOT NULL,
     step_label TEXT,
     field TEXT NOT NULL,
     created_at TEXT NOT NULL
   );`,
  // Apply #42: answers Kris typed on the portal into needs-you or empty fields, kept pending in the
  // fill session until he saves them to the answer bank (or marks as submitted) or declines them.
  `CREATE TABLE fill_pending_answer (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT NOT NULL REFERENCES fill_session(id),
     question TEXT NOT NULL,
     answer TEXT NOT NULL,
     kind TEXT NOT NULL,
     created_at TEXT NOT NULL
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
