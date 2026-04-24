import type { CvDocument } from "@/lib/doc/types";
import type { Experience } from "@/lib/types";
import { cvs } from "@/content/cvs";
import type {
  TenureExperienceSummary,
  TenurePatternWarning,
  TenureReport,
} from "./types";

// ————————————————————————————————————————————————
// Tenure-pattern inspector.
//
// Input: a CvDocument. If `doc.slug` matches a registered CV variant we use
// the typed Experience[] directly (cleanest, has real start/end). Otherwise
// we best-effort parse experience groups out of node names using the seed
// convention — every seeded CV puts role + dates under names like
// `Exp:<company> role` and `Exp:<company> dates`.
//
// Tenure rules:
//   • Two consecutive experiences both <12 months → consecutive-short-tenure
//   • Overall avg tenure across last 4 experiences <18 months → overall-short-tenure
//   • End → next start gap of >3 months → gap
//
// Returns a 0–100 score with a fuzz penalty per warning.
//
// Scope limitation: we parse years ("2022"), year-month ("2022-05"), and the
// literal "present". Other freeform strings come through as null months and
// don't contribute to averages or adjacency checks (they're ignored, not
// counted against). Keeps false-positives low on CVs with unusual date styles.
// ————————————————————————————————————————————————

const NOW = (): { year: number; month: number } => {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

export function inspectTenure(doc: CvDocument): TenureReport {
  const experiences = resolveExperiences(doc);
  const summaries = experiences.map(toSummary);

  const parseable = summaries.filter(
    (s): s is TenureExperienceSummary & { tenureMonths: number } =>
      s.tenureMonths !== null,
  );
  const averageTenureMonths =
    parseable.length > 0
      ? Math.round(
          parseable.reduce((a, b) => a + b.tenureMonths, 0) / parseable.length,
        )
      : null;

  const warnings: TenurePatternWarning[] = [];

  // Rule 1 — two consecutive sub-12-month stints.
  for (let i = 1; i < summaries.length; i++) {
    const a = summaries[i - 1];
    const b = summaries[i];
    if (a.tenureMonths === null || b.tenureMonths === null) continue;
    if (a.tenureMonths < 12 && b.tenureMonths < 12) {
      warnings.push({
        kind: "consecutive-short-tenure",
        message: `Two consecutive stints under a year: ${a.company} (${a.tenureMonths}mo) and ${b.company} (${b.tenureMonths}mo).`,
        experienceIndexes: [i - 1, i],
      });
    }
  }

  // Rule 2 — avg tenure across last 4 experiences <18 months.
  const lastFour = parseable.slice(0, Math.min(4, parseable.length));
  if (lastFour.length >= 3) {
    const avg =
      lastFour.reduce((a, b) => a + b.tenureMonths, 0) / lastFour.length;
    if (avg < 18) {
      warnings.push({
        kind: "overall-short-tenure",
        message: `Average tenure across the last ${lastFour.length} roles is ${Math.round(avg)} months — below the 18-month threshold recruiters often use as a pattern-flag.`,
        experienceIndexes: lastFour
          .map((s) => summaries.indexOf(s))
          .filter((i) => i >= 0),
      });
    }
  }

  // Rule 3 — gaps >3 months between end[i-1] and start[i]. Assumes the
  // experiences are listed most-recent-first (the seeded convention), so for
  // gap math we iterate back-to-front and treat `earlier.end → later.start`.
  let hasGaps = false;
  for (let i = 0; i < summaries.length - 1; i++) {
    const later = summaries[i];
    const earlier = summaries[i + 1];
    if (earlier.endMonth === null || later.startMonth === null) continue;
    const gap = later.startMonth - earlier.endMonth;
    if (gap > 3) {
      hasGaps = true;
      warnings.push({
        kind: "gap",
        message: `${gap}-month gap between ${earlier.company} (ended ${formatMonth(earlier.endMonth)}) and ${later.company} (started ${formatMonth(later.startMonth)}).`,
        experienceIndexes: [i + 1, i],
      });
    }
  }

  // Fuzz scoring. Starts at 100; each warning docks points by severity.
  let score = 100;
  for (const w of warnings) {
    if (w.kind === "consecutive-short-tenure") score -= 25;
    else if (w.kind === "overall-short-tenure") score -= 20;
    else if (w.kind === "gap") score -= 8;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    experiences: summaries,
    averageTenureMonths,
    hasGaps,
    warnings,
    score,
  };
}

// ————————————————————————————————————————————————
// Experience resolution
// ————————————————————————————————————————————————

function resolveExperiences(doc: CvDocument): Experience[] {
  const fromRegistry = cvs[doc.slug]?.experiences;
  if (fromRegistry && fromRegistry.length > 0) return fromRegistry;
  return parseExperiencesFromNodes(doc);
}

// Best-effort fallback — parses nodes grouped under `Exp:<company>` naming.
// Matches the seed convention in `lib/doc/seed.ts`.
function parseExperiencesFromNodes(doc: CvDocument): Experience[] {
  const buckets = new Map<
    string,
    { role?: string; dates?: string; company: string }
  >();

  for (const page of doc.pages) {
    for (const n of page.nodes) {
      if (n.type !== "text" || n.hidden) continue;
      const name = n.name ?? "";
      const m = /^Exp:([^\s]+(?:\s[^\s]+)*?)\s+(role|dates|summary|bullet)\b/i.exec(
        name,
      );
      if (!m) continue;
      const company = m[1];
      const kind = m[2].toLowerCase();
      const bucket = buckets.get(company) ?? { company };
      if (kind === "role") bucket.role = n.content;
      if (kind === "dates") bucket.dates = n.content;
      buckets.set(company, bucket);
    }
  }

  const out: Experience[] = [];
  for (const b of buckets.values()) {
    const { start, end } = parseDateRange(b.dates ?? "");
    out.push({
      role: extractRoleFromLine(b.role ?? "", b.company),
      company: b.company,
      dates: { start, end },
    });
  }
  return out;
}

function extractRoleFromLine(line: string, company: string): string {
  // Seeded format is "<role> · <company>" — split and drop the company half.
  const idx = line.indexOf("·");
  if (idx >= 0) return line.slice(0, idx).trim();
  return line.replace(company, "").trim() || "Role";
}

// Accepts "2022", "2022-05", "May 2022", "05/2022", "present".
// Returns a "YYYY" or "YYYY-MM" form the Experience type accepts.
//
// Date-range separators: em-dash, en-dash, "to", or a hyphen surrounded by
// whitespace. A bare `-` is NOT a separator because YYYY-MM uses it.
function parseDateRange(raw: string): { start: string; end: string | "present" } {
  const parts = raw.split(/\s*(?:—|–|to)\s*|\s+-\s+/).map((s) => s.trim());
  const start = normalizeDate(parts[0] ?? "") ?? "";
  const endRaw = normalizeDate(parts[1] ?? "");
  const end: string | "present" =
    /present|current/i.test(parts[1] ?? "") || endRaw === null
      ? "present"
      : endRaw;
  return { start, end };
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/present|current/i.test(trimmed)) return "present";
  // YYYY
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  // YYYY-MM or YYYY/MM
  const ym = /^(\d{4})[-/](\d{1,2})$/.exec(trimmed);
  if (ym) return `${ym[1]}-${ym[2].padStart(2, "0")}`;
  // MM/YYYY or MM-YYYY
  const my = /^(\d{1,2})[-/](\d{4})$/.exec(trimmed);
  if (my) return `${my[2]}-${my[1].padStart(2, "0")}`;
  // "May 2022"
  const m = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(trimmed);
  if (m) {
    const month = monthNameToNumber(m[1]);
    if (month !== null) return `${m[2]}-${String(month).padStart(2, "0")}`;
  }
  return null;
}

