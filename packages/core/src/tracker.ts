// The tracker: Track's own module beside the discovery engine, sharing its database and clock. It
// owns the Application (GLOSSARY "After applying"): created by hand or with "I applied" on a Job,
// listed grouped by Status, and moved only through Events that each name their cause. Events are
// append-only: undo marks an Event undone and records the reversal as an Event of its own.
//
// Its public interface below is the testing seam (test/tracker.test.ts).
import { randomUUID } from "node:crypto";
import type { DiscoveryEngine } from "./engine.ts";
import type { Angle } from "./fit/angles.ts";
import {
  addDays, bannedPhrases, checkDraft, daysBetween, defaultFollowUpSettings, draftWords, outlineOf, parseFollowUpSettings,
  type DraftInput, type FollowUp, type FollowUpDraftText, type FollowUpKind, type FollowUpSettings, type MasterProfile, type VoiceSamples,
} from "./follow-ups.ts";
import { normaliseCompany } from "./matching.ts";
import { liveJobId } from "./merging.ts";
import { mailboxFix, type MailboxProblem } from "./mailbox.ts";
import { storedMessage } from "./mail-store.ts";
import type { Clock, MailAttachment, MailMessage, SqlDatabase } from "./ports.ts";
import { migrate } from "./schema.ts";
import { computeStats, type TrackStats } from "./track-stats.ts";
import {
  baseDomain, classifyInput, draftOutputSchema, companyDomainMatches, domainOf, emailClassificationSchema, emailKindName, highConfidence, hostOf,
  isAtsDomain, isBoardDomain, isJobAlert, isSharedProvider, namesCompany, namesTitle, quoteOf, replyKinds, ruleClassify, senderOf,
  type EmailClassification, type EmailKind, type TrackAssistant,
} from "./track-mail.ts";

export const statuses = ["applied", "screening", "interviewing", "offer", "accepted", "rejected", "withdrawn"] as const;
/** Where an Application stands. Rejected and withdrawn are closed. */
export type Status = (typeof statuses)[number];
export const closedStatuses: readonly Status[] = ["rejected", "withdrawn"];
export const isClosed = (s: Status) => closedStatuses.includes(s);

/** Who or what caused an Event: a matched email, the user, or apply-kit itself. */
export type EventCause = "email" | "you" | "apply-kit";
/** How an Application came to be. "submission" comes with Apply. */
export type CreatedHow = "submission" | "i-applied" | "by-hand" | "from-email";

export interface ApplicationEvent {
  id: string;
  applicationId: string;
  at: string;
  /**
   * created: the Application was added. status: its Status changed. note: the user wrote a note.
   * cv: the user attached the CV they sent. email: an email was matched here (and, when `to` is
   * set, moved the Status). undo: an earlier Event was undone. follow-up-sent, follow-up-skipped,
   * follow-up-snoozed: what the user did with a follow-up (`followUpId`).
   */
  kind: "created" | "status" | "note" | "cv" | "email" | "undo" | FollowUpEventKind;
  cause: EventCause;
  /** For a Status change (and its undo): the Status before and after. */
  from: Status | null;
  to: Status | null;
  /** What happened, in plain words ("Moved to Screening"). */
  text: string;
  /** For an undo: the Event it undid. */
  undoes: string | null;
  /** When this Event was undone, or null. */
  undoneAt: string | null;
  /** For an email Event: the email's Message-ID and its kind (null when it couldn't be read). */
  emailId: string | null;
  emailKind: EmailKind | null;
  /** For what was done with a follow-up: which one. */
  followUpId: string | null;
}

export type FollowUpEventKind = "follow-up-sent" | "follow-up-skipped" | "follow-up-snoozed";
const followUpEventKinds: readonly string[] = ["follow-up-sent", "follow-up-skipped", "follow-up-snoozed"];

/**
 * What comes next for an Application, for the list's Next column: its follow-up (due now or on a
 * day), or, once its nudge was sent or skipped, how long it has been quiet. Null when nothing is.
 */
export type NextUp =
  | { kind: "follow-up"; followUpKind: FollowUpKind; dueOn: string; due: boolean }
  | { kind: "no-reply"; days: number }
  | null;

/** One Application as the list shows it. */
export interface ApplicationSummary {
  id: string;
  /** The Job it was made for, or null when added by hand without a Job in apply-kit. */
  jobId: string | null;
  title: string;
  company: string;
  status: Status;
  /** The date applied (YYYY-MM-DD, the user's day in Sofia). */
  appliedOn: string;
  createdHow: CreatedHow;
  angle: Angle | null;
  /** The Source of the Job's target posting, or "Added by hand". */
  source: string;
  /** The posting link given when adding by hand (kept even when it couldn't be read). */
  postingUrl: string | null;
  /** The latest Event still standing (undone Events, undo records and snoozes are skipped). */
  lastEvent: ApplicationEvent;
  next: NextUp;
}

/** The happy path, as the stepper shows it. Rejected and withdrawn sit after "or" as a branch. */
export const happyPath: readonly Status[] = ["applied", "screening", "interviewing", "offer", "accepted"];

/**
 * One step of the stepper: done (it happened), current, skipped (a later step happened without it),
 * or still to come. Derived from the Events still standing, so the history shown is what happened.
 */
export interface StatusStep {
  status: Status;
  state: "done" | "current" | "skipped" | "todo";
}

/**
 * What now, at the top of the page. For now: wait for a reply, or the latest note; a closed
 * Application has nothing left to do. (Follow-ups and interviews take this over in later tickets.)
 */
export type NextStep =
  | { kind: "follow-up"; text: string; followUp: FollowUp }
  | { kind: "wait"; text: string }
  | { kind: "note"; text: string; at: string }
  | { kind: "closed"; text: string };

/** One entry on the timeline: an Event, or something apply-kit saw (the posting closing). */
export interface TimelineEntry {
  id: string;
  at: string;
  kind: ApplicationEvent["kind"] | "posting-closed";
  cause: EventCause;
  from: Status | null;
  to: Status | null;
  /** What happened, in plain words. */
  text: string;
  /** More about it, when there is more to say. */
  detail: string | null;
  /** When it was undone, or null. */
  undoneAt: string | null;
  /** Whether Undo applies to it now. */
  undoable: boolean;
  /** For a matched email: the email and the signals it matched on. Undone: it stays, as not a Status change. */
  email: MatchedEmail | null;
}

/** An email from the job mailbox, as Track shows it. */
export interface EmailSummary {
  /** Its Message-ID. */
  id: string;
  /** The From header as sent. */
  from: string;
  subject: string;
  receivedAt: string;
  /** The start of its text, to quote. */
  quote: string;
  /** Its kind, or null when it couldn't be read (the AI budget was out). */
  kind: EmailKind | null;
  /** ISO 639-1, or null when unknown. */
  language: string | null;
  /** A one-line English summary of an email not in English, or null. */
  summary: string | null;
  attachments: MailAttachment[];
}

/** An email matched to an Application, with the signals it matched on (in plain words). */
export interface MatchedEmail extends EmailSummary {
  signals: string[];
  /** "email" when apply-kit matched it, "you" when you did. */
  matchedBy: "email" | "you";
}

/** The banner on an Application an email just moved: until "Looks right" or Undo. */
export interface MovedByEmail {
  eventId: string;
  from: Status;
  to: Status;
  at: string;
  email: MatchedEmail;
  signals: string[];
}

/** One Application an email to match may be about, with why. */
export interface EmailCandidate {
  application: ApplicationSummary;
  reasons: string[];
}

/** "Email to match" in Needs you: an email that would change something but didn't match confidently. */
export interface EmailToMatch {
  email: EmailSummary;
  /** The Status it would move an Application to (forward only), or null when it moves nothing. */
  moveTo: Status | null;
  /** Why it waits, in plain words. */
  why: string;
  /** Likely Applications, best first. */
  candidates: EmailCandidate[];
  /** What "a new Application" would be. */
  newApplication: { company: string; title: string };
  /** What your answer is remembered for: the sender's address or domain (null for a job system's shared sender). */
  remembers: string | null;
}

/** Your answer to an email to match. `move` applies the Status change it suggests (forward only). */
export type EmailAnswer =
  | { choice: "application"; applicationId: string; move?: boolean }
  | { choice: "new"; move?: boolean }
  | { choice: "none" };

/** The job mailbox as Applications shows it (the same problem vocabulary and fixes as Sources). */
export interface TrackMailbox {
  /** not-read until the first read; not-connected: its settings aren't set; failing: the latest read failed. */
  state: "not-read" | "connected" | "not-connected" | "failing";
  problem: MailboxProblem | null;
  /** The reader's own message for the latest failure. */
  error: string | null;
  /** What to do about it, naming the settings involved. */
  fix: string | null;
  /** The first failed read in the current run of failures. */
  since: string | null;
  /** The latest good read. */
  lastReadAt: string | null;
}

/** What one run of email matching did. */
export interface MailProcessed {
  /** Matched and moved a Status. */
  moved: number;
  /** Matched without changing anything. */
  filed: number;
  /** Waiting as Email to match. */
  toMatch: number;
  /** Not application mail (alerts, sent copies, unrelated mail, senders you said aren't). */
  left: number;
}

/** An address or a domain whose mail is matched to an Application. */
export interface Contact {
  value: string;
  kind: "address" | "domain";
}

/** The posting applied to: its Job in apply-kit (whose page keeps the saved copy), or only the link given. */
export interface TargetPosting {
  /** Null when added by hand with a link that couldn't be read. */
  jobId: string | null;
  title: string;
  company: string;
  url: string;
  /** When Discover closed the Job, and how in plain words; null while open. */
  closed: { at: string; how: string } | null;
}

/** The CV attached to an Application added by hand ("What you sent"). */
export interface AttachedCv {
  label: string;
  fileName: string;
  /** Size in bytes. */
  bytes: number;
  attachedAt: string;
}

/** A CV to attach: a PDF, and the label it counts under as the CV version (the file name when empty). */
export interface AttachCvInput {
  fileName: string;
  label?: string | null;
  bytes: Uint8Array;
}

/** The largest CV PDF taken: 10 MB. */
export const maxCvBytes = 10 * 1024 * 1024;

/** One Application in full, as its page shows it. */
export interface ApplicationDetail extends ApplicationSummary {
  /** When it got its current Status (the Event still standing that set it). */
  statusSince: string;
  /** The CV version it counts under in What's working: the attached CV's label (or, later, the Package's). */
  cvVersion: string | null;
  /** The CV attached by hand, or null. */
  cv: AttachedCv | null;
  /** Null when added by hand without a link. */
  posting: TargetPosting | null;
  /** Oldest first. */
  contacts: Contact[];
  steps: StatusStep[];
  nextStep: NextStep;
  /** The follow-up of its current stage (pending, sent or skipped), or null when the stage has none. */
  followUp: FollowUp | null;
  /** Newest first. */
  timeline: TimelineEntry[];
  /** Set while the latest Status change was made by an email you haven't confirmed ("Looks right") or undone. */
  movedByEmail: MovedByEmail | null;
}

