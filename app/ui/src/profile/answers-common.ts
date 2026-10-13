// Words for the answer bank's categories, kinds, modes and history (hi-fi: profile.html, Answer bank).
import type { Answer, AnswerCategory, AnswerChange, AnswerKind, AnswerMode } from "@apply-kit/core";
import { answerLanguages } from "@apply-kit/core/answers";

export const categoryLabel: Record<AnswerCategory, string> = { standard: "Standard", screening: "Screening" };
export const kindLabel: Record<AnswerKind, string> = {
  text: "Text", "yes-no": "Yes or no", choice: "A choice from a list", number: "A number", date: "A date", rule: "Worked out by a rule",
};
export const modeLabel: Record<AnswerMode, string> = { fill: "Fill it", ask: "Ask me each time", blank: "Leave it blank" };

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** "EN · BG", or "—" with no version. */
export const languagesOf = (a: Answer) => answerLanguages.filter((l) => a.versions[l]).map((l) => l.toUpperCase()).join(" · ") || "—";

/** What the table says instead of a value for "ask each time" and "leave blank" answers. */
export function modeSummary(a: Answer): string {
  if (a.mode === "ask") return `Ask each time${a.rule ? ` · rule: ${a.rule.text.charAt(0).toLowerCase()}${a.rule.text.slice(1)}` : ""}`;
  if (a.mode === "blank") {
    const required = a.versions.en ?? a.versions.bg;
    return `Leave blank${required ? ` · "${required}" when a portal requires an answer` : ""}`;
  }
  return "";
}

const lower = (where: string) => (where.startsWith("Your ") ? `y${where.slice(1)}` : where);

/** One line of an answer's history: 'Changed from "2 weeks" in Profile'. */
export function changeLine(c: AnswerChange): string {
  const version = c.language === "bg" ? "Bulgarian version" : "English version";
  if (c.event === "created") return c.where;
  if (c.event === "kept-old") return `Kept this over "${c.after}", typed in the ${c.where}`;
  if (c.before === null) return `${version} added in ${lower(c.where)}`;
  if (c.after === null) return `${version} removed in ${lower(c.where)}`;
  return `${c.language === "bg" ? "Bulgarian version changed" : "Changed"} from "${c.before}" in ${c.where === "Profile" || c.where.startsWith("Your ") ? lower(c.where) : `the ${c.where}`}`;
}