function monthNameToNumber(name: string): number | null {
  const names = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const i = names.indexOf(name.toLowerCase());
  if (i >= 0) return i + 1;
  const shorts = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const j = shorts.indexOf(name.toLowerCase().slice(0, 3));
  return j >= 0 ? j + 1 : null;
}

// ————————————————————————————————————————————————
// Summary + month math
// ————————————————————————————————————————————————

function toSummary(exp: Experience): TenureExperienceSummary {
  const start = parseToEpochMonth(exp.dates.start);
  const end =
    exp.dates.end === "present"
      ? epochMonthFromYM(NOW())
      : parseToEpochMonth(exp.dates.end);
  const tenure = start !== null && end !== null ? Math.max(0, end - start) : null;
  return {
    role: exp.role,
    company: exp.company,
    startMonth: start,
    endMonth: end,
    tenureMonths: tenure,
  };
}

function parseToEpochMonth(raw: string): number | null {
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) {
    return epochMonthFromYM({ year: Number(raw), month: 1 });
  }
  const ym = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (ym) {
    return epochMonthFromYM({ year: Number(ym[1]), month: Number(ym[2]) });
  }
  const normalized = normalizeDate(raw);
  if (normalized && normalized !== raw) return parseToEpochMonth(normalized);
  return null;
}

function epochMonthFromYM({ year, month }: { year: number; month: number }): number {
  return year * 12 + (month - 1);
}

function formatMonth(epoch: number): string {
  const year = Math.floor(epoch / 12);
  const month = (epoch % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}
