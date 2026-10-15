// The CV version of a package (ticket #63): the master profile's CV for the angle (the baseline),
// and every change tailoring made to it, each with what was, what is, why and its own Undo. The CV
// is the baseline with the changes that aren't undone applied in order, so undoing any one of them
// restores exactly what it replaced. Changes refer to pieces by id, never to positions. Also the
// ways to tighten a CV that runs onto a second page, each one more change. Pure.
import type { RequirementStatus } from "../extraction/reading.ts";
import type { HonestyRule, ValidatedCv } from "./honesty.ts";
import { quoteOf } from "./honesty.ts";
import type { ProfilePiece } from "./profile.ts";

/** A line on the CV and the pieces it relies on (at least one). */
export interface PlanLine {
  text: string;
  pieceIds: string[];
}

/** A bullet: the piece it is, and the line as written. */
export interface PlanBullet extends PlanLine {
  pieceId: string;
}

/** What the CV says, by piece: the template adds the roles' and education's facts from the profile. */
export interface CvPlan {
  summary: PlanLine | null;
  roles: { roleId: string; bullets: PlanBullet[] }[];
  /** Skill piece ids, in order. */
  skills: string[];
  /** Education piece ids, newest first. */
  education: string[];
}

interface ChangeBase {
  id: string;
  /** From the writer's tailoring, or a way Kris chose to fit one page. */
  origin: "tailoring" | "tightening";
  undone: boolean;
  /** "Summary rewritten", "Bullet moved to the top". */
  label: string;
  /** The words before and after, for a change of words. */
  was: string | null;
  is: string | null;
  /** What moved or went, in a sentence, for a change of order or length. */
  detail: string | null;
  why: string;
}

export type CvChange = ChangeBase & (
  | { kind: "summary"; line: PlanLine }
  | { kind: "reword"; pieceId: string; line: PlanLine }
  | { kind: "add"; roleId: string; bullet: PlanBullet }
  | { kind: "order"; roleId: string; order: string[] }
  | { kind: "drop"; roleId: string; pieceIds: string[] }
  | { kind: "skills"; skills: string[] }
);

/** What a package keeps about its CV version, beside the writer's raw output. */
export interface CvVersionState {
  changes: CvChange[];
  keepTwoPages: boolean;
  /** Usable pieces the writer cited per requirement (by index). */
  evidence: ValidatedCv["evidence"];
  /** The writer's tailoring notes, then the validator's. */
  notes: string[];
  caught: Record<HonestyRule, number>;
  heldBack: number;
}

/** The baseline with the changes that aren't undone applied, in order. */
export function applyChanges(base: CvPlan, changes: readonly CvChange[]): CvPlan {
  const plan: CvPlan = {
    summary: base.summary && { ...base.summary },
    roles: base.roles.map((r) => ({ roleId: r.roleId, bullets: r.bullets.map((b) => ({ ...b })) })),
    skills: [...base.skills],
    education: [...base.education],
  };
  for (const c of changes) {
    if (c.undone) continue;
    const role = "roleId" in c ? plan.roles.find((r) => r.roleId === c.roleId) : undefined;
    switch (c.kind) {
      case "summary":
        plan.summary = { ...c.line };
        break;
      case "reword":
        for (const r of plan.roles) for (const b of r.bullets) if (b.pieceId === c.pieceId) Object.assign(b, c.line);
        break;
      case "add":
        if (role && !role.bullets.some((b) => b.pieceId === c.bullet.pieceId)) role.bullets.push({ ...c.bullet });
        break;
      case "order":
        if (role) {
          const rank = (b: PlanBullet) => (c.order.includes(b.pieceId) ? c.order.indexOf(b.pieceId) : c.order.length);
          role.bullets = role.bullets.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i).map((x) => x.b);
        }
        break;
      case "drop":
        if (role) role.bullets = role.bullets.filter((b) => !c.pieceIds.includes(b.pieceId));
        break;
      case "skills":
        plan.skills = [...c.skills];
        break;
    }
  }
  return plan;
}

