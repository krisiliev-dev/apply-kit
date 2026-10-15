// The template's own words per language: section titles, dates and the letter's fixed lines.
// Bulgarian packages are written in Bulgarian, not English with Bulgarian headings (DESIGN.md › Documents).
import type { DocumentDate, DocumentLanguage, MonthYear } from "./content.ts";

export type CvSection = "summary" | "experience" | "skills" | "education" | "languages";

/** The CV's sections in their fixed order: the AI can't rename, add or reorder them. */
export const cvSections: readonly CvSection[] = ["summary", "experience", "skills", "education", "languages"];

export const sectionTitles: Record<DocumentLanguage, Record<CvSection, string>> = {
  en: { summary: "Summary", experience: "Experience", skills: "Skills", education: "Education", languages: "Languages and courses" },
  bg: { summary: "Профил", experience: "Професионален опит", skills: "Умения", education: "Образование", languages: "Езици и курсове" },
};

const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthsLong: Record<DocumentLanguage, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  bg: ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"],
};

const presentWord: Record<DocumentLanguage, string> = { en: "present", bg: "досега" };

/** "Jan 2023" in English, "01.2023" in Bulgarian; a year alone as the year; loose text as it is. */
export function formatDate(date: DocumentDate | "present", language: DocumentLanguage): string {
  if (date === "present") return presentWord[language];
  if ("text" in date) return date.text;
  const { year, month } = date as MonthYear;
  if (!month) return String(year);
  return language === "bg" ? `${String(month).padStart(2, "0")}.${year}` : `${monthsShort[month - 1]} ${year}`;
}

export function formatRange(start: DocumentDate, end: DocumentDate | "present", language: DocumentLanguage): string {
  return `${formatDate(start, language)} – ${formatDate(end, language)}`;
}

/** The letter's date line: "13 October 2026", "13 октомври 2026 г.". */
export function formatLetterDate(isoDay: string, language: DocumentLanguage): string {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  const month = monthsLong[language][m - 1];
  return language === "bg" ? `${d} ${month} ${y} г.` : `${d} ${month} ${y}`;
}

/** The letter's fixed lines, filled by the template, never by the model. */
export const letterLabels: Record<DocumentLanguage, { recipient: string; re: string }> = {
  en: { recipient: "Hiring team", re: "Re:" },
  bg: { recipient: "Екип по подбор", re: "Относно:" },
};
