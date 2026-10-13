// The tracker: Track's own module beside the discovery engine, sharing its database and clock. It
// owns the Application (GLOSSARY "After applying"): created by hand or with "I applied" on a Job,
// listed grouped by Status, and moved only through Events that each name their cause. Events are
// append-only: undo marks an Event undone and records the reversal as an Event of its own.
//
// Its public interface below is the testing seam (test/tracker.test.ts).
import { randomUUID } from "node:crypto";
import type { DiscoveryEngine } from "./engine.ts";
import type { Angle } from "./fit/angles.ts";
import { normaliseCompany } from "./matching.ts";
import { liveJobId } from "./merging.ts";
import type { Clock, SqlDatabase } from "./ports.ts";
import { migrate } from "./schema.ts";
import { computeStats, type TrackStats } from "./track-stats.ts";

export const statuses = ["applied", "screening", "interviewing", "offer", "accepted", "rejected", "withdrawn"] as const;
/** Where an Application stands. Rejected and withdrawn are closed. */
export type Status = (typeof statuses)[number];
export const closedStatuses: readonly Status[] = ["rejected", "withdrawn"];
export const isClosed = (s: Status) => closedStatuses.includes(s);

/** Who or what caused an Event: a matched email, the user, or apply-kit itself. */
export type EventCause = "email" | "you" | "apply-kit";
/** How an Application came to be. Only "by-hand" and "i-applied" exist so far. */
export type CreatedHow = "submission" | "i-applied" | "by-hand" | "from-email";

export interface ApplicationEvent {
  id: string;
  applicationId: string;
  at: string;
  /**
   * created: the Application was added. status: its Status changed. note: the user wrote a note.
   * cv: the user attached the CV they sent. undo: an earlier Event was undone.
   */
  kind: "created" | "status" | "note" | "cv" | "undo";
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
}

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
  /** The latest Event still standing (undone Events and undo records are skipped). */
  lastEvent: ApplicationEvent;
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
  /** Newest first. */
  timeline: TimelineEntry[];
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
  setStatus(applicationId: string, status: Status): Promise<{ application: ApplicationSummary; event: ApplicationEvent }>;
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
}

export interface TrackerDeps {
  db: SqlDatabase;
  clock: Clock;
  /** Discover: Jobs are read and pasted links added through it. */
  discovery: Pick<DiscoveryEngine, "addJobLink" | "getJob">;
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

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

export function createTracker({ db, clock, discovery }: TrackerDeps): Tracker {
  migrate(db);
  const now = () => clock.now().toISOString();
  const today = () => sofiaDay(clock.now());

  function eventOf(r: Row): ApplicationEvent {
    return {
      id: String(r.id), applicationId: String(r.application_id), at: String(r.at),
      kind: r.kind as ApplicationEvent["kind"], cause: r.cause as EventCause,
      from: str(r.from_status) as Status | null, to: str(r.to_status) as Status | null,
      text: String(r.text), undoes: str(r.undoes), undoneAt: str(r.undone_at),
    };
  }

  function lastEventOf(applicationId: string): ApplicationEvent {
    const r = db.prepare(
      `SELECT * FROM application_event WHERE application_id = ? AND undone_at IS NULL AND kind != 'undo'
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

  function addEvent(e: Omit<ApplicationEvent, "id" | "at" | "undoneAt">): ApplicationEvent {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO application_event (id, application_id, at, kind, cause, from_status, to_status, text, undoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, e.applicationId, now(), e.kind, e.cause, e.from, e.to, e.text, e.undoes);
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
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE application SET status = ? WHERE id = ?").run(status, applicationId);
      const event = addEvent({ applicationId, kind: "status", cause: "you", from: app.status, to: status, text: `Moved to ${statusName(status)}`, undoes: null });
      db.exec("COMMIT");
      return { application: summary(applicationId)!, event };
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
      } else if (ev.kind === "created") {
        db.prepare("UPDATE application SET removed_at = ? WHERE id = ?").run(now(), ev.applicationId);
        event = addEvent({ applicationId: ev.applicationId, kind: "undo", cause: "you", from: null, to: null, text: "Adding undone: removed", undoes: eventId });
      } else {
        db.prepare("UPDATE application SET status = ? WHERE id = ?").run(ev.from, ev.applicationId);
        event = addEvent({
          applicationId: ev.applicationId, kind: "undo", cause: "you", from: ev.to, to: ev.from,
          text: `Undone: back to ${statusName(ev.from!)}`, undoes: eventId,
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
      `SELECT COUNT(*) AS n FROM application_event WHERE application_id = ? AND undone_at IS NULL AND kind IN ('created', 'status')
       AND rowid > (SELECT rowid FROM application_event WHERE id = ?)`,
    ).get(ev.applicationId, ev.id);
    return Number(later?.n ?? 0) > 0 || (ev.kind === "status" && status !== ev.to);
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

  function nextStepOf(app: ApplicationSummary, standing: ApplicationEvent[]): NextStep {
    if (isClosed(app.status)) return { kind: "closed", text: `Nothing to do: it's ${statusName(app.status).toLowerCase()}. It stays here for your records.` };
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
      undoable: !e.undoneAt && (e.kind === "note" || (e.kind === "status" && !movedSince(e, app.status))),
    }));
    if (posting?.jobId && posting.closed) {
      // Discover's closing, as a neutral fact: it says nothing about the Application's Status.
      timeline.unshift({
        id: `posting-closed:${posting.jobId}`, at: posting.closed.at, kind: "posting-closed", cause: "apply-kit", from: null, to: null,
        text: "Posting closed",
        detail: `${posting.closed.how}. That's normal once a job stops taking applications, and says nothing about you. The saved copy stays on the Job page.`,
        undoneAt: null, undoable: false,
      });
    }
    timeline.sort((a, b) => b.at.localeCompare(a.at)); // stable: same-time Events stay newest first
    return {
      ...app, statusSince: standing.filter((e) => e.kind === "created" || e.kind === "status").at(-1)?.at ?? app.lastEvent.at, cvVersion: str(row(applicationId)?.cv_version), cv: cvOf(applicationId), posting, contacts: contactsOf(applicationId), steps: stepsOf(app, standing), nextStep: nextStepOf(app, standing), timeline,
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
      `SELECT at FROM application_event WHERE application_id = ? AND kind = 'status' AND undone_at IS NULL AND to_status = ?
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

  return {
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
    stats: async () => computeStats(db, today()),
  };
}

/** The calendar day in Sofia (YYYY-MM-DD). */
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