const same = (a: string, b: string) => a.trim().replace(/\.$/, "") === b.trim().replace(/\.$/, "");
const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;
const bullets = (n: number) => `${n} ${n === 1 ? "bullet" : "bullets"}`;

/**
 * The changes tailoring made: the summary, then per role its reworded and added bullets, the new
 * order and the bullets left out, then the skills. `newId` names each change.
 */
export function deriveChanges(base: CvPlan, validated: ValidatedCv, pieces: ReadonlyMap<string, ProfilePiece>, newId: () => string): CvChange[] {
  const out: CvChange[] = [];
  const common = { origin: "tailoring" as const, undone: false, was: null, is: null, detail: null };

  const summary = validated.summary;
  if (summary && !(base.summary && same(base.summary.text, summary.text))) {
    out.push({
      ...common, id: newId(), kind: "summary", line: { text: summary.text, pieceIds: summary.pieceIds },
      label: base.summary ? "Summary rewritten" : "Summary written", was: base.summary?.text ?? null, is: summary.text,
      why: summary.why || "Leads with what the posting asks for first.",
    });
  }

  for (const role of validated.roles) {
    const baseRole = base.roles.find((r) => r.roleId === role.pieceId);
    const entry = pieces.get(role.pieceId)?.entry;
    if (!baseRole || !entry) continue;
    const seen = new Set<string>();
    const drafted = role.bullets.filter((b) => !seen.has(b.pieceIds[0]!) && seen.add(b.pieceIds[0]!));
    for (const b of drafted) {
      const pieceId = b.pieceIds[0]!;
      const was = baseRole.bullets.find((x) => x.pieceId === pieceId);
      if (!was) {
        out.push({
          ...common, id: newId(), kind: "add", roleId: role.pieceId, bullet: { pieceId, text: b.text, pieceIds: b.pieceIds },
          label: "Bullet added", is: b.text, detail: `Under ${entry.organisation}, from your profile.`, why: b.why || "From your profile; it fits this posting.",
        });
      } else if (!same(was.text, b.text)) {
        out.push({
          ...common, id: newId(), kind: "reword", pieceId, line: { text: b.text, pieceIds: b.pieceIds },
          label: "Bullet reworded", was: was.text, is: b.text, why: b.why || "Worded for this posting.",
        });
      }
    }
    const order = drafted.map((b) => b.pieceIds[0]!);
    const kept = baseRole.bullets.map((b) => b.pieceId).filter((id) => order.includes(id));
    const keptInDraft = order.filter((id) => kept.includes(id));
    if (keptInDraft.join() !== kept.join()) {
      const first = drafted.find((b) => b.pieceIds[0] === keptInDraft[0])!;
      const top = keptInDraft[0] !== kept[0];
      out.push({
        ...common, id: newId(), kind: "order", roleId: role.pieceId, order,
        label: top ? "Bullet moved to the top" : "Bullets reordered",
        detail: top ? `"${first.text}" is now the first bullet under ${entry.organisation}.` : `The bullets under ${entry.organisation} are in a new order.`,
        why: role.why || "The strongest match for the posting first.",
      });
    }
    const dropped = baseRole.bullets.filter((b) => !order.includes(b.pieceId)).map((b) => b.pieceId);
    if (dropped.length) {
      const before = baseRole.bullets.length + drafted.filter((b) => !baseRole.bullets.some((x) => x.pieceId === b.pieceIds[0])).length;
      out.push({
        ...common, id: newId(), kind: "drop", roleId: role.pieceId, pieceIds: dropped,
        label: `${entry.title} role shortened`, detail: `${bullets(before)} → ${before - dropped.length}. The role and dates stay.`,
        why: role.why || "Less relevant to this posting.",
      });
    }
  }

  if (validated.skills.length && validated.skills.join() !== base.skills.join()) {
    const name = (id: string) => pieces.get(id)?.text ?? "";
    const left = base.skills.filter((id) => !validated.skills.includes(id)).map(name);
    out.push({
      ...common, id: newId(), kind: "skills", skills: validated.skills, label: "Skills reordered",
      detail: `${validated.skills.slice(0, 3).map(name).join(", ")} first${left.length ? `; ${left.join(", ")} left out of this CV` : ""}.`,
      why: "Matching skills first. Nothing added that isn't in your profile.",
    });
  }
  return out;
}