/** What the user gives "Add application". */
export interface AddApplicationInput {
  /** A Job in apply-kit (any state, passed and closed too), or one made elsewhere. */
  job: { jobId: string } | { company: string; title: string; link?: string | null };
  /** YYYY-MM-DD, not after today. */
  appliedOn: string;
  /** The Status now. Accepted isn't offered: accepting goes through the offer flow. */
  status: Status;
  /** Their email address or domain, to match replies. Optional. */
  contact?: string | null;
  /** "i-applied" when added from a Job page ("I applied without apply-kit…"). Defaults to "by-hand". */
  how?: "by-hand" | "i-applied";
}

export type AddField = "job" | "company" | "title" | "link" | "appliedOn" | "status" | "contact";

export type AddApplicationResult =
  | {
      outcome: "added";
      application: ApplicationSummary;
      event: ApplicationEvent;
      /** When a posting link was given but couldn't be read: what happened. The Application is still added. */
      linkProblem: string | null;
    }
  /** The Job already has an open Application: nothing was added; open this one. */
  | { outcome: "already-open"; application: ApplicationSummary; message: string }
  | { outcome: "invalid"; field: AddField; message: string };

export type GroupKey = "accepted" | "offer" | "interviewing" | "screening" | "applied" | "closed";

export interface ApplicationGroup {
  key: GroupKey;
  label: string;
  /** Every Application in the group. */
  count: number;
  /** The ones shown (the first `limit`). */
  applications: ApplicationSummary[];
  /** Whether the group starts open. Closed starts collapsed (and is never deleted). */
  open: boolean;
  /** How it is ordered, when it isn't obvious ("soonest due first"). */
  order: string | null;
}

export interface ApplicationList {
  /** Every Application. */
  total: number;
  /** Those not closed. */
  open: number;
  /** Per Status. */
  counts: Record<Status, number>;
  /** The earliest date applied, or null when there are none. */
  since: string | null;
  /** Non-empty groups, in order: Accepted, Offer, Interviewing, Screening, Applied, Closed. */
  groups: ApplicationGroup[];
}

export interface ListQuery {
  /** How many to show per group. Applied and Closed show 5 unless asked for more; the rest show all. */
  limits?: Partial<Record<GroupKey, number>>;
}

/** A Job the user can pick when adding an Application. */
export interface JobChoice {
  id: string;
  title: string;
  company: string;
  state: "new" | "saved" | "passed" | "closed";
  stateChangedAt: string | null;
  location: string | null;
  /** Its open Application, if it has one. */
  application: { id: string; status: Status } | null;
}

/** An Application as a Discover screen mentions it (a Feed row's chip, the Job page's banner and history). */
export interface ApplicationMarker {
  id: string;
  /** The Job it was made for (its live id), or null when added by hand without one. */
  jobId: string | null;
  title: string;
  company: string;
  status: Status;
  appliedOn: string;
  /** For a closed one: the day (in Sofia) the Event that closed it happened; null when it was added closed. */
  closedOn: string | null;
  /** True when it is an Application on the Job asked about. */
  onThisJob: boolean;
}

/** What Track knows about one Job, for the Feed and the Job page. */
export interface JobMarker {
  /** This Job's Application: the open one, else the latest closed one; null when never applied. */
  application: ApplicationMarker | null;
  /**
   * The latest Application on another Job at the same company (names matched with Discover's company
   * normalisation) applied less than 6 months ago, or null.
   */
  sameCompany: ApplicationMarker | null;
  /** Every Application at the Job's company, this Job's included, newest applied first ("History with …"). */
  history: ApplicationMarker[];
}

/** One item in Needs you: a follow-up due (or done today, kept in place and shown as done). */
export interface NeedsYouEntry {
  followUp: FollowUp;
  application: Pick<ApplicationSummary, "id" | "title" | "company" | "status" | "appliedOn">;
  done: boolean;
}

/** Something only coming up: one quiet "Coming up" line. */
export interface ComingUp {
  applicationId: string;
  title: string;
  company: string;
  kind: FollowUpKind;
  dueOn: string;
}

/** Needs you: what only the user can do now, most urgent first, and what is coming up soon. */
export interface NeedsYou {
  /** How many items need the user now (the top bar's Applications badge): follow-ups due and emails to match. Done ones aren't counted. */
  count: number;
  items: NeedsYouEntry[];
  /** Emails waiting as "Email to match" (listed by emailsToMatch). */
  emailsToMatch: number;
  /** Due in the next 3 days, soonest first. */
  comingUp: ComingUp[];
  /** How many days "Snooze" moves one on (a setting). */
  snoozeDays: number;
}

/**
 * Why a follow-up has no draft, so the page can say so: this month's AI budget is used up (it ran out
 * on the day of its last spending and resets on the 1st), AI isn't set up (no key, or no monthly
 * budget), or the draft didn't come out right (the outline stands in).
 */
export type NoDraft =
  | { reason: "budget-out"; capUsd: number; ranOutOn: string | null; resetsOn: string }
  | { reason: "no-ai" }
  | { reason: "failed"; why: string };

/** A follow-up opened to write: the draft (or why there's none), the outline, and how to send it from the user's own mail. */
export interface FollowUpDraft {
  followUp: FollowUp;
  application: ApplicationSummary;
  /** The text to show: as the user typed it, else the draft, else empty. */
  text: string;
  /** The Track assistant's draft, made once within the AI budget; null for a note to self or when there's none. */
  draft: FollowUpDraftText | null;
  /** Why a message has no draft; null when it has one, and for a note to self. */
  noDraft: NoDraft | null;
  /** The points to cover, from the Application, its posting and the user's notes (no model call). */
  outline: string[];
  /** For "Open in Mail": the recipient (null when only a domain is known) and the subject. Null for a note to self. */
  mail: { to: string | null; subject: string } | null;
  /** The length that works well, in words; null for a note to self. */
  words: { min: number; max: number } | null;
  /** How many days "Snooze" moves it on (a setting). */
  snoozeDays: number;
}

/** A change the tracker refuses, with why in plain words. */
export class TrackerError extends Error {
  constructor(
    readonly problem: "not-found" | "accepted" | "unchanged" | "already-open" | "changed-since" | "not-undoable" | "invalid",
    message: string,
    readonly applicationId: string | null = null,
  ) {
    super(message);
    this.name = "TrackerError";
  }
}

export interface Tracker {
  /** "Add application" (and "I applied" on a Job). At most one open Application per Job. */
  addByHand(input: AddApplicationInput): Promise<AddApplicationResult>;
  /** Every Application, grouped by Status, with counts. */
  list(query?: ListQuery): Promise<ApplicationList>;
  /** One Application in full (stepper steps, next step, timeline, contacts, posting, CV), or null. */
  get(applicationId: string): Promise<ApplicationDetail | null>;
  /** The Application's Events, oldest first (undone ones included, marked). */
  events(applicationId: string): Promise<ApplicationEvent[]>;
  /**
   * Sets the Status by hand: an Event "by you", undoable. Anywhere but Accepted, which only the
   * accept flow sets. Throws a TrackerError when refused.
   */
  setStatus(applicationId: string, status: Status): Promise<{
    application: ApplicationSummary; event: ApplicationEvent;
    /** The pending follow-up the change cancelled (undoing the change brings it back), or null. */
    cancelled: FollowUp | null;
  }>;
  /**
   * Undoes an Event: a Status change goes back to the Status before (only while nothing has moved it
   * since); undoing an Application's creation takes it off the list. The Event is kept, marked undone,
   * and the reversal is recorded. Throws a TrackerError when refused.
   */
  undoEvent(eventId: string): Promise<{ application: ApplicationSummary | null; event: ApplicationEvent }>;
  /** Adds a note: an Event by you on the timeline (undoable). Throws a TrackerError when refused. */
  addNote(applicationId: string, text: string): Promise<{ event: ApplicationEvent }>;
  /** Adds an address or domain whose mail belongs here. Throws a TrackerError when refused. */
  addContact(applicationId: string, value: string): Promise<{ contacts: Contact[] }>;
  /**
   * Attaches the CV sent with an Application added by hand: stored locally, its label used as the CV
   * version. A new one replaces the old. Throws a TrackerError when refused.
   */
  attachCv(applicationId: string, cv: AttachCvInput): Promise<{ cv: AttachedCv; event: ApplicationEvent }>;
  /** The attached CV file, or null. */
  cvFile(applicationId: string): Promise<{ fileName: string; bytes: Uint8Array } | null>;
  /** Jobs to pick from when adding (title or company containing the words), any state. */
  findJobs(query: string, limit?: number): Promise<JobChoice[]>;
  /** What Track knows about each of these Jobs, keyed by the id asked with (unknown ids are left out). */
  jobMarkers(jobIds: string[]): Promise<Record<string, JobMarker>>;
  /** Stats: applications per week with the pace, response rate, interviews and what's working. */
  stats(): Promise<TrackStats>;
  /** Needs you: follow-ups due (most urgent first), the count for the badge, and what is coming up. */
  needsYou(): Promise<NeedsYou>;
  /** A follow-up to write: its outline, text as typed and Open in Mail's recipient and subject; null when there's none. */
  followUp(followUpId: string): Promise<FollowUpDraft | null>;
  /** Keeps the follow-up's text as the user types it. Throws a TrackerError when refused. */
  saveFollowUpText(followUpId: string, text: string): Promise<{ followUp: FollowUp }>;
  /** The user sent it from their own mail (or, for a note to self, did it): an Event by you, undoable. */
  markFollowUpSent(followUpId: string): Promise<{ followUp: FollowUp; event: ApplicationEvent }>;
  /** "No note this time": closes it without sending. An Event by you, undoable. */
  skipFollowUp(followUpId: string): Promise<{ followUp: FollowUp; event: ApplicationEvent }>;
  /** Moves it to the snooze delay after today. An Event by you, undoable. */
  snoozeFollowUp(followUpId: string): Promise<{ followUp: FollowUp; event: ApplicationEvent }>;
  /** The follow-up delays (settings): as saved, else the defaults. */
  followUpSettings(): Promise<FollowUpSettings>;
  /** Saves the follow-up delays. Pending follow-ups follow the new delays. Throws with a plain message when invalid. */
  saveFollowUpSettings(settings: unknown): Promise<FollowUpSettings>;
  /**
   * Classifies and matches every stored email not decided yet (run after each mailbox read; the
   * engine passes what it just stored). A confident unique match of a Status-changing kind moves the
   * Status forward (or to Rejected) as an Event by email; anything doubtful waits as Email to match.
   */
  processMail(stored?: MailMessage[]): Promise<MailProcessed>;
  /** Emails waiting for you to say which Application they're about, newest first. */
  emailsToMatch(): Promise<EmailToMatch[]>;
  /**
   * Answers an email to match: an Application (moving its Status or not), a new Application, or not
   * about an application. The answer is remembered for the sender. Throws a TrackerError when refused.
   */
  answerEmail(emailId: string, answer: EmailAnswer): Promise<{ application: ApplicationSummary | null; event: ApplicationEvent | null }>;
  /** "Looks right" on the moved-by-email banner: the banner goes; the email stays on the timeline. */
  confirmEmailMove(eventId: string): Promise<void>;
  /** The job mailbox's state, for Applications' banners. */
  mailbox(): Promise<TrackMailbox>;
}

