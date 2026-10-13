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
  /** created: the Application was added. status: its Status changed. undo: an earlier Event was undone. */
  kind: "created" | "status" | "undo";
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
    readonly problem: "not-found" | "accepted" | "unchanged" | "already-open" | "changed-since" | "not-undoable",
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
  /** One Application, or null. */
  get(applicationId: string): Promise<ApplicationSummary | null>;
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
    const later = db.prepare(
      `SELECT COUNT(*) AS n FROM application_event WHERE application_id = ? AND undone_at IS NULL AND kind != 'undo' AND rowid > (SELECT rowid FROM application_event WHERE id = ?)`,
    ).get(ev.applicationId, eventId);
    if (Number(later?.n ?? 0) > 0 || (ev.kind === "status" && app.status !== ev.to)) {
      throw new TrackerError("changed-since", "Its Status has changed since, so this can't be undone. Set the Status you want instead.", ev.applicationId);
    }
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE application_event SET undone_at = ? WHERE id = ?").run(now(), eventId);
      let event: ApplicationEvent;
      if (ev.kind === "created") {
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
    get: async (id) => summary(id),
    events: async (id) => db.prepare("SELECT * FROM application_event WHERE application_id = ? ORDER BY at, rowid").all(id).map(eventOf),
    setStatus,
    undoEvent,
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
