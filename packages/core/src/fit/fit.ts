// Fit: a 0–100 number for how well a Job matches Kris's profile and preferences, always with the
// reasons behind it. Pure: the engine gathers the inputs. Every tunable number is in weights.ts.
//
// Honesty rules: a part that can't be determined (no master profile yet, salary not stated, no
// posting date) is left out and the other parts rescaled, so an unknown never counts as a gap.
import type { RequirementStatus, Screening } from "../extraction/reading.ts";
import { formatSalary } from "../extraction/reading.ts";
import { NOT_STATED, placeOf, type Place } from "../locations.ts";
import type { SearchSettings } from "../search-settings.ts";
import { phrasesIn, words } from "../words.ts";
import { angleKeywords, angleLabel, angles, type Angle } from "./angles.ts";
import { eurPer, fitWeights, perMonth } from "./weights.ts";

export type FitPart = "requirements" | "angle" | "location" | "salary" | "freshness";

export interface FitReason {
  /** Which part of the Fit this is; "adjustment" is a learned ranking adjustment (#15). */
  factor: FitPart | "adjustment";
  /** Short name of the part, e.g. "Requirements", "Angle". */
  label: string;
  /** What was found, in plain words, e.g. "Sofia · hybrid", "Salary not stated". */
  text: string;
  /** How well this part matches, 0–1; null when it can't be determined (then it is left out). */
  score: number | null;
  /** The part's share in the Fit before rescaling (weights.ts); 0 for adjustments. */
  weight: number;
  /** What this reason adds to the Fit. The points of all reasons add up to the Fit. */
  points: number;
}

/** A learned ranking adjustment that applies to a Job (#15 creates them; none exist yet). */
export interface FitAdjustment {
  id: string;
  /** Said in the why-line and the reasons, e.g. "ranked lower: you passed 2 similar bank roles". */
  text: string;
  /** Points added to (or, when negative, taken from) the Fit. */
  points: number;
}

export type FitBand = "strong" | "good" | "stretch";

export interface Fit {
  /** 0–100. */
  value: number;
  /** "Strong" is 85 and up, "good" 70–84, "stretch" below 70. */
  band: FitBand;
  /** True until the posting is read and every fact is confirmed: the Fit may still change. */
  provisional: boolean;
  /** The closest Angle, or null when the job matches none of them. */
  angle: Angle | null;
  /** Where the job is against Kris's location priorities. */
  place: Place;
  /** One line on why the job ranks where it does, for the Feed row. */
  why: string;
  /** Every part of the Fit, in order of weight, then any learned adjustments. */
  reasons: FitReason[];
  /** Required items Kris doesn't meet (empty until there is a master profile). */
  gaps: string[];
}

export interface FitInput {
  title: string;
  /** English title for a posting in another language, if read. */
  titleTranslation: string | null;
  location: string | null;
  postedAt: string | null;
  /** Whether the posting has been read (requirements, salary and remote rules known). */
  read: boolean;
  requirements: { text: string; kind: "required" | "preferred"; status: RequirementStatus }[];
  screening: Screening | null;
  /** How many facts wait for Kris. */
  needsYou: number;
  settings: SearchSettings;
  now: Date;
  /** Learned adjustments that apply to this Job; the hook for #15. */
  adjustments?: FitAdjustment[];
}

const W = fitWeights;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const eur = (n: number) => `€${Math.round(n).toLocaleString("en-GB")}`;

export function computeFit(input: FitInput): Fit {
  const angle = angleOf(input);
  const place = placeOf({ location: input.location, remote: input.screening?.remote ?? null }, input.settings.locations);
  const parts: Omit<FitReason, "points">[] = [
    requirementsReason(input),
    angle.reason,
    locationReason(place),
    salaryReason(input),
    freshnessReason(input),
  ];

  const known = parts.reduce((n, p) => n + (p.score == null ? 0 : p.weight), 0);
  const reasons: FitReason[] = parts.map((p) => ({ ...p, points: p.score == null || known === 0 ? 0 : (100 * p.weight * p.score) / known }));
  for (const a of input.adjustments ?? []) reasons.push({ factor: "adjustment", label: "Learned adjustment", text: a.text, score: null, weight: 0, points: a.points });

  const value = Math.round(Math.min(100, Math.max(0, reasons.reduce((n, r) => n + r.points, 0))));
  const provisional = !input.read || input.needsYou > 0 || input.screening?.provisional === true;
  const gaps = input.requirements.filter((r) => r.kind === "required" && r.status === "gap").map((r) => r.text);

  return {
    value,
    band: value >= W.bands.strong ? "strong" : value >= W.bands.good ? "good" : "stretch",
    provisional,
    angle: angle.best,
    place,
    why: whyLine(input, angle.best, place, parts),
    reasons,
    gaps,
  };
}

function requirementsReason(input: FitInput): Omit<FitReason, "points"> {
  const base = { factor: "requirements" as const, label: "Requirements", weight: W.parts.requirements };
  if (!input.read) return { ...base, text: "Not read yet", score: null };
  const required = input.requirements.filter((r) => r.kind === "required" && r.status !== "unknown");
  if (required.length === 0) {
    const n = input.requirements.length;
    return { ...base, score: null, text: n === 0 ? "None listed" : `${plural(n, "requirement")} read; not checked yet: that needs your master profile` };
  }
  const per = { met: W.requirements.met, partly: W.requirements.partly, gap: W.requirements.gap, unknown: 0 };
  const preferredMet = input.requirements.filter((r) => r.kind === "preferred" && r.status === "met").length;
  const score = clamp01(required.reduce((n, r) => n + per[r.status], 0) / required.length + preferredMet * W.requirements.preferredMetBonus);
  return { ...base, score, text: coverage(input.requirements) };
}

