// Repeating sections (Workday's Work Experience and Education, ticket #44): which entry on the page
// is which entry of the package's CV, how many entries to add with the portal's own Add control
// (never more than the CV has), the entries the portal added itself when it read the CV that repeat
// a CV entry (reported, removed only on Kris's click), and the value for each field of an entry. Pure.
import type { CvEntryAsSent } from "../preparation/contracts.ts";
import { normaliseLabel } from "./contact.ts";
import type { DuplicateEntry, EntrySection, FieldAnswer, ReadField } from "./reading.ts";

/** A CV entry as the sections fill it: education carries its field of study when the CV names one. */
export type CvEntry = CvEntryAsSent & { field?: string | null };

type Part = "title" | "organisation" | "place" | "start" | "end" | "current" | "description" | "field";

const parts: Record<EntrySection, [Part, RegExp][]> = {
  work: [
    ["current", /currently work/u],
    ["title", /^(job )?title$|^position$|^role$/u],
    ["organisation", /^company|^employer/u],
    ["place", /^location$|^city$/u],
    ["start", /^from$|^start( date)?$/u],
    ["end", /^to\b|^end( date)?$/u],
    ["description", /description|responsibilit/u],
  ],
  education: [
    ["organisation", /school|university|institution|college/u],
    ["title", /^degree$/u],
    ["field", /field of study|major|discipline/u],
    ["start", /^from$|^start|first year/u],
    ["end", /^to\b|^end|last year/u],
  ],
};

const partOf = (f: ReadField, section: EntrySection): Part | null => parts[section].find(([, re]) => re.test(normaliseLabel(f.label)))?.[0] ?? null;
const same = (a: string, b: string) => normaliseLabel(a) !== "" && normaliseLabel(a) === normaliseLabel(b);
const year = (iso: string | null | undefined) => (iso ? iso.slice(0, 4) : "");
const noun = { work: ["role", "roles"], education: ["degree", "degrees"] } as const;

export interface SectionPlan {
  /** The section's own answer (the `repeating` field). */
  section: FieldAnswer | null;
  /** Answers for the fields inside its entries, by field id. */
  fields: Map<string, FieldAnswer>;
}

/** What the page's repeating section `section` gets from the CV's entries `cv`. */
export function planSection(section: EntrySection, fields: ReadField[], cv: CvEntry[]): SectionPlan {
  const own = fields.find((f) => f.kind === "repeating" && f.entry?.section === section) ?? null;
  const byEntry = new Map<number, ReadField[]>();
  for (const f of fields) {
    if (f.kind === "repeating" || f.entry?.section !== section || f.entry.index < 1) continue;
    byEntry.set(f.entry.index, [...(byEntry.get(f.entry.index) ?? []), f]);
  }
  const value = (entry: ReadField[], part: Part) => entry.find((f) => partOf(f, section) === part)?.value.trim() ?? "";

  // Entries that already say something are matched to the CV entry they are (by employer or school,
  // or title); a second entry for an entry already matched is a duplicate. Empty entries take the
  // CV's remaining entries in order.
  const claimed = new Map<number, number>();
  const duplicates: DuplicateEntry[] = [];
  const others = new Set<number>();
  const indexes = [...byEntry.keys()].sort((a, b) => a - b);
  const empty: number[] = [];
  for (const i of indexes) {
    const entry = byEntry.get(i)!;
    const org = value(entry, "organisation");
    const title = value(entry, "title");
    if (!org && !title) { empty.push(i); continue; }
    const matches = cv.map((c, n) => ({ c, n })).filter(({ c }) => same(org, c.organisation) || (!org && same(title, c.title)));
    const free = matches.find(({ n }) => ![...claimed.values()].includes(n));
    if (free) claimed.set(i, free.n);
    else if (matches.length) duplicates.push({ index: i, words: [title, org, value(entry, "start") && `from ${year(value(entry, "start"))}`].filter(Boolean).join(", ") });
    else others.add(i);
  }
  const remaining = cv.map((_, n) => n).filter((n) => ![...claimed.values()].includes(n));
  for (const i of empty) {
    const n = remaining.shift();
    if (n !== undefined) claimed.set(i, n);
  }

  const answers = new Map<string, FieldAnswer>();
  const [one, many] = noun[section];
  for (const i of indexes) {
    for (const f of byEntry.get(i)!) {
      const fieldId = f.id;
      if (duplicates.some((d) => d.index === i)) { answers.set(fieldId, { fieldId, kind: "skip", reason: "Likely a duplicate Workday added when it read your CV" }); continue; }
      if (others.has(i)) { answers.set(fieldId, { fieldId, kind: "skip", reason: `Not one of the ${many} on your CV, so apply-kit left it` }); continue; }
      const n = claimed.get(i);
      if (n === undefined) { answers.set(fieldId, { fieldId, kind: "skip", reason: `Your CV has no more ${many} for this entry` }); continue; }
      answers.set(fieldId, entryAnswer(f, partOf(f, section), cv[n]!));
    }
  }
  const add = Math.max(0, remaining.length);
  return {
    section: own && { fieldId: own.id, kind: "entries", section, add, duplicates, source: "cv-version", basis: `${cv.length} ${cv.length === 1 ? one : many} on the CV in your package` },
    fields: answers,
  };
}

/** One field of an entry, from its CV entry. */
function entryAnswer(f: ReadField, part: Part | null, c: CvEntry): FieldAnswer {
  const fieldId = f.id;
  const fill = (value: string, basis: string | null = null): FieldAnswer => ({ fieldId, kind: "fill", value, source: "cv-version", basis });
  const date = (iso: string) => (f.hint === "year" ? year(iso) : iso.slice(0, 7));
  switch (part) {
    case "title": return fill(c.title);
    case "organisation": return fill(c.organisation);
    case "place": return c.place ? fill(c.place) : { fieldId, kind: "skip", reason: "Your CV names no place for this entry" };
    case "start": return fill(date(c.start));
    case "end": return c.end ? fill(date(c.end)) : { fieldId, kind: "skip", reason: "Your current role has no end date" };
    case "current": return c.end ? { fieldId, kind: "skip", reason: "Not your current role" } : fill("checked", "Your current role");
    case "field": return c.field ? fill(c.field) : { fieldId, kind: "skip", reason: "Your CV names no field of study for this degree" };
    case "description":
      return f.required ? { fieldId, kind: "needs-you", reason: "Workday wants a description of this role", basis: "Your CV, attached above, describes it" } : { fieldId, kind: "skip", reason: "Optional: your CV, attached above, describes the role" };
    default:
      return f.required ? { fieldId, kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null } : { fieldId, kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" };
  }
}
