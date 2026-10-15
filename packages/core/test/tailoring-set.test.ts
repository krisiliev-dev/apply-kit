// The tailoring evaluation set itself (eval/tailoring): fictional profiles only, every case's posting
// in the extraction set, English and Bulgarian, and the whole set runs end to end through the engine
// with the fake writer (a writer that keeps to each piece's own words). Cheap and offline; running
// the real writer over it is a separate, on-demand command (pnpm eval:tailoring).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluationCaseSchema, formatTailoringReport, runTailoringEvaluation, tailoringProfileSchema, tailoringSetSchema,
  type TailorCvInput, type TailoredCv, type TailoringCase, type WriteLetterInput, type WrittenLetter,
} from "../src/index.ts";
import { createTestPreparation, fakeWriter, templateRenderer } from "./preparation-harness.ts";

const root = new URL("../../../eval/", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8")) as unknown;
const profileFiles = readdirSync(new URL("tailoring/profiles/", root)).filter((f) => f.endsWith(".json"));
const profiles = profileFiles.map((f) => ({ file: f, profile: tailoringProfileSchema.parse(read(`tailoring/profiles/${f}`)) }));
const set = tailoringSetSchema.parse(read("tailoring/cases.json"));

const cases: TailoringCase[] = set.cases.map((c) => {
  const posting = evaluationCaseSchema.parse(read(`extraction/postings/${c.posting}.json`));
  return {
    id: c.id,
    profile: profiles.find((p) => p.profile.id === c.profile)!.profile,
    posting,
    questions: c.questions ?? set.questions[posting.expected.language === "bg" ? "bg" : "en"],
  };
});

/** A CV that keeps every piece's own words: what an honest writer would return at the least. */
function ownWords(input: TailorCvInput): TailoredCv {
  const roles = input.pieces.filter((p) => p.kind === "role" && p.entry);
  return {
    summary: { text: input.angle.summary, pieceIds: input.pieces.filter((p) => p.kind === "achievement").slice(0, 1).map((p) => p.id), claim: "reworded", why: "", honest: null },
    roles: roles.map((r) => ({
      pieceId: r.id, title: r.entry!.title, employer: r.entry!.organisation, start: r.entry!.start, end: r.entry!.end, why: "",
      bullets: input.pieces.filter((p) => p.belongsTo === r.id && p.kind === "achievement").map((p) => ({ text: p.text, pieceIds: [p.id], claim: "as-written" as const, why: "", honest: null })),
    })),
    skills: input.pieces.filter((p) => p.kind === "skill").map((p) => ({ text: p.text, pieceIds: [p.id] })),
    evidence: [],
    notes: [],
  };
}

const plainLetter = (input: WriteLetterInput): WrittenLetter => ({
  greeting: input.language === "bg" ? "Здравейте," : `Dear ${input.posting.company} hiring team,`,
  paragraphs: [{ sentences: input.cv.lines.slice(0, 3).map((l) => ({ text: l.text.replace(/\.?$/, "."), forCompany: false, pieceIds: l.pieceIds })) }],
  closing: input.language === "bg" ? "Поздрави," : "Kind regards,",
});

describe("the tailoring evaluation set", () => {
  it.each(profiles)("$file is a fictional profile named after its id, with example.com contact details only", ({ file, profile }) => {
    expect(file).toBe(`${profile.id}.json`);
    expect(profile.fictional).toBe(true);
    expect(profile.contact.email).toMatch(/@example\.com$/);
    for (const link of profile.contact.links) expect(new URL(link).hostname).toMatch(/(^|\.)example\.com$/);
    // No email address anywhere but the contact's own.
    const text = JSON.stringify({ ...profile, contact: null });
    expect(text, file).not.toMatch(/[\w.%+-]+@[\w-]+\.[\w.-]+/);
  });

  it("tailors each angle's profile to English and Bulgarian postings from the extraction set", () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.filter((c) => c.posting.expected.language === "bg").length).toBeGreaterThanOrEqual(3);
    expect(new Set(cases.map((c) => c.posting.field))).toEqual(new Set(["dev", "security", "design"]));
    for (const p of profiles) expect(cases.some((c) => c.profile.id === p.profile.id), p.file).toBe(true);
  });

  it("runs end to end through the engine and writes a report: every profile is accepted, every package written", async () => {
    const writer = fakeWriter({
      tailorCv: ownWords,
      writeLetter: plainLetter,
      draftAnswer: (input) => ({ text: input.pieces.find((p) => p.kind === "achievement")!.text, pieceIds: [input.pieces.find((p) => p.kind === "achievement")!.id], claim: "as-written", honest: null, companySpecific: false }),
    });

    const report = await runTailoringEvaluation({
      cases,
      models: [{ model: "fake/writer", writer }],
      engine: (w, budgetUsd) => {
        const t = createTestPreparation({ writer: w, capUsd: budgetUsd, renderer: templateRenderer() });
        return { preparation: t.preparation, now: () => t.clock.now() };
      },
      leftUsd: () => 10,
    });

    expect(report.packages.map((p) => [p.caseId, p.status, p.error])).toEqual(cases.map((c) => [c.id, "written", null]));
    for (const p of report.packages) {
      expect(p.missing, p.caseId).toEqual([]);
      // A writer that keeps to the pieces' own words is never refused.
      expect(p.rejected, p.caseId).toEqual([]);
      expect(p.cv?.pages, p.caseId).toBe(1);
      expect(p.answers.filter((a) => a.drafted).length, p.caseId).toBeGreaterThanOrEqual(2);
    }
    expect(report.packages.filter((p) => p.language === "bg").map((p) => p.caseId)).toEqual(["mira-dsk", "alex-coriti", "nia-a1"]);
    expect(formatTailoringReport(report, { startedAt: "2026-10-16T08:00:00.000Z" })).toContain(`${cases.length} cases`);
  });
});
