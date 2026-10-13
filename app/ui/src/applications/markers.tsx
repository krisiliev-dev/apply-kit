// Track inside Discover screens (hi-fi applications.html "On Feed and Job", job.html "Applied before"):
// what a Feed row and the Job page say about Applications. The tracker decides which Applications
// count (this Job's, the same company within 6 months); these only say it.
import type { ApplicationMarker, JobMarker } from "@apply-kit/core";
import { shortDay, statusLabel, todaySofia } from "./words.ts";

/** Where one Application opens. */
export const applicationHref = (id: string) => `/applications#app-${encodeURIComponent(id)}`;

/** The Status pill for this Job's Application: "Applied 7 Oct", or "Applied 7 Oct · Screening". */
export function AppliedPill({ application }: { application: ApplicationMarker }) {
  const s = application.status;
  return (
    <span className={`status ${s}`}>
      <i aria-hidden="true" />Applied {shortDay(application.appliedOn)}{s !== "applied" && ` · ${statusLabel[s]}`}
    </span>
  );
}

/** Another Application at the same company, in words: "Kestrel rejected you 18 Jun · SOC Analyst". */
export function sameCompanyText(m: ApplicationMarker): string {
  if (m.status === "rejected") return `${m.company} rejected you ${m.closedOn ? shortDay(m.closedOn) : `(applied ${shortDay(m.appliedOn)})`} · ${m.title}`;
  if (m.status === "withdrawn") return `You withdrew from ${m.company} ${m.closedOn ? shortDay(m.closedOn) : `(applied ${shortDay(m.appliedOn)})`} · ${m.title}`;
  return `Applied to ${m.company} ${shortDay(m.appliedOn)} · ${m.title} · ${statusLabel[m.status]}`;
}

/** A Feed row's line: this Job's Application with a link to it, else a recent one at the same company. */
export function FeedMarker({ marker, tabIndex, jobName }: { marker: JobMarker | undefined; tabIndex: number; jobName: string }) {
  if (!marker) return null;
  const { application, sameCompany } = marker;
  if (application) {
    return (
      <div className="chips marker">
        <AppliedPill application={application} />
        <a className="mini" href={applicationHref(application.id)} tabIndex={tabIndex}>
          Open application<span className="sr-only">: {jobName}</span>
        </a>
      </div>
    );
  }
  if (!sameCompany) return null;
  return <div className="chips marker"><span className="chip applied">{sameCompanyText(sameCompany)}</span></div>;
}

/** "4 months ago", "2 weeks ago", "3 days ago", "today": how long ago a day was. */
export function agoWords(day: string, today = todaySofia()): string {
  const days = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  const months = Math.round(days / 30.4);
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}

/** "Wed 7 Oct": the weekday and date, for a banner. */
export function weekdayDay(day: string): string {
  return new Date(`${day}T12:00:00Z`)
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .replace("Sept", "Sep");
}
