import type { Piece } from "./html.ts";

/** One job as an alert email shows it: the link to the job, its title, and the short lines under it. */
export interface JobCard {
  id: string;
  url: string;
  title: string;
  lines: string[];
}

/** Recognises a link to a job on this sender's site: the job's stable id and canonical link, or null. */
export type JobLink = (href: string) => { id: string; url: string } | null;

const maxLines = 6;

/**
 * Groups an email's pieces into job cards. A card starts at a job link (logo and title links to the
 * same job share one card) and collects the text lines after it until the next link to anything else.
 * A job listed twice in one email gives one card.
 */
export function jobCards(pieces: Piece[], jobLink: JobLink): JobCard[] {
  const cards = new Map<string, JobCard>();
  let current: JobCard | null = null;
  for (const p of pieces) {
    if (p.kind === "line") {
      if (current && current.lines.length < maxLines) current.lines.push(p.text);
      continue;
    }
    const job = jobLink(p.href);
    if (!job) { current = null; continue; }
    const existing = cards.get(job.id);
    if (existing && existing !== current) { current = null; continue; }
    current = existing ?? { ...job, title: "", lines: [] };
    cards.set(job.id, current);
    if (!current.title && p.text) current.title = p.text;
  }
  return [...cards.values()].filter((c) => c.title);
}

const salaryLike = /(\d[\d\s.,]*\s?k?\s*(€|eur|bgn|лв|usd|\$|£|gbp|chf))|((€|\$|£)\s?\d)|заплата/i;

/** The first line that states pay, or null. */
export function salaryLine(lines: string[]): string | null {
  return lines.find((l) => salaryLike.test(l)) ?? null;
}

/** "Company · Location" (or "Company | Location") split in two; location is null if there's no separator. */
export function splitCompanyLine(line: string | undefined): { company: string | null; location: string | null } {
  if (!line) return { company: null, location: null };
  const parts = line.split(/\s+[·|•]\s+/);
  return { company: parts[0]!.trim() || null, location: parts.slice(1).join(" · ").trim() || null };
}
