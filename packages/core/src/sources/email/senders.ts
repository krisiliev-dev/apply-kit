// Per-sender parsers for job-alert emails. Each knows how to recognise its sender's emails, which
// links point at jobs (with the job's stable id and canonical link, tracking parameters dropped),
// and how to read company, location and pay from the lines under each job.
import type { AlertEmail } from "../../ports.ts";
import { type JobCard, type JobLink, salaryLine, splitCompanyLine } from "./cards.ts";

export interface CardFacts {
  company: string | null;
  location: string | null;
  salary: string | null;
}

export interface AlertSender {
  /** Default Source name. */
  name: string;
  /** Whether an email came from this sender, by its From header ("Name <address>"). */
  isFrom(from: { address: string; name: string }): boolean;
  jobLink: JobLink;
  readCard(card: JobCard, email: AlertEmail): CardFacts;
}

const linkedin: AlertSender = {
  name: "LinkedIn job alerts",
  isFrom: ({ address }) => /@(\w+\.)*linkedin\.com$/i.test(address),
  jobLink(href) {
    const m = /^https?:\/\/(?:[\w-]+\.)*linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i.exec(href);
    return m ? { id: m[1]!, url: `https://www.linkedin.com/jobs/view/${m[1]}/` } : null;
  },
  readCard(card) {
    return { ...splitCompanyLine(card.lines[0]), salary: salaryLine(card.lines.slice(1)) };
  },
};

export const senders = { linkedin } satisfies Record<string, AlertSender>;

export type SenderKey = keyof typeof senders;

/** "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>" → its address and display name. */
export function parseFrom(from: string): { address: string; name: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { name: m[1]!.trim(), address: m[2]!.trim().toLowerCase() };
  return { name: "", address: from.trim().toLowerCase() };
}
