// Per-sender parsers for job-alert emails. Each knows how to recognise its sender's emails, which
// links point at jobs (with the job's stable id and canonical link, tracking parameters dropped),
// and how to read company, location and pay from the lines under each job.
import type { AlertEmail } from "../../ports.ts";
import { type JobCard, type JobLink, salaryLine, splitCompanyLine } from "./cards.ts";
import { unwrapRedirect } from "./html.ts";

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

const jobsbg: AlertSender = {
  name: "jobs.bg alerts",
  isFrom: ({ address }) => /@(\w+\.)*jobs\.bg$/i.test(address),
  jobLink(href) {
    const m = /^https?:\/\/(?:www\.)?jobs\.bg\/job\/(\d{4,})/i.exec(unwrapRedirect(href));
    return m ? { id: m[1]!, url: `https://www.jobs.bg/job/${m[1]}` } : null;
  },
  // Card: company, then location, then pay when stated.
  readCard({ lines }) {
    const salary = salaryLine(lines);
    const rest = lines.filter((l) => l !== salary);
    return { company: rest[0] ?? null, location: rest[1] ?? null, salary };
  },
};

const google: AlertSender = {
  name: "Google Careers alerts",
  // Only the careers alerts: Google sends plenty of other mail (security alerts, account notices).
  isFrom: ({ address, name }) => /@(\w+\.)*google\.com$/i.test(address) && /careers/i.test(`${name} ${address}`),
  jobLink(href) {
    const m = /^https?:\/\/(?:www\.)?google\.com\/about\/careers\/applications\/jobs\/results\/((\d+)[\w-]*)/i.exec(unwrapRedirect(href));
    return m ? { id: m[2]!, url: `https://www.google.com/about/careers/applications/jobs/results/${m[1]}` } : null;
  },
  readCard: ({ lines }) => ({ ...splitCompanyLine(lines[0]), salary: salaryLine(lines.slice(1)) }),
};

const workday: AlertSender = {
  name: "Workday job alerts",
  isFrom: ({ address }) => /@(\w+\.)*myworkday(jobs)?\.com$/i.test(address),
  // {tenant}.wdN.myworkdayjobs.com/[locale/]{site}/job/{location}/{slug}_{requisition id}
  jobLink(href) {
    const m = /^https?:\/\/([\w-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)\/job\/([^?#]+)_([\w-]+?)(?:[/?#]|$)/.exec(unwrapRedirect(href));
    if (!m) return null;
    const [, host, site, path, req] = m;
    return { id: `${host!.toLowerCase()}/${site}/${req}`, url: `https://${host}/${site}/job/${path}_${req}` };
  },
  // The email comes from the employer's own Workday ("Tailspin Systems <tailspin@myworkday.com>").
  readCard({ lines }, email) {
    const location = lines.find((l) => !/^(R-?\d|JR\d|REQ|posted\b)/i.test(l)) ?? null;
    const company = parseFrom(email.from).name.replace(/\s+(via|through)\s+workday$/i, "").trim() || null;
    return { company, location, salary: salaryLine(lines) };
  },
};

export const senders = { linkedin, jobsbg, google, workday } satisfies Record<string, AlertSender>;

export type SenderKey = keyof typeof senders;

/** "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>" → its address and display name. */
export function parseFrom(from: string): { address: string; name: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { name: m[1]!.trim(), address: m[2]!.trim().toLowerCase() };
  return { name: "", address: from.trim().toLowerCase() };
}