export interface TrackerDeps {
  db: SqlDatabase;
  clock: Clock;
  /** Discover: Jobs are read and pasted links added through it. */
  discovery: Pick<DiscoveryEngine, "addJobLink" | "getJob">;
  /** Reads emails (classify). Without it every email is matched on rules alone. */
  assistant?: TrackAssistant;
  /** The monthly AI cap shared with Discover (AI_MONTHLY_CAP_USD). Unset or 0 means no AI spending. */
  aiMonthlyCapUsd?: number;
  /** The user's own addresses: mail from them is a sent copy, left for follow-ups. */
  ownAddresses?: string[];
  /** The Master profile, for drafts' evidence (Prepare's; without it drafts carry no numbers about the user). */
  profile?: MasterProfile;
  /** The user's past writing (Prepare's voice samples), beside the follow-up edits Track keeps itself. */
  voice?: VoiceSamples;
}

const statusLabel: Record<Status, string> = {
  applied: "Applied", screening: "Screening", interviewing: "Interviewing", offer: "Offer",
  accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn",
};
export const statusName = (s: Status) => statusLabel[s];

const groupOrder: { key: GroupKey; label: string; statuses: Status[] }[] = [
  { key: "accepted", label: "Accepted", statuses: ["accepted"] },
  { key: "offer", label: "Offer", statuses: ["offer"] },
  { key: "interviewing", label: "Interviewing", statuses: ["interviewing"] },
  { key: "screening", label: "Screening", statuses: ["screening"] },
  { key: "applied", label: "Applied", statuses: ["applied"] },
  { key: "closed", label: "Closed", statuses: ["rejected", "withdrawn"] },
];
const defaultLimits: Partial<Record<GroupKey, number>> = { applied: 5, closed: 5 };
/** The stages with a follow-up, and which. */
const stageKinds: Partial<Record<Status, FollowUpKind>> = { applied: "nudge", screening: "nudge", offer: "offer-note" };
/** Follow-ups due within this many days are "Coming up". */
const comingUpDays = 3;
const isFollowUpEvent = (e: ApplicationEvent) => followUpEventKinds.includes(e.kind);

/** Events that set a Status: adding, a change by hand, and an email's move. */
const movesStatus = "(kind IN ('created', 'status') OR (kind = 'email' AND to_status IS NOT NULL))";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