/** "4 of 6 met, 1 partly, 1 gap". Unknown items are counted in the total but never as gaps. */
function coverage(reqs: FitInput["requirements"]): string {
  const n = (s: RequirementStatus) => reqs.filter((r) => r.status === s).length;
  const gaps = reqs.filter((r) => r.status === "gap" && r.kind === "required").length;
  return `${n("met")} of ${reqs.length} met${n("partly") ? `, ${n("partly")} partly` : ""}${gaps ? `, ${plural(gaps, "gap")}` : ""}`;
}

function angleOf(input: FitInput): { best: Angle | null; reason: Omit<FitReason, "points"> } {
  const titleWords = words(`${input.title} ${input.titleTranslation ?? ""}`);
  const reqWords = words(input.requirements.map((r) => r.text).join(" , "));
  const scored = angles.map((angle) => {
    const inTitle = phrasesIn(titleWords, angleKeywords[angle]);
    const inReqs = phrasesIn(reqWords, angleKeywords[angle]).filter((p) => !inTitle.includes(p));
    const score = clamp01((inTitle.length ? W.angle.titleMatch + (inTitle.length - 1) * W.angle.perExtraWord : 0) + inReqs.length * W.angle.perExtraWord);
    return { angle, score, found: [...inTitle, ...inReqs] };
  });
  const top = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const base = { factor: "angle" as const, label: "Angle", weight: W.parts.angle };
  if (top.score === 0) return { best: null, reason: { ...base, score: 0, text: "Not developer, security or design work, going by its title and requirements" } };
  const quoted = top.found.slice(0, 4).map((f) => `“${f}”`).join(", ");
  return { best: top.angle, reason: { ...base, score: top.score, text: `${angleLabel[top.angle]}: ${quoted}` } };
}

function locationReason(place: Place): Omit<FitReason, "points"> {
  const base = { factor: "location" as const, label: "Location", weight: W.parts.location, text: place.label };
  switch (place.tier) {
    case "first": return { ...base, score: W.location.first };
    case "relocation": return { ...base, score: W.location.relocation, text: `${place.label}, a separate, lower-priority list` };
    case "other": return { ...base, score: W.location.other };
    case "unknown": return { ...base, score: place.label === NOT_STATED ? null : W.location.unclear };
  }
}

function salaryReason(input: FitInput): Omit<FitReason, "points"> {
  const base = { factor: "salary" as const, label: "Salary", weight: W.parts.salary };
  const floor = input.settings.minMonthlySalaryEur;
  const s = input.screening?.salary ?? null;
  if (!input.read) return { ...base, score: null, text: "Not read yet" };
  if (!s) return { ...base, score: null, text: "Not stated" };
  const rate = s.currency ? eurPer[s.currency.toUpperCase()] : undefined;
  const factor = s.period ? perMonth[s.period] : undefined;
  const stated = formatSalary(s);
  if (rate == null || factor == null) {
    return { ...base, score: null, text: `${stated}: can't compare with your minimum (${!rate ? "currency" : "period"} unclear)` };
  }
  const low = (s.min ?? s.max)! * rate * factor;
  const high = (s.max ?? s.min)! * rate * factor;
  const net = s.basis === "net" ? " (net)" : "";
  if (low >= floor) return { ...base, score: W.salary.above, text: `${stated}, above your minimum (${eur(floor)}/month)${net}` };
  if (high >= floor) return { ...base, score: W.salary.reaches, text: `${stated}, reaching your minimum (${eur(floor)}/month)${net}` };
  return { ...base, score: W.salary.below, text: `${stated}, below your minimum (${eur(floor)}/month)${net}` };
}

function freshnessReason(input: FitInput): Omit<FitReason, "points"> {
  const base = { factor: "freshness" as const, label: "Freshness", weight: W.parts.freshness };
  if (!input.postedAt) return { ...base, score: null, text: "Posting date unknown" };
  const days = Math.max(0, Math.floor((input.now.getTime() - new Date(input.postedAt).getTime()) / 86_400_000));
  const { freshDays, staleDays } = W.freshness;
  const score = days <= freshDays ? 1 : clamp01(1 - (days - freshDays) / (staleDays - freshDays));
  return { ...base, score, text: days === 0 ? "Posted today" : `Posted ${plural(days, "day")} ago` };
}

function whyLine(input: FitInput, angle: Angle | null, place: Place, parts: Omit<FitReason, "points">[]): string {
  const out: string[] = [angle ? `${angleLabel[angle]} angle` : "No clear angle"];
  const req = parts.find((p) => p.factor === "requirements")!;
  if (!input.read) out.push("not read yet");
  else if (req.score != null) out.push(req.text);
  else if (input.requirements.length) out.push(`${plural(input.requirements.length, "requirement")}, not checked yet`);
  out.push(place.label);
  const salary = parts.find((p) => p.factor === "salary")!;
  if (salary.score != null) {
    out.push(salary.score >= W.salary.above ? "salary above your minimum" : salary.score > W.salary.below ? "salary reaches your minimum" : "salary below your minimum");
  }
  for (const a of input.adjustments ?? []) out.push(a.text);
  if (input.needsYou > 0) out.push(`${input.needsYou === 1 ? "1 fact needs" : `${input.needsYou} facts need`} you, so the Fit is provisional`);
  return out.join(" · ");
}
