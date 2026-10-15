import { describe, expect, it } from "vitest";
import {
  blindSheet, formatTailoringReport, readVerdicts, runTailoringEvaluation, tailoringProfileSchema, type EvaluationCase, type TailoredCv, type TailoringCase, type TailoringProfile, type Writer, type WrittenLetter,
} from "../src/index.ts";
import { createTestPreparation, fakeWriter, templateRenderer, type RecordedOutputs } from "./preparation-harness.ts";

// The tailoring evaluation (#69): the writer runs over fictional profiles and real postings through
// the preparation engine, as packages are written, and the report counts what the honesty validator
// refused and flagged, stock phrases, length, page fit and cost. Tested here at the engine seam with
// the fake writer and recorded-style outputs; the real writer only runs in `pnpm eval:tailoring`.

/** Mira Petrova: a made-up security analyst. */
const mira: TailoringProfile = tailoringProfileSchema.parse({
  id: "mira-security",
  fictional: true,
  contact: { nameLatin: "Mira Petrova", nameCyrillic: "Мира Петрова", email: "mira.petrova@example.com", phone: "+359 88 000 0175", city: "Sofia", country: "Bulgaria", links: [] },
  angles: [{ angle: "security", summary: "Security analyst at a bank, writing detection rules." }],
  pieces: [
    { key: "analyst", kind: "role", text: "", entry: { title: "Security Analyst", organisation: "Northwind Bank", city: "Sofia", start: "2022-03", end: null }, tags: ["SOC"], angles: ["security"] },
    { key: "detections", kind: "achievement", text: "Wrote 30 detection rules that cut false alerts by a quarter.", belongsTo: "analyst", tags: ["SIEM"], angles: ["security"], numberSource: "measured" },
    { key: "phishing", kind: "achievement", text: "Ran the response to a phishing campaign against the claims team.", belongsTo: "analyst", tags: ["incident response"], angles: ["security"] },
    { key: "wazuh", kind: "skill", text: "Wazuh", tags: ["SIEM"], angles: ["security"] },
  ],
});

/** A made-up posting in the extraction set's shape. */
const kestrel: EvaluationCase = {
  id: "en-security-kestrel",
  field: "security",
  source: { kind: "greenhouse", url: "https://job-boards.greenhouse.io/kestrel/jobs/4410", fetchedOn: "2026-10-12" },
  input: { title: "Security Engineer", company: "Kestrel Payments", location: "Sofia", text: "Triage SIEM alerts. Incident response. Wazuh." },
  expected: {
    language: "en",
    requirements: [{ text: "Experience triaging alerts in a SIEM", kind: "required" }, { text: "Incident response", kind: "required" }, { text: "Kubernetes", kind: "required" }],
    years: [], languages: [], certificates: [], visaSponsorship: "not-stated", remote: { mode: "hybrid", locations: ["Sofia"] }, salary: null,
  },
};

const cases: TailoringCase[] = [{ id: "mira-kestrel", profile: mira, posting: kestrel, questions: [{ question: "Why Kestrel Payments?", maxWords: 120 }] }];

const id = (input: { pieces: { id: string; text: string; kind: string }[] }, text: string) => input.pieces.find((p) => p.text === text || (p.kind === "role" && text === "role"))!.id;

/** A tailored CV that invents Kubernetes in one bullet and makes another stronger than its piece. */
const tailorCv: RecordedOutputs["tailorCv"] = (input) => ({
  summary: { text: "Security analyst who writes SIEM detection rules and runs incident response.", pieceIds: [id(input, mira.pieces[1]!.text)], claim: "reworded", why: "", honest: null },
  roles: [{
    pieceId: id(input, "role"), title: "Security Analyst", employer: "Northwind Bank", start: "2022-03", end: null, why: "",
    bullets: [
      { text: "Wrote 30 detection rules for Kubernetes clusters that cut false alerts by a quarter", pieceIds: [id(input, mira.pieces[1]!.text)], claim: "reworded", why: "", honest: null },
      { text: "Led the response to a phishing campaign against the claims team", pieceIds: [id(input, mira.pieces[2]!.text)], claim: "stronger", why: "", honest: "Ran the incident response to a phishing campaign against the claims team" },
    ],
  }],
  skills: [{ text: "Wazuh", pieceIds: [id(input, "Wazuh")] }],
  evidence: [{ requirement: 0, pieceIds: [id(input, mira.pieces[1]!.text)] }],
  notes: [],
} satisfies TailoredCv);