// ---------------------------------------------------------------- one page

/** About how many lines a bullet or summary takes in the template. */
const lineCount = (text: string) => Math.max(1, Math.ceil(text.length / 95));

export interface TightenChoice {
  id: string;
  label: string;
  meta: string;
}

export const keepTwoPages = "keep-two-pages";

/**
 * Ways to bring a CV back to one page, never by shrinking type or margins: shorten the least
 * relevant role to its title and dates, drop the summary's second sentence, leave out the last
 * bullet of the longest role; or keep two pages.
 */
export function tightenChoices(plan: CvPlan, pieces: ReadonlyMap<string, ProfilePiece>, angle: string): TightenChoice[] {
  const out: TightenChoice[] = [];
  const entry = (id: string) => pieces.get(id)?.entry;
  const relevance = (id: string) => (pieces.get(id)?.angles.includes(angle as never) ? 1 : 0);
  const older = plan.roles.slice(1).filter((r) => r.bullets.length > 0 && entry(r.roleId))
    .sort((a, b) => relevance(a.roleId) - relevance(b.roleId) || (entry(a.roleId)!.end ?? "9999").localeCompare(entry(b.roleId)!.end ?? "9999"));
  const least = older[0];
  if (least) {
    const n = least.bullets.reduce((s, b) => s + lineCount(b.text), 0);
    out.push({ id: `shorten-role:${least.roleId}`, label: `Shorten the ${entry(least.roleId)!.title} role to its title and dates`, meta: `Saves about ${lines(n)}. Least relevant to this posting.` });
  }
  const sentences = plan.summary ? splitSentences(plan.summary.text) : [];
  if (sentences.length >= 2) {
    out.push({ id: "summary-first-sentence", label: "Drop the summary's second sentence", meta: `Saves about ${lines(lineCount(sentences.slice(1).join(" ")))}. The first sentence stays: "${quoteOf(sentences[0]!)}".` });
  }
  const longest = [...plan.roles].filter((r) => r.bullets.length >= 2).sort((a, b) => b.bullets.length - a.bullets.length)[0];
  if (longest && entry(longest.roleId)) {
    const last = longest.bullets.at(-1)!;
    out.push({ id: `drop-bullet:${last.pieceId}`, label: `Leave out the last bullet under ${entry(longest.roleId)!.organisation}`, meta: `Saves about ${lines(lineCount(last.text))}: "${quoteOf(last.text)}".` });
  }
  out.push({ id: keepTwoPages, label: "Keep 2 pages", meta: "Some recruiters skip page 2. The ATS check will say so." });
  return out;
}

const splitSentences = (text: string) => text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];

/** The change a tightening choice makes, or null when the choice isn't one of `choices`. */
export function tightenChange(choiceId: string, plan: CvPlan, pieces: ReadonlyMap<string, ProfilePiece>, newId: () => string): CvChange | null {
  const common = { id: newId(), origin: "tightening" as const, undone: false, was: null, is: null, detail: null };
  const at = choiceId.indexOf(":");
  const [kind, id] = at === -1 ? [choiceId, undefined] : [choiceId.slice(0, at), choiceId.slice(at + 1)];
  if (kind === "shorten-role" && id) {
    const role = plan.roles.find((r) => r.roleId === id);
    const entry = pieces.get(id)?.entry;
    if (!role || !entry) return null;
    return {
      ...common, kind: "drop", roleId: id, pieceIds: role.bullets.map((b) => b.pieceId),
      label: `${entry.title} role shortened to its title and dates`, detail: `${bullets(role.bullets.length)} → 0. The role and dates stay.`,
      why: "To fit one page: least relevant to this posting.",
    };
  }
  if (kind === "summary-first-sentence" && plan.summary) {
    const first = splitSentences(plan.summary.text)[0]!;
    return { ...common, kind: "summary", line: { text: first, pieceIds: plan.summary.pieceIds }, label: "Summary shortened", was: plan.summary.text, is: first, why: "To fit one page." };
  }
  if (kind === "drop-bullet" && id) {
    const role = plan.roles.find((r) => r.bullets.some((b) => b.pieceId === id));
    const bullet = role?.bullets.find((b) => b.pieceId === id);
    const entry = role && pieces.get(role.roleId)?.entry;
    if (!role || !bullet || !entry) return null;
    return { ...common, kind: "drop", roleId: role.roleId, pieceIds: [id], label: "Bullet left out", was: bullet.text, detail: `Under ${entry.organisation}.`, why: "To fit one page." };
  }
  return null;
}