export function createTracker({ db, clock, discovery, assistant, aiMonthlyCapUsd, ownAddresses = [], profile, voice }: TrackerDeps): Tracker {
  migrate(db);
  const now = () => clock.now().toISOString();
  const today = () => sofiaDay(clock.now());

  function eventOf(r: Row): ApplicationEvent {
    return {
      id: String(r.id), applicationId: String(r.application_id), at: String(r.at),
      kind: r.kind as ApplicationEvent["kind"], cause: r.cause as EventCause,
      from: str(r.from_status) as Status | null, to: str(r.to_status) as Status | null,
      text: String(r.text), undoes: str(r.undoes), undoneAt: str(r.undone_at), followUpId: str(r.follow_up_id),
      emailId: str(r.email_id), emailKind: str(r.email_kind) as EmailKind | null,
    };
  }

  function lastEventOf(applicationId: string): ApplicationEvent {
    const r = db.prepare(
      `SELECT * FROM application_event WHERE application_id = ? AND undone_at IS NULL AND kind NOT IN ('undo', 'follow-up-snoozed')
       ORDER BY at DESC, rowid DESC LIMIT 1`,
    ).get(applicationId);
    return eventOf(r!);
  }

  function summaryOf(r: Row): ApplicationSummary {
    const jobId = str(r.job_id);
    return {
      id: String(r.id), jobId: jobId ? (liveJobId(db, jobId) ?? jobId) : null,
      title: String(r.title), company: String(r.company), status: r.status as Status,
      appliedOn: String(r.applied_on), createdHow: r.created_how as CreatedHow,
      angle: str(r.angle) as Angle | null, source: String(r.source), postingUrl: str(r.posting_url),
      lastEvent: lastEventOf(String(r.id)),
      next: nextOf(r),
    };
  }

  function row(applicationId: string): Row | undefined {
    return db.prepare("SELECT * FROM application WHERE id = ? AND removed_at IS NULL").get(applicationId);
  }

  function summary(applicationId: string): ApplicationSummary | null {
    const r = row(applicationId);
    return r ? summaryOf(r) : null;
  }

  /** The open Application on a Job (by its live id, so a merged Job's Application counts), if any. */
  function openOnJob(jobId: string): ApplicationSummary | null {
    const live = liveJobId(db, jobId) ?? jobId;
    const rows = db.prepare(
      `SELECT * FROM application WHERE job_id IS NOT NULL AND removed_at IS NULL AND status NOT IN ('rejected', 'withdrawn')`,
    ).all();
    const r = rows.find((a) => (liveJobId(db, String(a.job_id)) ?? String(a.job_id)) === live);
    return r ? summaryOf(r) : null;
  }

  type NewEvent = Omit<ApplicationEvent, "id" | "at" | "undoneAt" | "followUpId" | "emailId" | "emailKind">
    & { followUpId?: string; dueOn?: string; emailId?: string | null; emailKind?: EmailKind | null };
  function addEvent(e: NewEvent): ApplicationEvent {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO application_event (id, application_id, at, kind, cause, from_status, to_status, text, undoes, follow_up_id, due_on, email_id, email_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, e.applicationId, now(), e.kind, e.cause, e.from, e.to, e.text, e.undoes, e.followUpId ?? null, e.dueOn ?? null, e.emailId ?? null, e.emailKind ?? null);
    return eventOf(db.prepare("SELECT * FROM application_event WHERE id = ?").get(id)!);
  }

  const alreadyOpen = (application: ApplicationSummary) => ({
    outcome: "already-open" as const, application,
    message: `You already have an open Application for ${application.title} at ${application.company} (${statusName(application.status)}, applied ${dayName(application.appliedOn)}).`,
  });

  async function addByHand(input: AddApplicationInput): Promise<AddApplicationResult> {
    const invalid = (field: AddField, message: string) => ({ outcome: "invalid" as const, field, message });
    if (!statuses.includes(input.status)) return invalid("status", "Choose the Status it has now.");
    if (input.status === "accepted") return invalid("status", "Accepting an offer has its own step, so the other Applications can be withdrawn. Add it as Offer first.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.appliedOn) || Number.isNaN(Date.parse(input.appliedOn))) {
      return invalid("appliedOn", "Enter the date you applied.");
    }
    if (input.appliedOn > today()) return invalid("appliedOn", "The date applied can't be in the future.");
    const contact = contactOf(input.contact);
    if (contact === "invalid") return invalid("contact", "Enter an email address (jobs@company.com) or a domain (company.com).");

    let jobId: string | null = null;
    let company: string;
    let title: string;
    let postingUrl: string | null = null;
    let linkProblem: string | null = null;
    if ("jobId" in input.job) {
      const job = await discovery.getJob(input.job.jobId);
      if (!job) return invalid("job", "That job isn't in apply-kit any more. Search again, or add it as somewhere else.");
      jobId = job.id;
      company = job.company;
      title = job.title;
    } else {
      company = input.job.company.trim();
      title = input.job.title.trim();
      if (!company) return invalid("company", "Enter the company, so replies can be matched to it.");
      if (!title) return invalid("title", "Enter the job title.");
      const link = input.job.link?.trim();
      if (link) {
        // Read like a pasted job (Discover's paste-a-link path), so the Application has a Job page.
        const added = await discovery.addJobLink(link);
        if (added.outcome === "invalid") return invalid("link", added.message);
        if (added.outcome === "unreadable") {
          postingUrl = added.link;
          linkProblem = `The posting couldn't be read, so this Application has no Job page yet. ${added.message}`;
        } else {
          jobId = added.jobId;
          postingUrl = (await discovery.getJob(added.jobId))?.url ?? link;
        }
      }
    }

    if (jobId) {
      const open = openOnJob(jobId);
      if (open) return alreadyOpen(open);
    }

    let angle: Angle | null = null;
    let source = "Added by hand";
    if (jobId) {
      const job = await discovery.getJob(jobId);
      angle = job?.fit.angle ?? null;
      const target = job?.postings.find((p) => p.isTarget) ?? job?.postings[0];
      if (target) source = target.source.label;
    }

    const id = randomUUID();
    const how: CreatedHow = input.how === "i-applied" ? "i-applied" : "by-hand";
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO application (id, job_id, company, title, status, applied_on, created_how, created_at, posting_url, angle, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, jobId, company, title, input.status, input.appliedOn, how, now(), postingUrl, angle, source);
      if (contact) {
        db.prepare("INSERT INTO application_contact (application_id, value, kind, added_at) VALUES (?, ?, ?, ?)")
          .run(id, contact.value, contact.kind, now());
      }
      const text = (how === "i-applied" ? "Applied without apply-kit" : "Added by hand")
        + (input.status === "applied" ? "" : ` · ${statusName(input.status)}`);
      const event = addEvent({ applicationId: id, kind: "created", cause: "you", from: null, to: input.status, text, undoes: null });
      db.exec("COMMIT");
      return { outcome: "added", application: summary(id)!, event, linkProblem };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  async function list(query: ListQuery = {}): Promise<ApplicationList> {
    const all = db.prepare("SELECT * FROM application WHERE removed_at IS NULL").all().map(summaryOf);
    const counts = Object.fromEntries(statuses.map((s) => [s, 0])) as Record<Status, number>;
    for (const a of all) counts[a.status]++;
    const limits = { ...defaultLimits, ...query.limits };
    const groups: ApplicationGroup[] = [];
    for (const g of groupOrder) {
      const members = all.filter((a) => g.statuses.includes(a.status));
      if (!members.length) continue;
      // Applied: the oldest first, since its follow-up falls due soonest. The rest: latest change first.
      if (g.key === "applied") members.sort((a, b) => a.appliedOn.localeCompare(b.appliedOn) || a.title.localeCompare(b.title));
      else members.sort((a, b) => b.lastEvent.at.localeCompare(a.lastEvent.at) || b.appliedOn.localeCompare(a.appliedOn));
      const limit = limits[g.key];
      groups.push({
        key: g.key, label: g.label, count: members.length,
        applications: limit === undefined ? members : members.slice(0, limit),
        open: g.key !== "closed",
        order: g.key === "applied" ? "soonest due first" : null,
      });
    }
    const since = all.map((a) => a.appliedOn).sort()[0] ?? null;
    return { total: all.length, open: all.filter((a) => !isClosed(a.status)).length, counts, since, groups };
  }

  async function setStatus(applicationId: string, status: Status) {
    const app = summary(applicationId);
    if (!app) throw new TrackerError("not-found", "There's no such Application.");
    if (!statuses.includes(status)) throw new TrackerError("unchanged", `Unknown Status "${String(status)}".`, applicationId);
    if (status === "accepted") {
      throw new TrackerError("accepted", "Accepting an offer has its own step, which also offers to withdraw your other Applications.", applicationId);
    }
    if (status === app.status) throw new TrackerError("unchanged", `It is already ${statusName(status)}.`, applicationId);
    if (isClosed(app.status) && !isClosed(status) && app.jobId) {
      const open = openOnJob(app.jobId);
      if (open) throw new TrackerError("already-open", `${open.title} at ${open.company} already has an open Application.`, open.id);
    }
    // The follow-up of the stage it leaves stays behind with that stage: a pending one is cancelled.
    const before = currentFollowUp(row(applicationId)!);
    const cancelled = before && before.state === "pending" ? before : null;
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE application SET status = ? WHERE id = ?").run(status, applicationId);
      const event = addEvent({ applicationId, kind: "status", cause: "you", from: app.status, to: status, text: `Moved to ${statusName(status)}`, undoes: null });
      db.exec("COMMIT");
      return { application: summary(applicationId)!, event, cancelled };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  async function undoEvent(eventId: string) {
    const r = db.prepare("SELECT * FROM application_event WHERE id = ?").get(eventId);
    if (!r) throw new TrackerError("not-found", "There's no such Event.");
    const ev = eventOf(r);
    if (ev.undoneAt) throw new TrackerError("not-undoable", "That was undone already.", ev.applicationId);
    if (ev.kind === "undo") throw new TrackerError("not-undoable", "An undo can't itself be undone; change the Status instead.", ev.applicationId);
    if (ev.kind === "email" && !ev.to) throw new TrackerError("not-undoable", "This email didn't change anything, so there's nothing to undo.", ev.applicationId);
    if (ev.kind === "cv") throw new TrackerError("not-undoable", "Attach another CV to replace this one.", ev.applicationId);
    const app = db.prepare("SELECT * FROM application WHERE id = ?").get(ev.applicationId)!;
    if (app.removed_at) throw new TrackerError("not-found", "That Application was removed.", ev.applicationId);
    if (ev.kind !== "note" && movedSince(ev, String(app.status))) {
      throw new TrackerError("changed-since", "Its Status has changed since, so this can't be undone. Set the Status you want instead.", ev.applicationId);
    }
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE application_event SET undone_at = ? WHERE id = ?").run(now(), eventId);
      let event: ApplicationEvent;
      if (ev.kind === "note") {
        event = addEvent({ applicationId: ev.applicationId, kind: "undo", cause: "you", from: null, to: null, text: "Note removed", undoes: eventId });
      } else if (isFollowUpEvent(ev)) {
        // The follow-up's state comes from its Events still standing, so it is as it was before.
        const text = ev.kind === "follow-up-snoozed" ? "Snooze undone" : ev.kind === "follow-up-sent" ? "Undone: not sent after all" : "Undone: not skipped after all";
        event = addEvent({ applicationId: ev.applicationId, kind: "undo", cause: "you", from: null, to: null, text, undoes: eventId, followUpId: ev.followUpId ?? undefined });
      } else if (ev.kind === "created") {
        db.prepare("UPDATE application SET removed_at = ? WHERE id = ?").run(now(), ev.applicationId);
        event = addEvent({ applicationId: ev.applicationId, kind: "undo", cause: "you", from: null, to: null, text: "Adding undone: removed", undoes: eventId });
      } else {
        db.prepare("UPDATE application SET status = ? WHERE id = ?").run(ev.from, ev.applicationId);
        // An email's move undone: the email stays on the timeline, as not a Status change.
        const stays = ev.kind === "email" ? ". The email stays, as not a Status change" : "";
        event = addEvent({
          applicationId: ev.applicationId, kind: "undo", cause: "you", from: ev.to, to: ev.from,
          text: `Undone: back to ${statusName(ev.from!)}${stays}`, undoes: eventId, emailId: ev.emailId,
        });
      }
      db.exec("COMMIT");
      return { application: summary(ev.applicationId), event };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Whether the Status has moved since this Event (a later Status change or adding stands), so undo would rewrite history. */
  function movedSince(ev: ApplicationEvent, status: string): boolean {
    const later = db.prepare(
      `SELECT COUNT(*) AS n FROM application_event WHERE application_id = ? AND undone_at IS NULL AND ${movesStatus}
       AND rowid > (SELECT rowid FROM application_event WHERE id = ?)`,
    ).get(ev.applicationId, ev.id);
    return Number(later?.n ?? 0) > 0 || ((ev.kind === "status" || ev.kind === "email") && status !== ev.to);
  }

  async function addNote(applicationId: string, text: string) {
    const app = summary(applicationId);
    if (!app) throw new TrackerError("not-found", "There's no such Application.");
    const note = text.trim();
    if (!note) throw new TrackerError("invalid", "Write the note first.", applicationId);
    return { event: addEvent({ applicationId, kind: "note", cause: "you", from: null, to: null, text: note, undoes: null }) };
  }

  async function postingOf(app: ApplicationSummary): Promise<TargetPosting | null> {
    const job = app.jobId ? await discovery.getJob(app.jobId) : null;
    if (job) {
      return {
        jobId: job.id, title: job.title, company: job.company, url: job.url,
        closed: job.closed ? { at: job.closed.at, how: job.closed.how } : null,
      };
    }
    return app.postingUrl ? { jobId: null, title: app.title, company: app.company, url: app.postingUrl, closed: null } : null;
  }

  function cvOf(applicationId: string): AttachedCv | null {
    const r = db.prepare("SELECT label, file_name, length(bytes) AS size, attached_at FROM application_cv WHERE application_id = ?").get(applicationId);
    return r ? { label: String(r.label), fileName: String(r.file_name), bytes: Number(r.size), attachedAt: String(r.attached_at) } : null;
  }

  async function attachCv(applicationId: string, cv: AttachCvInput) {
    const r = row(applicationId);
    if (!r) throw new TrackerError("not-found", "There's no such Application.");
    if (r.package_id) throw new TrackerError("invalid", "This Application has its Package as sent; its CV is that one.", applicationId);
    const invalid = (message: string) => new TrackerError("invalid", message, applicationId);
    const head = new TextDecoder().decode(cv.bytes.subarray(0, 5));
    if (head !== "%PDF-") throw invalid("That file isn't a PDF. Export your CV as PDF and attach that.");
    if (cv.bytes.length > maxCvBytes) throw invalid("That PDF is over 10 MB. Attach a smaller export of your CV.");
    const fileName = cv.fileName.trim().replace(/^.*[\\/]/, "") || "cv.pdf";
    const label = (cv.label?.trim() || fileName.replace(/\.pdf$/i, "")).slice(0, 80);
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO application_cv (application_id, file_name, label, bytes, attached_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (application_id) DO UPDATE SET file_name = excluded.file_name, label = excluded.label, bytes = excluded.bytes, attached_at = excluded.attached_at`,
      ).run(applicationId, fileName, label, cv.bytes, now());
      db.prepare("UPDATE application SET cv_version = ? WHERE id = ?").run(label, applicationId);
      const event = addEvent({ applicationId, kind: "cv", cause: "you", from: null, to: null, text: `CV attached: ${label}`, undoes: null });
      db.exec("COMMIT");
      return { cv: cvOf(applicationId)!, event };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  async function cvFile(applicationId: string) {
    const r = db.prepare("SELECT file_name, bytes FROM application_cv WHERE application_id = ?").get(applicationId);
    return r ? { fileName: String(r.file_name), bytes: r.bytes as Uint8Array } : null;
  }

  const contactsOf = (applicationId: string): Contact[] =>
    db.prepare("SELECT value, kind FROM application_contact WHERE application_id = ? ORDER BY added_at, rowid").all(applicationId)
      .map((r) => ({ value: String(r.value), kind: r.kind as Contact["kind"] }));

  async function addContact(applicationId: string, value: string) {
    if (!summary(applicationId)) throw new TrackerError("not-found", "There's no such Application.");
    const contact = contactOf(value);
    if (!contact || contact === "invalid") {
      throw new TrackerError("invalid", "Enter an email address (jobs@company.com) or a domain (company.com).", applicationId);
    }
    if (contactsOf(applicationId).some((c) => c.value === contact.value)) {
      throw new TrackerError("unchanged", `${contact.value} is already a contact here.`, applicationId);
    }
    db.prepare("INSERT INTO application_contact (application_id, value, kind, added_at) VALUES (?, ?, ?, ?)")
      .run(applicationId, contact.value, contact.kind, now());
    return { contacts: contactsOf(applicationId) };
  }

  function nextStepOf(app: ApplicationSummary, standing: ApplicationEvent[], followUp: FollowUp | null): NextStep {
    if (isClosed(app.status)) return { kind: "closed", text: `Nothing to do: it's ${statusName(app.status).toLowerCase()}. It stays here for your records.` };
    if (followUp?.state === "pending" && followUp.dueOn <= today()) {
      const text = followUp.kind === "nudge"
        ? `No reply in ${daysBetween(followUp.anchorOn, today())} days. Write a short nudge to send from your own mail.`
        : "Write yourself a note about the offer before you decide.";
      return { kind: "follow-up", text, followUp };
    }
    const note = standing.filter((e) => e.kind === "note").at(-1);
    return note ? { kind: "note", text: note.text, at: note.at } : { kind: "wait", text: "Wait for a reply." };
  }

  /** The stepper: the furthest happy-path step reached; steps before it never reached are skipped. */
  function stepsOf(app: ApplicationSummary, standing: ApplicationEvent[]): StatusStep[] {
    // Every Application was applied for; the rest are reached only through an Event still standing.
    const reached = new Set<Status>(["applied", ...standing.flatMap((e) => (e.to ? [e.to] : []))]);
    const current = happyPath.indexOf(app.status);
    const furthest = Math.max(current, ...happyPath.map((s, i) => (reached.has(s) ? i : -1)));
    return happyPath.map((status, i) => ({
      status,
      state: i === current ? "current" : i > furthest ? "todo" : reached.has(status) ? "done" : "skipped",
    }));
  }

  async function detail(applicationId: string): Promise<ApplicationDetail | null> {
    const app = summary(applicationId);
    if (!app) return null;
    const all = allEvents(applicationId);
    const standing = all.filter((e) => !e.undoneAt && e.kind !== "undo");
    const posting = await postingOf(app);
    const timeline: TimelineEntry[] = [...all].reverse().map((e) => ({
      id: e.id, at: e.at, kind: e.kind, cause: e.cause, from: e.from, to: e.to, text: e.text, detail: null, undoneAt: e.undoneAt,
      undoable: !e.undoneAt && (e.kind === "note" || ((e.kind === "status" || (e.kind === "email" && !!e.to) || isFollowUpEvent(e)) && !movedSince(e, app.status))),
      email: e.kind === "email" && e.emailId ? matchedEmail(e.emailId) : null,
    }));
    if (posting?.jobId && posting.closed) {
      // Discover's closing, as a neutral fact: it says nothing about the Application's Status.
      timeline.unshift({
        id: `posting-closed:${posting.jobId}`, at: posting.closed.at, kind: "posting-closed", cause: "apply-kit", from: null, to: null,
        text: "Posting closed",
        detail: `${posting.closed.how}. That's normal once a job stops taking applications, and says nothing about you. The saved copy stays on the Job page.`,
        undoneAt: null, undoable: false, email: null,
      });
    }
    timeline.sort((a, b) => b.at.localeCompare(a.at)); // stable: same-time Events stay newest first
    const setter = standing.filter((e) => e.kind === "created" || e.kind === "status" || (e.kind === "email" && !!e.to)).at(-1);
    const followUp = currentFollowUp(row(applicationId)!);
    return {
      ...app, statusSince: setter?.at ?? app.lastEvent.at, cvVersion: str(row(applicationId)?.cv_version), cv: cvOf(applicationId), posting, contacts: contactsOf(applicationId), steps: stepsOf(app, standing), nextStep: nextStepOf(app, standing, followUp), followUp, timeline,
      movedByEmail: movedByEmailOf(setter, app.status),
    };
  }

  const allEvents = (applicationId: string) =>
    db.prepare("SELECT * FROM application_event WHERE application_id = ? ORDER BY at, rowid").all(applicationId).map(eventOf);

  async function findJobs(query: string, limit = 8): Promise<JobChoice[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const rows = db.prepare(
      `SELECT id, title, company, state, state_changed_at, created_at FROM job WHERE merged_into IS NULL ORDER BY COALESCE(state_changed_at, created_at) DESC, id`,
    ).all();
    const out: JobChoice[] = [];
    for (const j of rows) {
      const hay = `${String(j.title)} ${String(j.company)}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      const loc = db.prepare("SELECT location FROM posting WHERE job_id = ? AND location IS NOT NULL ORDER BY first_seen_at, id LIMIT 1").get(String(j.id));
      const open = openOnJob(String(j.id));
      out.push({
        id: String(j.id), title: String(j.title), company: String(j.company), state: j.state as JobChoice["state"],
        stateChangedAt: str(j.state_changed_at) ?? str(j.created_at), location: str(loc?.location),
        application: open ? { id: open.id, status: open.status } : null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** The day the standing Status Event that closed it happened, or null (open, or added closed). */
  function closedOn(r: Row): string | null {
    if (!isClosed(r.status as Status)) return null;
    const e = db.prepare(
      `SELECT at FROM application_event WHERE application_id = ? AND kind IN ('status', 'email') AND undone_at IS NULL AND to_status = ?
       ORDER BY at DESC, rowid DESC LIMIT 1`,
    ).get(String(r.id), String(r.status));
    return e ? sofiaDay(new Date(String(e.at))) : null;
  }

  async function jobMarkers(jobIds: string[]): Promise<Record<string, JobMarker>> {
    // Every Application once, newest applied first, with its company as Discover normalises it.
    const apps = db.prepare("SELECT * FROM application WHERE removed_at IS NULL").all().map((r) => ({
      companyKey: normaliseCompany(String(r.company)),
      marker: {
        id: String(r.id), jobId: r.job_id == null ? null : (liveJobId(db, String(r.job_id)) ?? String(r.job_id)),
        title: String(r.title), company: String(r.company), status: r.status as Status,
        appliedOn: String(r.applied_on), closedOn: closedOn(r), onThisJob: false,
      } satisfies ApplicationMarker,
    })).sort((a, b) => b.marker.appliedOn.localeCompare(a.marker.appliedOn) || a.marker.title.localeCompare(b.marker.title));
    const recentFrom = sixMonthsBefore(today());
    const out: Record<string, JobMarker> = {};
    for (const asked of new Set(jobIds)) {
      const live = liveJobId(db, asked);
      if (!live) continue;
      const company = normaliseCompany(String(db.prepare("SELECT company FROM job WHERE id = ?").get(live)!.company));
      const history = apps
        .filter((a) => a.marker.jobId === live || (company !== null && a.companyKey === company))
        .map((a) => ({ ...a.marker, onThisJob: a.marker.jobId === live }));
      const mine = history.filter((m) => m.onThisJob);
      out[asked] = {
        application: mine.find((m) => !isClosed(m.status)) ?? mine[0] ?? null,
        sameCompany: history.find((m) => !m.onThisJob && m.appliedOn > recentFrom) ?? null,
        history,
      };
    }
    return out;
  }


  // ---------- follow-ups ----------

  /** The AI budget shared with Discover: what this month spent so far, and recording a spend. */
  const month = () => clock.now().toISOString().slice(0, 7);
  const spentThisMonth = () => Number(db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_spend WHERE month = ?").get(month())?.s ?? 0);
  const spend = (task: "track-classify" | "track-draft", usd: number) =>
    db.prepare("INSERT INTO ai_spend (at, month, task, posting_id, cost_usd) VALUES (?, ?, ?, NULL, ?)").run(now(), month(), task, usd);

  function followUpSettings(): FollowUpSettings {
    const r = db.prepare("SELECT value FROM track_settings WHERE id = 1").get();
    return r ? parseFollowUpSettings(JSON.parse(String(r.value))) : defaultFollowUpSettings;
  }

  /** The Event still standing that began the current stage: the latest adding or Status change (by you or by email). */
  function stageStart(applicationId: string): ApplicationEvent | null {
    const r = db.prepare(
      `SELECT * FROM application_event WHERE application_id = ? AND undone_at IS NULL AND ${movesStatus}
       ORDER BY at DESC, rowid DESC LIMIT 1`,
    ).get(applicationId);
    return r ? eventOf(r) : null;
  }

  /** Whether a reply email still standing was filed on the Application after this Event. */
  function repliedSince(start: ApplicationEvent): boolean {
    return !!db.prepare(
      `SELECT 1 FROM application_event WHERE application_id = ? AND undone_at IS NULL AND kind = 'email'
       AND email_kind IN (${replyKinds.map(() => "?").join(", ")})
       AND rowid > (SELECT rowid FROM application_event WHERE id = ?) LIMIT 1`,
    ).get(start.applicationId, ...replyKinds, start.id);
  }

  /** A follow-up's state, from the Events still standing that name it. */
  function followUpOf(r: Row): FollowUp {
    const events = db.prepare("SELECT * FROM application_event WHERE follow_up_id = ? AND undone_at IS NULL AND kind != 'undo' ORDER BY at, rowid")
      .all(String(r.id));
    const done = events.filter((e) => e.kind === "follow-up-sent" || e.kind === "follow-up-skipped").at(-1);
    const snoozedTo = str(events.filter((e) => e.kind === "follow-up-snoozed").at(-1)?.due_on);
    const kind = r.kind as FollowUpKind;
    const s = followUpSettings();
    const anchorOn = String(r.anchor_on);
    return {
      id: String(r.id), applicationId: String(r.application_id), kind, anchorOn,
      dueOn: snoozedTo ?? addDays(anchorOn, kind === "nudge" ? s.nudgeAfterDays : s.offerNoteAfterDays),
      snoozedTo,
      state: done ? (done.kind === "follow-up-sent" ? "sent" : "skipped") : "pending",
      doneAt: done ? String(done.at) : null,
      text: String(r.text),
    };
  }

  /**
   * The follow-up of an Application's current stage, made the first time it is asked for: a nudge
   * after Applied or Screening, a note to self after an Offer. One per stage: a stage whose follow-up
   * was sent or skipped before (it was left and entered again) gets that one back, not a new one.
   * Null for a stage with none (Interviewing, Accepted, closed) and for a removed Application.
   */
  function currentFollowUp(app: Row): FollowUp | null {
    const status = app.status as Status;
    const kind = stageKinds[status];
    if (!kind || app.removed_at) return null;
    const id = String(app.id);
    const start = stageStart(id);
    if (!start) return null;
    // A reply (a matched email that isn't a confirmation) since the stage began cancels its nudge.
    if (kind === "nudge" && repliedSince(start)) return null;
    const existing = db.prepare("SELECT * FROM follow_up WHERE started_by = ? AND kind = ?").get(start.id, kind);
    if (existing) return followUpOf(existing);
    const earlier = db.prepare("SELECT * FROM follow_up WHERE application_id = ? AND stage = ? AND kind = ? ORDER BY created_at DESC, rowid DESC")
      .all(id, status, kind).map(followUpOf).find((f) => f.state !== "pending");
    if (earlier) return earlier;
    // A nudge after applying counts from the date applied; any other stage from the day it began.
    const anchorOn = status === "applied" && start.kind === "created" ? String(app.applied_on) : sofiaDay(new Date(start.at));
    const fid = randomUUID();
    db.prepare("INSERT INTO follow_up (id, application_id, kind, stage, started_by, anchor_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(fid, id, kind, status, start.id, anchorOn, now());
    return followUpOf(db.prepare("SELECT * FROM follow_up WHERE id = ?").get(fid)!);
  }

  function nextOf(app: Row): NextUp {
    const f = currentFollowUp(app);
    if (!f) return null;
    if (f.state === "pending") return { kind: "follow-up", followUpKind: f.kind, dueOn: f.dueOn, due: f.dueOn <= today() };
    return f.kind === "nudge" ? { kind: "no-reply", days: daysBetween(f.anchorOn, today()) } : null;
  }

  async function needsYou(): Promise<NeedsYou> {
    const day = today();
    const soon = addDays(day, comingUpDays);
    const items: NeedsYouEntry[] = [];
    const comingUp: ComingUp[] = [];
    const apps = db.prepare("SELECT * FROM application WHERE removed_at IS NULL AND status NOT IN ('rejected', 'withdrawn')").all();
    for (const r of apps) {
      const f = currentFollowUp(r);
      if (!f) continue;
      const application = { id: String(r.id), title: String(r.title), company: String(r.company), status: r.status as Status, appliedOn: String(r.applied_on) };
      if (f.state === "pending" && f.dueOn <= day) items.push({ followUp: f, application, done: false });
      else if (f.state !== "pending" && f.doneAt && sofiaDay(new Date(f.doneAt)) === day) items.push({ followUp: f, application, done: true });
      else if (f.state === "pending" && f.dueOn <= soon) {
        comingUp.push({ applicationId: application.id, title: application.title, company: application.company, kind: f.kind, dueOn: f.dueOn });
      }
    }
    // Most urgent first: due the longest; done ones keep their place.
    items.sort((a, b) => a.followUp.dueOn.localeCompare(b.followUp.dueOn) || a.followUp.anchorOn.localeCompare(b.followUp.anchorOn) || a.application.company.localeCompare(b.application.company));
    comingUp.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.company.localeCompare(b.company));
    const emails = Number(db.prepare("SELECT COUNT(*) AS n FROM email_match WHERE state = 'to-match'").get()?.n ?? 0);
    return { count: items.filter((i) => !i.done).length + emails, items, emailsToMatch: emails, comingUp, snoozeDays: followUpSettings().snoozeDays };
  }

  /** A follow-up the user acts on: it must exist and still be its Application's current one. */
  function actionable(followUpId: string): { f: FollowUp; app: Row } {
    const r = db.prepare("SELECT * FROM follow_up WHERE id = ?").get(followUpId);
    const app = r ? row(String(r.application_id)) : undefined;
    if (!r || !app) throw new TrackerError("not-found", "There's no such follow-up.");
    const f = currentFollowUp(app);
    if (f?.id !== followUpId) {
      throw new TrackerError("changed-since", "Its Status has changed since, so this follow-up no longer applies.", String(app.id));
    }
    return { f, app };
  }

  function followUpEvent(followUpId: string, kind: FollowUpEventKind, words: (f: FollowUp) => string, dueOn?: string) {
    const { f, app } = actionable(followUpId);
    if (f.state !== "pending") {
      throw new TrackerError("unchanged", f.state === "sent" ? "It's marked sent already." : "It was skipped already.", String(app.id));
    }
    const event = addEvent({ applicationId: f.applicationId, kind, cause: "you", from: null, to: null, text: words(f), undoes: null, followUpId, dueOn });
    return { followUp: actionable(followUpId).f, event };
  }

  async function followUpDraft(followUpId: string): Promise<FollowUpDraft | null> {
    const r = db.prepare("SELECT * FROM follow_up WHERE id = ?").get(followUpId);
    const application = r ? summary(String(r.application_id)) : null;
    if (!r || !application) return null;
    const f = followUpOf(r);
    const job = application.jobId ? await discovery.getJob(application.jobId) : null;
    const requirement = job?.requirements.find((q) => q.kind === "required") ?? job?.requirements[0];
    const notes = allEvents(application.id).filter((e) => e.kind === "note" && !e.undoneAt).map((e) => e.text);
    const stage = r.stage === "screening" ? "screening" : r.stage === "offer" ? "offer" : "applied";
    const outline = outlineOf({
      kind: f.kind, title: application.title, company: application.company, since: dayWords(f.anchorOn),
      stage, postingDetail: requirement?.text ?? null, note: notes.at(-1) ?? null,
    });
    let draft: FollowUpDraftText | null = null;
    let noDraft: NoDraft | null = null;
    if (f.kind === "nudge" && stage !== "offer") {
      const made = await draftFor(r, {
        followUpId, kind: "nudge", company: application.company, title: application.title, since: dayWords(f.anchorOn), stage,
        daysQuiet: daysBetween(f.anchorOn, today()),
        requirements: [...(job?.requirements ?? [])].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "required" ? -1 : 1)).slice(0, 5).map((q) => q.text),
        notes, evidence: [], voice: [], language: job?.language ?? str(row(application.id)?.language) ?? "en",
        words: draftWords.nudge, banned: bannedPhrases,
      });
      if ("draft" in made) draft = made.draft;
      else noDraft = made.noDraft;
    }
    const to = contactsOf(application.id).find((c) => c.kind === "address")?.value ?? null;
    return {
      followUp: f, application, text: r.text_saved_at ? f.text : (draft?.text ?? f.text), draft, noDraft, outline,
      mail: f.kind === "nudge" ? { to, subject: `Following up on my application: ${application.title}` } : null,
      words: f.kind === "nudge" ? draftWords.nudge : null,
      snoozeDays: followUpSettings().snoozeDays,
    };
  }

  /** Drafts being made, so opening a follow-up twice at once drafts it once. */
  const drafting = new Map<string, Promise<{ draft: FollowUpDraftText } | { noDraft: NoDraft }>>();

  /** The follow-up's draft: the one kept, else a new one from the assistant within the monthly budget. */
  function draftFor(r: Row, base: DraftInput): Promise<{ draft: FollowUpDraftText } | { noDraft: NoDraft }> {
    if (r.draft_text != null) {
      return Promise.resolve({ draft: { text: String(r.draft_text), language: String(r.draft_language ?? base.language), numbers: JSON.parse(String(r.draft_numbers ?? "[]")) } });
    }
    const id = String(r.id);
    const running = drafting.get(id);
    if (running) return running;
    const p = makeDraft(id, base).finally(() => drafting.delete(id));
    drafting.set(id, p);
    return p;
  }

  async function makeDraft(followUpId: string, base: DraftInput): Promise<{ draft: FollowUpDraftText } | { noDraft: NoDraft }> {
    const cap = Math.max(0, aiMonthlyCapUsd ?? 0);
    if (!assistant || cap === 0) return { noDraft: { reason: "no-ai" } };
    const input: DraftInput = {
      ...base,
      evidence: profile ? await profile.evidence({ requirements: base.requirements, language: base.language }).catch(() => []) : [],
      voice: await voiceExcerpts(base.language, followUpId),
    };
    const estimate = assistant.estimateDraftUsd(input);
    if (spentThisMonth() + estimate > cap) return { noDraft: budgetOut(cap) };
    let body: string;
    let model: string;
    try {
      const out = await assistant.draft(input);
      spend("track-draft", Number.isFinite(out.costUsd) && out.costUsd >= 0 ? out.costUsd : estimate);
      body = draftOutputSchema.safeParse(out.draft).data?.body ?? "";
      model = out.model;
    } catch (err) {
      const billed = (err as { costUsd?: unknown } | null)?.costUsd;
      if (typeof billed === "number" && billed > 0) spend("track-draft", billed);
      return { noDraft: { reason: "failed", why: "the Track assistant didn't answer" } };
    }
    const checked = checkDraft(body, input);
    if (!checked.ok) return { noDraft: { reason: "failed", why: checked.why } };
    db.prepare("UPDATE follow_up SET draft_text = ?, draft_language = ?, draft_numbers = ?, draft_model = ?, drafted_at = ? WHERE id = ?")
      .run(checked.draft.text, checked.draft.language, JSON.stringify(checked.draft.numbers), model, now(), followUpId);
    return { draft: checked.draft };
  }

  /** "Ran out on" is the day of this month's last AI spending; it resets on the 1st of next month. */
  function budgetOut(capUsd: number): NoDraft {
    const last = db.prepare("SELECT MAX(at) AS at FROM ai_spend WHERE month = ?").get(month())?.at;
    const d = clock.now();
    const resetsOn = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    return { reason: "budget-out", capUsd, ranOutOn: last ? sofiaDay(new Date(String(last))) : null, resetsOn };
  }

  /** Short excerpts of the user's own writing: their latest follow-ups first (the posting's language first), then Prepare's samples. */
  async function voiceExcerpts(language: string, exceptFollowUpId: string): Promise<string[]> {
    const own = db.prepare("SELECT text, language FROM voice_sample WHERE follow_up_id != ? ORDER BY saved_at DESC LIMIT 20").all(exceptFollowUpId)
      .sort((a, b) => Number(b.language === language) - Number(a.language === language))
      .slice(0, 3).map((v) => excerpt(String(v.text)));
    const more = voice ? await voice.excerpts({ language, limit: 3 }).catch(() => []) : [];
    return [...own, ...more.map((t) => excerpt(t))].slice(0, 5);
  }

  async function saveFollowUpText(followUpId: string, text: string) {
    const r = db.prepare("SELECT * FROM follow_up WHERE id = ?").get(followUpId);
    if (!r || !row(String(r.application_id))) throw new TrackerError("not-found", "There's no such follow-up.");
    db.prepare("UPDATE follow_up SET text = ?, text_saved_at = ? WHERE id = ?").run(text, now(), followUpId);
    // What the user wrote or changed teaches their voice (kept locally); the draft as it came doesn't.
    if (r.kind === "nudge") {
      const own = text.trim() && text.trim() !== String(r.draft_text ?? "").trim();
      if (own) {
        db.prepare(`INSERT INTO voice_sample (follow_up_id, text, language, saved_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (follow_up_id) DO UPDATE SET text = excluded.text, language = excluded.language, saved_at = excluded.saved_at`)
          .run(followUpId, text.trim(), str(r.draft_language) ?? (/[Ѐ-ӿ]/.test(text) ? "bg" : "en"), now());
      } else db.prepare("DELETE FROM voice_sample WHERE follow_up_id = ?").run(followUpId);
    }
    return { followUp: followUpOf(db.prepare("SELECT * FROM follow_up WHERE id = ?").get(followUpId)!) };
  }

  // ---------- Email matching (spec #24 "Matching rules", ADR 0004) ----------

  /** A signal tying an email to an Application. Signals in one group are one fact (the sender's domain), counted once. */
  type Signal = { group: "thread" | "taught" | "sender" | "ats" | "title"; text: string };
  const strongGroups: Signal["group"][] = ["thread", "taught"];

  const own = new Set(ownAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean));

  /** Reads an email with the assistant within the monthly budget; otherwise by rules (or not at all). */
  async function classify(m: MailMessage): Promise<{ c: EmailClassification | null; by: "assistant" | "rules" | "none"; model: string | null }> {
    if (assistant) {
      const input = classifyInput(m);
      const estimate = assistant.estimateClassifyUsd(input);
      if (spentThisMonth() + estimate <= Math.max(0, aiMonthlyCapUsd ?? 0)) {
        try {
          const out = await assistant.classify(input);
          spend("track-classify", Number.isFinite(out.costUsd) && out.costUsd >= 0 ? out.costUsd : estimate);
          const parsed = emailClassificationSchema.safeParse(out.classification);
          if (parsed.success) return { c: parsed.data, by: "assistant", model: out.model };
        } catch (err) {
          const billed = (err as { costUsd?: unknown } | null)?.costUsd;
          if (typeof billed === "number" && billed > 0) {
            spend("track-classify", billed);
          }
        }
      }
    }
    const rules = ruleClassify(m);
    return rules ? { c: rules, by: "rules", model: null } : { c: null, by: "none", model: null };
  }

  /** The sender rule you taught for this sender (its address first, then its domain), if any. */
  function ruleFor(address: string): { applicationId: string | null } | null {
    const r = db.prepare("SELECT application_id FROM sender_rule WHERE sender = ?").get(address)
      ?? db.prepare("SELECT application_id FROM sender_rule WHERE sender = ? AND kind = 'domain'").get(baseDomain(domainOf(address)));
    return r ? { applicationId: str(r.application_id) } : null;
  }

  /** What an answer is remembered for: the address, or the domain when it isn't a shared provider; nothing for a job system. */
  function ruleKey(address: string): { sender: string; kind: "address" | "domain" } | null {
    const domain = domainOf(address);
    if (isAtsDomain(domain)) return null;
    return isSharedProvider(domain) ? { sender: address, kind: "address" } : { sender: baseDomain(domain), kind: "domain" };
  }

  /** Open Applications, and those closed in the last 30 days. */
  function candidateRows(): Row[] {
    const since = new Date(clock.now().getTime() - 30 * 24 * 60 * 60_000).toISOString();
    return db.prepare("SELECT * FROM application WHERE removed_at IS NULL").all().filter((r) => {
      if (!isClosed(r.status as Status)) return true;
      const e = db.prepare(`SELECT MAX(at) AS at FROM application_event WHERE application_id = ? AND undone_at IS NULL AND ${movesStatus}`).get(String(r.id));
      return String(e?.at ?? "") >= since;
    });
  }

  /** The hosts of the posting applied to: the link given, and the Job's postings (boards and job systems left out). */
  function postingDomains(r: Row): string[] {
    const urls = [str(r.posting_url)];
    if (r.job_id) {
      const live = liveJobId(db, String(r.job_id)) ?? String(r.job_id);
      urls.push(...db.prepare("SELECT url FROM posting WHERE job_id = ?").all(live).map((p) => String(p.url)));
    }
    return [...new Set(urls.flatMap((u) => { const h = u ? hostOf(u) : null; return h && !isBoardDomain(h) ? [baseDomain(h)] : []; }))];
  }

  /** Every Application this email may be about, with the signals for each. */
  function signalsFor(m: MailMessage, c: EmailClassification | null): { applicationId: string; signals: Signal[] }[] {
    const address = senderOf(m).address;
    const domain = domainOf(address);
    const base = baseDomain(domain);
    const text = `${m.subject}\n${quoteOf(m, 4000)}`;
    const refs = [m.inReplyTo, ...m.references].filter((x): x is string => !!x);
    const threadApps = new Set(refs.length
      ? db.prepare(`SELECT application_id FROM email_match WHERE state = 'matched' AND application_id IS NOT NULL AND email_id IN (${refs.map(() => "?").join(", ")})`)
        .all(...refs).map((r) => String(r.application_id))
      : []);
    const rule = ruleFor(address);
    const out: { applicationId: string; signals: Signal[] }[] = [];
    for (const r of candidateRows()) {
      const id = String(r.id);
      const company = String(r.company);
      const title = String(r.title);
      const signals: Signal[] = [];
      if (threadApps.size === 1 && threadApps.has(id)) signals.push({ group: "thread", text: "It replies in an email thread already matched to this Application." });
      if (rule?.applicationId === id) signals.push({ group: "taught", text: `You matched mail from ${address} here before.` });
      const contacts = contactsOf(id);
      const posting = postingDomains(r);
      const sender =
        contacts.some((k) => k.kind === "address" && k.value === address) ? `The sender (${address}) is a contact of this Application.`
        : contacts.some((k) => k.kind === "domain" && (domain === k.value || domain.endsWith(`.${k.value}`))) ? `The sender's domain (${base}) is a contact of this Application.`
        : !isBoardDomain(domain) && posting.includes(base) ? `The sender's domain is the target posting's domain (${base}).`
        : !isAtsDomain(domain) && !isSharedProvider(domain) && companyDomainMatches(company, domain) ? `The sender's domain (${base}) is ${company}'s.`
        : null;
      if (sender) signals.push({ group: "sender", text: sender });
      if (isAtsDomain(domain) && (namesCompany(company, text) || (c?.company && normaliseCompany(c.company) === normaliseCompany(company)))) {
        signals.push({ group: "ats", text: `A job system (${base}) writing for ${company}.` });
      }
      if (namesTitle(title, text) || (c?.jobTitle && namesTitle(title, c.jobTitle) && namesTitle(c.jobTitle, title))) {
        signals.push({ group: "title", text: `It names the job: "${title}".` });
      }
      if (signals.length) out.push({ applicationId: id, signals });
    }
    const strength = (x: { signals: Signal[] }) => (x.signals.some((s) => strongGroups.includes(s.group)) ? 10 : 0) + new Set(x.signals.map((s) => s.group)).size;
    return out.sort((a, b) => strength(b) - strength(a));
  }

  /** The one Application an email confidently belongs to: the only one with a thread or taught signal, or the only one with two independent signals. */
  function uniqueMatch(candidates: { applicationId: string; signals: Signal[] }[]) {
    const strong = candidates.filter((x) => x.signals.some((s) => strongGroups.includes(s.group)));
    if (strong.length) return strong.length === 1 ? strong[0]! : null;
    const two = candidates.filter((x) => new Set(x.signals.map((s) => s.group)).size >= 2);
    return two.length === 1 ? two[0]! : null;
  }

  /** The Status an email of this kind moves an Application to, or null. */
  const targetOf = (kind: EmailKind | null | undefined, stage: unknown): Status | null =>
    kind === "rejection" ? "rejected" : kind === "offer" ? "offer"
      : kind === "interview-invitation" ? (stage === "screening" ? "screening" : "interviewing") : null;

  /** Email only moves forward along the happy path, or to Rejected; never backwards, never out of a closed Status, never to Accepted. */
  function isForward(from: Status, to: Status): boolean {
    if (isClosed(from) || from === "accepted" || to === "accepted") return false;
    if (to === "rejected") return true;
    return happyPath.indexOf(to) > happyPath.indexOf(from);
  }

  function decide(emailId: string, d: { state: "matched" | "to-match" | "not-application" | "left"; applicationId?: string | null; signals?: string[]; candidates?: { applicationId: string; signals: string[] }[]; reason?: string | null; how?: "auto" | "you" | null }) {
    db.prepare(
      `INSERT INTO email_match (email_id, state, application_id, signals, candidates, reason, how, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email_id) DO UPDATE SET state = excluded.state, application_id = excluded.application_id, signals = excluded.signals,
         candidates = excluded.candidates, reason = excluded.reason, how = excluded.how, decided_at = excluded.decided_at`,
    ).run(emailId, d.state, d.applicationId ?? null, JSON.stringify(d.signals ?? []), JSON.stringify(d.candidates ?? []), d.reason ?? null, d.how ?? null, now());
  }

  /**
   * Files an email on an Application as an Event, moving its Status when `move` and the kind's Status
   * is forward from where it stands. Returns the Event and whether it moved.
   */
  function fileEmail(applicationId: string, m: MailMessage, kind: EmailKind | null, target: Status | null, move: boolean, cause: EventCause) {
    const app = row(applicationId)!;
    const from = app.status as Status;
    const moves = move && target !== null && isForward(from, target);
    const what = kind ? emailKindName[kind] : "Email";
    if (moves) db.prepare("UPDATE application SET status = ? WHERE id = ?").run(target, applicationId);
    const text = moves
      ? `${what}: moved to ${statusName(target!)}`
      : target && move && !isForward(from, target) ? `${what}, filed: it's ${statusName(from)} already, so the Status stays` : `${what}, filed`;
    const event = addEvent({
      applicationId, kind: "email", cause, from: moves ? from : null, to: moves ? target : null, text, undoes: null,
      emailId: m.id, emailKind: kind,
    });
    return { event, moved: moves };
  }

  const kindWords = (k: EmailKind) => (k === "interview-invitation" ? "an interview invitation" : k === "info-request" ? "a request for information" : k === "other" ? "an email" : `a${k === "offer" ? "n" : ""} ${emailKindName[k].toLowerCase()}`);

  function whyWaiting(m: MailMessage, c: EmailClassification | null, by: "assistant" | "rules" | "none", target: Status | null, candidates: number, matched: boolean): string {
    const domain = baseDomain(domainOf(senderOf(m).address));
    if (!c) {
      return by === "none" && assistant
        ? "This month's AI budget is used up, so apply-kit couldn't read what it says, and nothing it knows ties it to one Application. Nothing has changed."
        : "apply-kit couldn't read what it says, and nothing it knows ties it to one Application. Nothing has changed.";
    }
    const reads = `It reads like ${kindWords(c.kind)}${target ? ` (would move an Application to ${statusName(target)})` : ""}`;
    if (matched) return `${reads}, but apply-kit isn't sure enough of that to change a Status on its own, so nothing has changed.`;
    if (candidates > 1) return `${reads}, but it could be about more than one Application. ${target ? "That's too important to guess, so nothing has changed." : "Nothing has changed."}`;
    return `${reads}, but ${domain} hasn't written before and nothing ties it to one Application. ${target ? "That's too important to guess, so nothing has changed." : "Nothing has changed."}`;
  }

  /** Decides one email. Returns what happened to it. */
  async function processOne(m: MailMessage): Promise<keyof MailProcessed> {
    const address = senderOf(m).address;
    if (own.has(address)) { decide(m.id, { state: "left", reason: "sent-copy" }); return "left"; }
    if (isJobAlert(m)) { decide(m.id, { state: "left", reason: "alert" }); return "left"; }
    const rule = ruleFor(address);
    if (rule && rule.applicationId === null) { decide(m.id, { state: "not-application", reason: "taught", how: "auto" }); return "left"; }

    const { c, by, model } = await classify(m);
    db.prepare(
      `INSERT OR REPLACE INTO email_classification (email_id, by, kind, confidence, company, job_title, stage, language, summary, model, classified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(m.id, by, c?.kind ?? null, c?.confidence ?? null, c?.company ?? null, c?.jobTitle ?? null, c?.stage ?? null, c?.language ?? null, c?.summary ?? null, model, now());

    const candidates = signalsFor(m, c);
    const match = uniqueMatch(candidates);
    const target = targetOf(c?.kind, c?.stage);
    const strongMatch = !!match?.signals.some((s) => strongGroups.includes(s.group));
    const texts = (x: { signals: Signal[] }) => x.signals.map((s) => s.text);
    const wait = () => {
      decide(m.id, {
        state: "to-match", reason: whyWaiting(m, c, by, target, candidates.length, !!match),
        candidates: candidates.slice(0, 4).map((x) => ({ applicationId: x.applicationId, signals: texts(x) })),
      });
      return "toMatch" as const;
    };
    const file = (move: boolean) => {
      db.exec("BEGIN");
      try {
        const { moved } = fileEmail(match!.applicationId, m, c?.kind ?? null, target, move, "email");
        decide(m.id, { state: "matched", applicationId: match!.applicationId, signals: texts(match!), how: "auto" });
        db.exec("COMMIT");
        return moved ? ("moved" as const) : ("filed" as const);
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    };

    // Not read (budget out): only rule-based matches apply (a thread, a taught sender, or a known job system's confirmation).
    if (!c) return match && strongMatch ? file(false) : wait();
    if (by === "rules") return match ? file(false) : wait();
    if (c.kind === "other") {
      if (match) return file(false);
      decide(m.id, { state: "left", reason: "not-application-mail" });
      return "left";
    }
    if (!target) return match ? file(false) : wait();
    if (!match || c.confidence < highConfidence) return wait();
    return file(true);
  }

  let running: Promise<unknown> = Promise.resolve();
  /** Every stored email from the last 30 days not decided yet, oldest first, one run at a time. */
  function processMail(): Promise<MailProcessed> {
    const run = running.then(async () => {
      const since = new Date(clock.now().getTime() - 30 * 24 * 60 * 60_000).toISOString();
      const rows = db.prepare(
        `SELECT m.* FROM mail_message m LEFT JOIN email_match d ON d.email_id = m.id
         WHERE d.email_id IS NULL AND m.received_at >= ? ORDER BY m.received_at, m.id`,
      ).all(since);
      const done: MailProcessed = { moved: 0, filed: 0, toMatch: 0, left: 0 };
      for (const r of rows) done[await processOne(storedMessage(r))]++;
      return done;
    });
    running = run.catch(() => {});
    return run;
  }

  function emailSummary(emailId: string): EmailSummary | null {
    const r = db.prepare(
      `SELECT m.*, c.kind AS c_kind, c.language AS c_language, c.summary AS c_summary
       FROM mail_message m LEFT JOIN email_classification c ON c.email_id = m.id WHERE m.id = ?`,
    ).get(emailId);
    if (!r) return null;
    const m = storedMessage(r);
    return {
      id: m.id, from: m.from, subject: m.subject, receivedAt: m.receivedAt.toISOString(), quote: quoteOf(m),
      kind: str(r.c_kind) as EmailKind | null, language: str(r.c_language), summary: str(r.c_summary), attachments: m.attachments,
    };
  }

  function matchedEmail(emailId: string): MatchedEmail | null {
    const e = emailSummary(emailId);
    if (!e) return null;
    const d = db.prepare("SELECT signals, how FROM email_match WHERE email_id = ?").get(emailId);
    return { ...e, signals: d ? (JSON.parse(String(d.signals)) as string[]) : [], matchedBy: d?.how === "you" ? "you" : "email" };
  }

  function movedByEmailOf(setter: ApplicationEvent | undefined, status: Status): MovedByEmail | null {
    if (!setter || setter.kind !== "email" || setter.cause !== "email" || !setter.emailId || setter.to !== status || !setter.from) return null;
    const confirmed = db.prepare("SELECT confirmed_at FROM email_match WHERE email_id = ?").get(setter.emailId)?.confirmed_at;
    if (confirmed != null) return null;
    const email = matchedEmail(setter.emailId);
    return email ? { eventId: setter.id, from: setter.from, to: setter.to, at: setter.at, email, signals: email.signals } : null;
  }

  async function emailsToMatch(): Promise<EmailToMatch[]> {
    const rows = db.prepare(
      `SELECT d.*, m.from_header, m.received_at, c.company AS c_company, c.job_title AS c_title, c.kind AS c_kind, c.stage AS c_stage
       FROM email_match d JOIN mail_message m ON m.id = d.email_id LEFT JOIN email_classification c ON c.email_id = d.email_id
       WHERE d.state = 'to-match' ORDER BY m.received_at DESC, m.id`,
    ).all();
    return rows.map((r) => {
      const email = emailSummary(String(r.email_id))!;
      const address = senderOf({ from: String(r.from_header) }).address;
      const candidates = (JSON.parse(String(r.candidates)) as { applicationId: string; signals: string[] }[]).flatMap((x) => {
        const a = summary(x.applicationId);
        return a ? [{ application: a, reasons: x.signals }] : [];
      });
      const kind = str(r.c_kind) as EmailKind | null;
      const target = targetOf(kind, r.c_stage);
      return {
        email, moveTo: target, why: String(r.reason ?? ""), candidates,
        newApplication: newApplicationFrom({ company: str(r.c_company), title: str(r.c_title), subject: email.subject, address }),
        remembers: ruleKey(address)?.sender ?? null,
      };
    });
  }

  /** The company and title "a new Application" from this email would have. */
  function newApplicationFrom(e: { company: string | null; title: string | null; subject: string; address: string }) {
    const label = baseDomain(domainOf(e.address)).split(".")[0] ?? "";
    const company = e.company?.trim() || (isAtsDomain(domainOf(e.address)) || isSharedProvider(domainOf(e.address))
      ? "Unknown company"
      : label.split(/[-_]/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" "));
    const title = e.title?.trim() || e.subject.replace(/^(re|fw|fwd):\s*/i, "").trim() || "Unknown job";
    return { company, title };
  }

  async function answerEmail(emailId: string, answer: EmailAnswer) {
    const choice = (answer as { choice?: unknown } | null)?.choice;
    if (choice !== "application" && choice !== "new" && choice !== "none") {
      throw new TrackerError("invalid", "Choose where this email belongs first.");
    }
    const d = db.prepare("SELECT state FROM email_match WHERE email_id = ?").get(emailId);
    const r = db.prepare("SELECT * FROM mail_message WHERE id = ?").get(emailId);
    if (!d || !r) throw new TrackerError("not-found", "There's no such email to match.");
    if (d.state !== "to-match") throw new TrackerError("unchanged", "That email was matched already.");
    const m = storedMessage(r);
    const address = senderOf(m).address;
    const cls = db.prepare("SELECT * FROM email_classification WHERE email_id = ?").get(emailId);
    const kind = str(cls?.kind) as EmailKind | null;
    const target = targetOf(kind, cls?.stage);
    const teach = (applicationId: string | null) => {
      const key = ruleKey(address);
      if (!key) return;
      db.prepare(
        `INSERT INTO sender_rule (sender, kind, application_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (sender) DO UPDATE SET kind = excluded.kind, application_id = excluded.application_id, created_at = excluded.created_at`,
      ).run(key.sender, key.kind, applicationId, now());
    };

    db.exec("BEGIN");
    try {
      let result: { application: ApplicationSummary | null; event: ApplicationEvent | null };
      if (answer.choice === "none") {
        decide(emailId, { state: "not-application", how: "you", reason: "you" });
        teach(null);
        result = { application: null, event: null };
      } else {
        let applicationId: string;
        if (answer.choice === "application") {
          if (!row(answer.applicationId)) throw new TrackerError("not-found", "That Application isn't there any more. Choose another.");
          applicationId = answer.applicationId;
        } else {
          applicationId = createFromEmail(m, { company: str(cls?.company), title: str(cls?.job_title) });
        }
        const { event } = fileEmail(applicationId, m, kind, target, answer.move === true, "you");
        decide(emailId, { state: "matched", applicationId, signals: ["You matched it."], how: "you" });
        teach(applicationId);
        result = { application: summary(applicationId), event };
      }
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /** "A new Application" from an email: applied the day it arrived, its sender kept as the contact. */
  function createFromEmail(m: MailMessage, c: { company: string | null; title: string | null }): string {
    const address = senderOf(m).address;
    const { company, title } = newApplicationFrom({ ...c, subject: m.subject, address });
    const id = randomUUID();
    const appliedOn = sofiaDay(m.receivedAt);
    db.prepare(
      `INSERT INTO application (id, job_id, company, title, status, applied_on, created_how, created_at, posting_url, angle, source)
       VALUES (?, NULL, ?, ?, 'applied', ?, 'from-email', ?, NULL, NULL, 'Added by hand')`,
    ).run(id, company, title, appliedOn > today() ? today() : appliedOn, now());
    const key = ruleKey(address);
    if (key) {
      db.prepare("INSERT INTO application_contact (application_id, value, kind, added_at) VALUES (?, ?, ?, ?)").run(id, key.sender, key.kind, now());
    }
    addEvent({ applicationId: id, kind: "created", cause: "you", from: null, to: "applied", text: "Added from an email", undoes: null });
    return id;
  }

  async function confirmEmailMove(eventId: string) {
    const r = db.prepare("SELECT email_id FROM application_event WHERE id = ? AND kind = 'email'").get(eventId);
    if (!r?.email_id) throw new TrackerError("not-found", "There's no such email move.");
    db.prepare("UPDATE email_match SET confirmed_at = ? WHERE email_id = ?").run(now(), String(r.email_id));
  }

  function mailbox(): TrackMailbox {
    const latest = db.prepare("SELECT read_at, outcome, reason, error FROM mailbox_read ORDER BY id DESC LIMIT 1").get();
    const lastOk = db.prepare("SELECT MAX(read_at) AS at FROM mailbox_read WHERE outcome = 'ok'").get()?.at;
    const lastReadAt = lastOk == null ? null : String(lastOk);
    if (!latest) return { state: "not-read", problem: null, error: null, fix: null, since: null, lastReadAt };
    if (latest.outcome === "ok") return { state: "connected", problem: null, error: null, fix: null, since: null, lastReadAt };
    const problem = (String(latest.reason) in mailboxFix ? String(latest.reason) : "error") as MailboxProblem;
    const since = String(db.prepare("SELECT MIN(read_at) AS at FROM mailbox_read WHERE outcome != 'ok' AND read_at > ?").get(lastReadAt ?? "")!.at);
    return {
      state: problem === "not-configured" ? "not-connected" : "failing", problem, error: str(latest.error), fix: mailboxFix[problem], since, lastReadAt,
    };
  }

  return {
    needsYou,
    followUp: followUpDraft,
    saveFollowUpText,
    markFollowUpSent: async (id) => followUpEvent(id, "follow-up-sent", (f) => (f.kind === "nudge" ? "Follow-up sent" : "Note to self done")),
    skipFollowUp: async (id) => followUpEvent(id, "follow-up-skipped", (f) => (f.kind === "nudge" ? "No follow-up this time" : "No note this time")),
    snoozeFollowUp: async (id) => {
      const to = addDays(today(), followUpSettings().snoozeDays);
      return followUpEvent(id, "follow-up-snoozed", (f) => `${f.kind === "nudge" ? "Follow-up" : "Note to self"} snoozed to ${dayWords(to)}`, to);
    },
    followUpSettings: async () => followUpSettings(),
    saveFollowUpSettings: async (input) => {
      const settings = parseFollowUpSettings(input);
      db.prepare(
        `INSERT INTO track_settings (id, value, updated_at) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(JSON.stringify(settings), now());
      return settings;
    },
    processMail,
    emailsToMatch,
    answerEmail,
    confirmEmailMove,
    mailbox: async () => mailbox(),
    jobMarkers,
    addByHand,
    list,
    get: detail,
    events: async (id) => allEvents(id),
    setStatus,
    undoEvent,
    addNote,
    addContact,
    attachCv,
    cvFile,
    findJobs,
    stats: async () => {
      const mail = mailbox();
      return computeStats(db, today(), mail.state === "failing" || mail.state === "not-connected" ? mail.since : null);
    },
  };
}

/** The calendar day in Sofia (YYYY-MM-DD). */
/** A short excerpt of the user's writing, as sent with a draft: the full sample stays on the laptop. */
function excerpt(text: string, max = 400): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function sofiaDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** The same day 6 calendar months earlier (the last day of that month when it is shorter). */
function sixMonthsBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const back = new Date(Date.UTC(y, m - 1 - 6, 1));
  const last = new Date(Date.UTC(back.getUTCFullYear(), back.getUTCMonth() + 1, 0)).getUTCDate();
  back.setUTCDate(Math.min(d, last));
  return back.toISOString().slice(0, 10);
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Tue 6 Oct" for 2026-10-06. */
function dayWords(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${weekdays[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "9 Oct 2026" for 2026-10-09. */
function dayName(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${months[m! - 1]} ${y}`;
}

/** A contact address or domain, normalised; "invalid" when it is neither; null when empty. */
function contactOf(v: string | null | undefined): { value: string; kind: "address" | "domain" } | "invalid" | null {
  const s = v?.trim().toLowerCase().replace(/^@/, "");
  if (!s) return null;
  if (/^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return { value: s, kind: "address" };
  const domain = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return { value: domain, kind: "domain" };
  return "invalid";
}
