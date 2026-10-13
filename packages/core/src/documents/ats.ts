// The ATS check (spec #51): reads a CV's extracted text the way an applicant tracking system does
// and passes or fails each check on its own, with the problem in plain words. No overall score.
// Pure: the service extracts the text locally (pdf.js); no model and no third party sees the CV.
import type { CvContent, DocumentToRender } from "./content.ts";
import { hasPhrase, words } from "../words.ts";
import { cvSections, sectionTitles, type CvSection } from "./labels.ts";
import type { PdfText } from "../preparation/ports.ts";

export type AtsCheckId =
  | "text-based" | "single-column" | "contact" | "sections" | "dates" | "pages" | "keywords" | "bullets" | "summary" | "file-name";

/** A posting keyword the CV should contain; a deliberate gap (with why) passes. */
export interface AtsKeyword {
  term: string;
  /** Set when Kris chose to leave it out (a gap named in the letter, say): the reason, shown with the pass. */
  gap?: string;
}

/** Longest bullet and summary the template allows, in characters. */
export const BULLET_MAX = 160;
export const SUMMARY_MAX = 400;

export interface AtsCheckResult {
  check: AtsCheckId;
  passed: boolean;
  /** Why it failed, one line per problem, naming the role or field. */
  problems: string[];
  /** Things that passed on purpose (a deliberate gap) and why. */
  notes: string[];
}

export interface AtsInput {
  /** The text read back from the PDF. */
  text: PdfText;
  /** The CV the PDF was rendered from: what the parser should find. */
  document: Extract<DocumentToRender, { kind: "cv" }>;
  fileName: string;
  /** The target posting's keywords (none yet before tailoring). */
  keywords?: AtsKeyword[];
}

export interface AtsCheck {
  checks: AtsCheckResult[];
}

const normalise = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

const monthNames: Record<string, number> = {};
[
  ["jan", "january", "яну", "януари"], ["feb", "february", "фев", "февруари"], ["mar", "march", "мар", "март"],
  ["apr", "april", "апр", "април"], ["may", "май"], ["jun", "june", "юни"], ["jul", "july", "юли"],
  ["aug", "august", "авг", "август"], ["sep", "sept", "september", "сеп", "септември"],
  ["oct", "october", "окт", "октомври"], ["nov", "november", "ное", "ноември"], ["dec", "december", "дек", "декември"],
].forEach((names, i) => names.forEach((n) => (monthNames[n] = i + 1)));

const present = new Set(["present", "now", "current", "today", "досега", "сега", "настояще", "понастоящем"]);

/** Whether one end of a date range reads as a month and year (or "present"). */
function isMonthYear(part: string): boolean {
  const p = part.toLowerCase().replace(/\.$/, "").trim();
  if (present.has(p)) return true;
  if (/^(0?[1-9]|1[0-2])[./](19|20)\d\d$/.test(p)) return true;
  if (/^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(p)) return true;
  const named = /^(\p{L}+)\.? ((19|20)\d\d)$/u.exec(p);
  return !!named && monthNames[named[1]!] !== undefined;
}