// ---------------------------------------------------------------- views

export interface PieceLink {
  id: string;
  label: string;
}

/** A line as the CV shows it, linked to the pieces it relies on. */
export interface CvLineView {
  text: string;
  pieces: PieceLink[];
}

export interface EvidenceRow {
  requirement: string;
  kind: "required" | "preferred";
  status: RequirementStatus;
  /** The evidence matcher's pieces, then the ones the writer cited. */
  pieces: PieceLink[];
  note: string;
  /** Where those pieces are on this CV ("Bullet 2 under Northwind Bank"), or why they aren't. */
  onCv: string[];
}

/** Where pieces show on the CV: the summary, a bullet, a role's line, the skills or education. */
export function placesOnCv(ids: readonly string[], plan: CvPlan, pieces: ReadonlyMap<string, ProfilePiece>): string[] {
  const out: string[] = [];
  if (plan.summary && plan.summary.pieceIds.some((id) => ids.includes(id))) out.push("Summary");
  for (const role of plan.roles) {
    const entry = pieces.get(role.roleId)?.entry;
    role.bullets.forEach((b, i) => { if (b.pieceIds.some((id) => ids.includes(id))) out.push(`Bullet ${i + 1} under ${entry?.organisation ?? "a role"}`); });
    if (ids.includes(role.roleId) && entry) out.push(`${entry.title} role, with its dates`);
  }
  if (plan.skills.some((id) => ids.includes(id))) out.push("Skills");
  if (plan.education.some((id) => ids.includes(id))) out.push("Education");
  return out;
}

export type HonestyCheckState = "ok" | "fixed" | "line" | "gap";

/** One line of the honesty summary beside the CV. States never only by colour: each has its words. */
export interface HonestyCheckView {
  id: string;
  state: HonestyCheckState;
  label: string;
  detail: string | null;
}

/** The hard rules (each ok, or fixed when the draft broke it), then preferred items left out, held-back wordings and gaps. */
export function honestyChecks(state: CvVersionState, evidence: readonly EvidenceRow[]): HonestyCheckView[] {
  const { caught } = state;
  const rule = (id: string, label: string, n: number, detail: string): HonestyCheckView =>
    ({ id, state: n ? "fixed" : "ok", label, detail: n ? detail : null });
  const out: HonestyCheckView[] = [
    rule("roles", "Employers, titles and dates match your master profile", caught.role, `The draft changed ${caught.role}; the CV keeps your profile's.`),
    rule("skills", "No skill that isn't in your profile", caught.skill, `The draft named ${caught.skill} that aren't; they were left out.`),
    rule("numbers", "Every number traces to a piece with its source", caught.number, `The draft had ${caught.number} that didn't; your profile's wording is used.`),
    rule("citations", "Every line links to a piece in your profile", caught.citation, `The draft had ${caught.citation} that didn't; they were left out or use your profile's wording.`),
  ];
  evidence.forEach((e, i) => { if (e.status === "not-held") out.push({ id: `not-held:${i}`, state: "ok", label: `${e.requirement} left out, not claimed`, detail: null }); });
  if (state.heldBack) {
    out.push({ id: "held-back", state: "line", label: `${state.heldBack === 1 ? "1 stronger wording" : `${state.heldBack} stronger wordings`} held back`, detail: "Your profile's words are used until you decide." });
  }
  evidence.forEach((e, i) => { if (e.status === "gap") out.push({ id: `gap:${i}`, state: "gap", label: `Gap: ${e.requirement}, no evidence in your profile`, detail: "Left off the CV." }); });
  return out;
}