/** An answer that keeps to the detections piece. */
const draftAnswer: RecordedOutputs["draftAnswer"] = (input) => ({
  text: "Kestrel Payments triages SIEM alerts, and I wrote 30 detection rules that cut false alerts by a quarter.",
  pieceIds: [id(input, mira.pieces[1]!.text)], claim: "reworded", honest: null, companySpecific: true,
});

const letter = (body: string): WrittenLetter => ({
  greeting: "Dear Kestrel Payments hiring team,",
  paragraphs: [{ sentences: [
    { text: "Every false alert in a payments SOC costs an analyst's time.", forCompany: true, pieceIds: [] },
    { text: body, forCompany: false, pieceIds: [] },
  ] }],
  closing: "Kind regards,",
});

function engineWith(capUsd?: number) {
  const engines: ReturnType<typeof createTestPreparation>[] = [];
  return {
    engines,
    engine: (writer: Writer, budgetUsd: number) => {
      const t = createTestPreparation({ writer, capUsd: capUsd ?? budgetUsd, renderer: templateRenderer() });
      engines.push(t);
      return { preparation: t.preparation, now: () => t.clock.now() };
    },
  };
}

describe("the tailoring evaluation, package by package", () => {
  it("writes a package per case through the engine and reports every refused line, the flags, stock phrases, length, page fit and cost", async () => {
    const writer = fakeWriter({ tailorCv, draftAnswer, writeLetter: letter("I am passionate about detection work, and I wrote 30 detection rules that cut false alerts by a quarter.") });
    const { engine } = engineWith();

    const report = await runTailoringEvaluation({ cases, models: [{ model: "fake/flash", writer }], engine, leftUsd: () => 10 });

    expect(report.packages).toHaveLength(1);
    const p = report.packages[0]!;
    expect(p).toMatchObject({ caseId: "mira-kestrel", profile: "mira-security", posting: "en-security-kestrel", model: "fake/flash", language: "en", status: "written" });
    expect(p.rejected).toEqual([{
      where: "Bullet under Northwind Bank",
      line: "Wrote 30 detection rules for Kubernetes clusters that cut false alerts by a quarter",
      problems: ["names \"Kubernetes\", which isn't in your profile"],
    }]);
    expect(p.flags.map((f) => f.kind).sort()).toEqual(["gap", "near-the-line"]);
    expect(p.stock).toEqual([{ phrase: "passionate", in: "Cover letter", text: "I am passionate about detection work, and I wrote 30 detection rules that cut false alerts by a quarter." }]);
    expect(p.cv).toMatchObject({ pages: 1, linesOnPage2: 0 });
    expect(p.letter).toMatchObject({ words: 30, target: 220, pages: 1 });
    expect(p.letter!.checks.map((c) => `${c.state}: ${c.id}`)).toContain("warning: stock");
    expect(p.answers).toEqual([expect.objectContaining({ question: "Why Kestrel Payments?", drafted: true, limit: "120 words", overLimit: false })]);
    // Every call the writer made is in the cost: the CV, the letter, the form's answers and the case's question.
    expect(p.costUsd).toBeCloseTo(0.002 * writer.calls.length, 6);
    expect(writer.calls.map((c) => c.task)).toEqual(expect.arrayContaining(["tailor-cv", "write-letter", "draft-answer"]));
    expect(report.costUsd).toBeCloseTo(p.costUsd, 6);
  });
});