function readsAsMonths(dates: string): boolean {
  const parts = dates.split(/\s+[–—-]\s+|[–—]/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 1 && parts.length <= 2 && parts.every(isMonthYear);
}

function datesCheck(lines: string[], input: AtsInput): AtsCheckResult {
  const problems: string[] = [];
  for (const role of input.document.content.experience) {
    const heading = `${role.title} · ${role.employer}`;
    const at = lines.findIndex((l) => l.startsWith(heading));
    if (at < 0) {
      problems.push(`${heading}: the role's line wasn't found in the text`);
      continue;
    }
    let rest = lines[at]!.slice(heading.length);
    if (role.place && rest.startsWith(`, ${role.place}`)) rest = rest.slice(role.place.length + 2);
    // A long title wraps the dates onto the next line.
    const dates = normalise(rest) || normalise(lines[at + 1] ?? "");
    if (!readsAsMonths(dates)) problems.push(`${heading}: “${dates}” isn't a month and year`);
  }
  return result("dates", problems);
}

const result = (check: AtsCheckId, problems: string[], notes: string[] = []): AtsCheckResult =>
  ({ check, passed: problems.length === 0, problems, notes });

const digits = (s: string) => s.replace(/\D/g, "");

function contactCheck(lines: string[], input: AtsInput): AtsCheckResult {
  const text = lines.join("\n").toLowerCase();
  const { name, email, phone, links } = input.document.content.letterhead;
  const problems: string[] = [];
  if (!text.includes(name.toLowerCase())) problems.push(`Name not found: ${name}`);
  if (!text.includes(email.toLowerCase())) problems.push(`Email not found: ${email}`);
  if (phone && !digits(lines.join("")).includes(digits(phone))) problems.push(`Phone not found: ${phone}`);
  for (const link of links) if (!text.includes(link.toLowerCase())) problems.push(`Link not found: ${link}`);
  return result("contact", problems);
}

/** The sections the template prints for this content (an empty section is left out). */
function sectionsOf(content: CvContent): CvSection[] {
  const present: Record<CvSection, boolean> = {
    summary: content.summary.trim() !== "",
    experience: content.experience.length > 0,
    skills: content.skills.length > 0,
    education: content.education.length > 0,
    languages: content.languagesAndCourses.length > 0,
  };
  return cvSections.filter((s) => present[s]);
}

const fold = (s: string) => s.toLocaleLowerCase("bg");

function sectionChecks(lines: string[], input: AtsInput): AtsCheckResult[] {
  const titles = sectionTitles[input.document.language];
  const expected = sectionsOf(input.document.content);
  const folded = lines.map(fold);
  // A heading on a line of its own is a section start; a heading inside a longer line means text
  // from side-by-side columns was read across as one line.
  const at = new Map(expected.map((s) => [s, folded.indexOf(fold(titles[s]))]));
  const missing = expected.filter((s) => at.get(s)! < 0);
  const merged = expected.filter((s) => at.get(s)! < 0 && folded.some((l) => l.split(" · ").length === 1 && l.includes(fold(titles[s])) && l !== fold(titles[s])));

  const columns: string[] = merged.map((s) => `“${titles[s]}” is read inside another line, as text from side-by-side columns is`);
  const found = expected.filter((s) => at.get(s)! >= 0);
  for (let j = 1; j < found.length; j++) {
    const early = found.slice(0, j).find((s) => at.get(found[j]!)! < at.get(s)!);
    if (early) columns.push(`Sections read out of order: ${titles[found[j]!]} before ${titles[early]}`);
  }
  return [
    result("single-column", columns),
    result("sections", missing.map((s) => `Section heading not found: ${titles[s]}`)),
  ];
}

function keywordsCheck(lines: string[], keywords: AtsKeyword[]): AtsCheckResult {
  const text = words(lines.join("\n"));
  const problems: string[] = [];
  const notes: string[] = [];
  for (const k of keywords) {
    if (hasPhrase(text, k.term)) continue;
    if (k.gap) notes.push(`${k.term}: ${k.gap}`);
    else problems.push(`Posting keyword not found: ${k.term}`);
  }
  return result("keywords", problems, notes);
}

function bulletsCheck(content: CvContent): AtsCheckResult {
  const problems = content.experience.flatMap((role) => role.bullets
    .filter((b) => b.length > BULLET_MAX)
    .map((b) => `${role.title} · ${role.employer}: a bullet is ${b.length} characters (${BULLET_MAX} at most)`));
  return result("bullets", problems);
}

function summaryCheck(content: CvContent): AtsCheckResult {
  const n = content.summary.trim().length;
  return result("summary", n > SUMMARY_MAX ? [`The summary is ${n} characters (${SUMMARY_MAX} at most)`] : []);
}

/** ASCII letters, digits, "_", "-" and "." only, ending in .pdf, so every portal accepts it. */
const asciiFileName = /^[A-Za-z0-9_.-]+\.pdf$/;

export function checkAts(input: AtsInput): AtsCheck {
  const pages = input.text.pages.map((p) => p.lines.map(normalise).filter(Boolean));
  const lines = pages.flat();
  const later = pages.slice(1).reduce((n, p) => n + p.length, 0);
  const [singleColumn, sections] = sectionChecks(lines, input);
  return {
    checks: [
      result("text-based", lines.length === 0 ? ["No text could be read: the PDF is an image"] : []),
      singleColumn!,
      contactCheck(lines, input),
      sections!,
      datesCheck(lines, input),
      result("pages", pages.length > 1 ? [`${pages.length} pages · ${later} lines on page${pages.length > 2 ? "s" : ""} ${pages.length > 2 ? `2–${pages.length}` : "2"}`] : []),
      keywordsCheck(lines, input.keywords ?? []),
      bulletsCheck(input.document.content),
      summaryCheck(input.document.content),
      result("file-name", asciiFileName.test(input.fileName) ? [] : [`The file name “${input.fileName}” should be ASCII letters, digits and underscores, ending in .pdf`]),
    ],
  };
}