describe("the budget, failures and the summary per model", () => {
  it("spends only what is left of the month's budget: a package that would cross it isn't written, and says so", async () => {
    const writer = fakeWriter({ tailorCv, draftAnswer, writeLetter: letter("I wrote 30 detection rules.") });

    const report = await runTailoringEvaluation({ cases, models: [{ model: "fake/flash", writer }], engine: engineWith().engine, leftUsd: () => 0 });

    const p = report.packages[0]!;
    expect(writer.calls).toHaveLength(0);
    expect(p.costUsd).toBe(0);
    expect(p.missing.map((m) => `${m.part}: ${m.state}`)).toEqual(expect.arrayContaining(["CV version: not-written", "Cover letter: not-written"]));
    expect(p.answers[0]).toMatchObject({ question: "Why Kestrel Payments?", drafted: false });
  });

  it("reports a part the writer failed (after the engine's retry) without stopping the run", async () => {
    const writer = fakeWriter({ tailorCv: new Error("The model's answer didn't fit the schema"), draftAnswer, writeLetter: letter("I wrote 30 detection rules.") });

    const report = await runTailoringEvaluation({ cases, models: [{ model: "fake/flash", writer }], engine: engineWith().engine, leftUsd: () => 10 });

    const p = report.packages[0]!;
    expect(p.status).toBe("written");
    expect(p.missing).toEqual([expect.objectContaining({ part: "CV version", state: "failed", why: expect.stringContaining("didn't fit the schema") })]);
    expect(p.rejected).toEqual([]);
  });

  it("writes the same inputs with each model and sums them up per model", async () => {
    const flash = fakeWriter({ tailorCv, draftAnswer, writeLetter: letter("I am passionate about detection work.") });
    const strong = fakeWriter({ tailorCv, draftAnswer, writeLetter: letter("I wrote 30 detection rules that cut false alerts by a quarter.") }, { costUsd: 0.01 });

    const report = await runTailoringEvaluation({
      cases: [...cases, { ...cases[0]!, id: "mira-kestrel-again" }],
      models: [{ model: "fake/flash", writer: flash }, { model: "fake/strong", writer: strong }],
      engine: engineWith().engine, leftUsd: () => 10,
    });

    expect(report.packages.map((p) => `${p.caseId} · ${p.model}`)).toEqual([
      "mira-kestrel · fake/flash", "mira-kestrel · fake/strong", "mira-kestrel-again · fake/flash", "mira-kestrel-again · fake/strong",
    ]);
    const [a, b] = report.summaries;
    expect(a).toMatchObject({ model: "fake/flash", packages: 2, written: 2, rejected: 2, rejectedBy: { "names something not in the profile": 2 }, stockPhrases: 2, cvOnOnePage: 2, letters: 2, lettersNearTarget: 0 });
    expect(b).toMatchObject({ model: "fake/strong", packages: 2, stockPhrases: 0 });
    expect(b!.costUsd).toBeGreaterThan(a!.costUsd);
    expect(report.costUsd).toBeCloseTo(a!.costUsd + b!.costUsd, 6);
  });
});

describe("the report and the blind comparison sheet", () => {
  async function twoModels() {
    const flash = fakeWriter({ tailorCv, draftAnswer, writeLetter: letter("I am passionate about detection work.") });
    const strong = fakeWriter({ tailorCv, draftAnswer, writeLetter: letter("I wrote 30 detection rules that cut false alerts by a quarter.") }, { costUsd: 0.01 });
    return runTailoringEvaluation({
      cases: [...cases, { ...cases[0]!, id: "mira-kestrel-again" }],
      models: [{ model: "fake/flash", writer: flash }, { model: "fake/strong", writer: strong }],
      engine: engineWith().engine, leftUsd: () => 10,
    });
  }

  it("reads as a report: the summary per model, then every package with each refused line in full and why", async () => {
    const report = await twoModels();

    const md = formatTailoringReport(report, { startedAt: "2026-10-15T09:30:00.000Z" });

    expect(md).toContain("# Tailoring evaluation");
    expect(md).toMatch(/\| Lines the honesty validator refused \| 2 \| 2 \|/);
    expect(md).toMatch(/\| Stock phrases \| 2 \| 0 \|/);
    expect(md).toMatch(/\| CV on one page \| 2 of 2 \| 2 of 2 \|/);
    expect(md).toContain("### mira-kestrel · Security Engineer at Kestrel Payments · English · mira-security");
    expect(md).toContain("#### fake/flash");
    expect(md).toContain("- Bullet under Northwind Bank: \"Wrote 30 detection rules for Kubernetes clusters that cut false alerts by a quarter\": names \"Kubernetes\", which isn't in your profile.");
    expect(md).toContain("- \"passionate\" in Cover letter: \"I am passionate about detection work.\"");
  });

  it("shows both versions of each package unlabelled, in an order only the key knows", async () => {
    const report = await twoModels();
    const flips = [0.9, 0.1];

    const { sheet, key } = blindSheet(report, () => flips.shift()!);

    expect(sheet).not.toMatch(/fake\/flash|fake\/strong/);
    expect(key.cases).toEqual([
      { caseId: "mira-kestrel", A: "fake/strong", B: "fake/flash" },
      { caseId: "mira-kestrel-again", A: "fake/flash", B: "fake/strong" },
    ]);
    // Case 1: the stronger model's letter is Version A.
    const first = sheet.slice(sheet.indexOf("## Case 1"), sheet.indexOf("## Case 2"));
    expect(first.indexOf("I wrote 30 detection rules that cut false alerts by a quarter.")).toBeLessThan(first.indexOf("I am passionate about detection work."));
    expect(first).toContain("Verdict (A, B or same):");
  });

  it("records the verdicts only once every case has one, then says which model each preferred", async () => {
    const report = await twoModels();
    const { sheet, key } = blindSheet(report, () => 0.9);
    const fill = (text: string, ...answers: [string, string][]) => {
      let i = 0;
      return text.replace(/^Verdict \(A, B or same\):.*\nWhy:.*$/gm, (m) => {
        const a = answers[i++];
        return a ? `Verdict (A, B or same): ${a[0]}\nWhy: ${a[1]}` : m;
      });
    };

    const half = readVerdicts(fill(sheet, ["A", "Plainer"]), key);
    expect(half).toEqual({ complete: false, missing: ["Case 2 (mira-kestrel-again)"], unreadable: [] });

    const odd = readVerdicts(fill(sheet, ["A", "Plainer"], ["maybe", ""]), key);
    expect(odd).toEqual({ complete: false, missing: [], unreadable: ["Case 2 (mira-kestrel-again): \"maybe\""] });

    const done = readVerdicts(fill(sheet, ["a", "Plainer, no stock phrases"], ["same", "Both fine"]), key);
    expect(done).toEqual({
      complete: true,
      verdicts: [
        { caseId: "mira-kestrel", job: "Security Engineer at Kestrel Payments", choice: "A", preferred: "fake/strong", why: "Plainer, no stock phrases" },
        { caseId: "mira-kestrel-again", job: "Security Engineer at Kestrel Payments", choice: "same", preferred: null, why: "Both fine" },
      ],
      tally: { "fake/flash": 0, "fake/strong": 1, same: 1 },
    });
    const md = formatTailoringReport(report, { startedAt: "2026-10-15T09:30:00.000Z", verdicts: done.complete ? done : undefined });
    expect(md).toContain("## Your verdicts");
    expect(md).toContain("fake/strong preferred 1 · fake/flash preferred 0 · the same 1");
  });
});
