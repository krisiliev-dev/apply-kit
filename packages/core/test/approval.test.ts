import { describe, expect, it } from "vitest";
import type { PackageJob, PieceInput } from "../src/index.ts";
import { fixtureFetch } from "./harness.ts";
import { createTestPreparation, fakeWriter, recordedDraftAnswer, recordedLetter, recordedTailoredCv, recordedWhyAnswer, templateRenderer } from "./preparation-harness.ts";

// Step 5 and the finish (ticket #67), through the preparation engine: the ATS check of the CV's
// PDF, approving the package (files frozen by SHA-256), reopening, a profile change to a draft, and
// the contracts Apply and Track read. Made-up people, companies and postings only.

const kestrelQuestions = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs/4410?questions=true";

/** A recorded output with its placeholder ids ("piece-phishing") swapped for the profile's. */
const withIds = <T>(recorded: T, ids: Record<string, string>): T =>
  JSON.parse(JSON.stringify(recorded).replace(/"piece-([a-z]+)"/g, (m, key: string) => (ids[key] ? JSON.stringify(ids[key]) : m))) as T;

type Options = Parameters<typeof createTestPreparation>[0] & { phone?: string };

/** Mira Petrova's made-up master profile and answer bank, with Kestrel's recorded form and a CV that reads like the real template. */
function mira({ phone = "+359 88 000 0175", ...options }: Options = {}) {
  const ids: Record<string, string> = {};
  const writer = fakeWriter({
    tailorCv: () => withIds(recordedTailoredCv, ids),
    writeLetter: () => withIds(recordedLetter, ids),
    draftAnswer: (input) => withIds(/^why/i.test(input.question) ? recordedWhyAnswer : recordedDraftAnswer, ids),
  });
  const t = createTestPreparation({ writer, renderer: templateRenderer(), fetch: fixtureFetch({ [kestrelQuestions]: "greenhouse-kestrel-4410-questions.json" }), ...options });
  const save = (key: string, input: PieceInput) => {
    const r = t.preparation.savePiece(input);
    if (!r.saved) throw new Error(`${key}: ${r.problems[0]!.message}`);
    ids[key] = r.piece.id;
  };
  save("analyst", { kind: "role", text: "", entry: { title: "Security Analyst", organisation: "Northwind Bank", city: "Sofia", start: "2022-03", end: null }, tags: ["SOC"], angles: ["security"] });
  save("detections", { kind: "achievement", text: "Wrote 30 detection rules that cut false alerts by a quarter.", belongsTo: ids.analyst, tags: ["SIEM"], angles: ["security"], numberSource: "measured" });
  save("phishing", { kind: "achievement", text: "Ran the response to a phishing campaign against the claims team.", belongsTo: ids.analyst, tags: ["incident response"], angles: ["security"] });
  save("wazuh", { kind: "skill", text: "Wazuh", tags: ["SIEM"], angles: ["security"] });
  save("degree", { kind: "education", text: "", entry: { title: "BSc Computer Science", organisation: "Danube Institute of Technology", city: "Ruse", start: "2018-09", end: "2022-06" }, angles: ["security", "developer"] });
  t.preparation.saveAngle({ angle: "security", summary: "Security analyst at a bank, writing detection rules." });
  t.preparation.saveContact({
    nameLatin: "Mira Petrova", nameCyrillic: "Мира Петрова", email: "mira.petrova@example.com", phone, city: "Sofia", country: "Bulgaria",
    links: ["https://www.linkedin.com/in/mira-petrova-example"],
  });
  const bank = (input: Parameters<typeof t.preparation.saveAnswer>[0]) => {
    const r = t.preparation.saveAnswer(input);
    if (!r.saved) throw new Error(r.problems[0]!.message);
  };
  bank({ question: "Right to work in Bulgaria", wordings: ["Do you have the right to work in Bulgaria?"], versions: { en: "Yes", bg: "Да" }, category: "standard", kind: "yes-no" });
  bank({ question: "Notice period", wordings: ["What is your notice period?"], versions: { en: "1 month", bg: "1 месец" }, category: "standard" });
  return { ...t, ids };
}

/** A made-up Kestrel Payments job: its Greenhouse page (the target), asking for Wazuh and Kubernetes. */
function kestrelJob(overrides: Partial<PackageJob> = {}): PackageJob {
  return {
    id: "job-kestrel",
    title: "Security Engineer",
    titleTranslation: null,
    company: "Kestrel Payments",
    location: "Sofia",
    packageLanguage: "en",
    closed: null,
    reading: { state: "read" },
    requirements: [{ text: "Experience triaging alerts in a SIEM" }, { text: "Incident response" }, { text: "Wazuh", category: "skill" }],
    screening: { salary: { min: 2800, max: 3600, currency: "EUR", period: "month", basis: "gross" } },
    postings: [
      { id: "posting-gh", site: "job-boards.greenhouse.io", url: "https://job-boards.greenhouse.io/kestrel/jobs/4410", firstSeenAt: "2026-10-10T08:00:00Z", source: { name: "Kestrel Payments", kind: "greenhouse", label: "Greenhouse", category: "ats" } },
    ],
    target: { postingId: "posting-gh" },
    ...overrides,
  };
}

async function started(t: ReturnType<typeof mira>, job = kestrelJob()) {
  const r = t.preparation.startPackage(job);
  if (!r.started) throw new Error(r.reason);
  return (await t.preparation.packageSettled(r.package.id))!;
}

/** Approves steps 1–4 (the salary answered), leaving the ATS check. */
async function upToAts(t: ReturnType<typeof mira>, job = kestrelJob()) {
  const pkg = await started(t, job);
  for (const step of ["target", "cv", "letter"] as const) {
    const r = t.preparation.approveStep(pkg.id, step);
    if (!r.approved) throw new Error(r.reason);
  }
  t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3400");
  const r = t.preparation.approveStep(pkg.id, "answers");
  if (!r.approved) throw new Error(r.reason);
  return r.package;
}

describe("the ATS check (step 5)", () => {
  it("reads the approved CV's PDF the way a parser does: the text in reading order, pass or fail per check, no score", async () => {
    const t = mira();
    const pkg = await upToAts(t);

    expect(pkg.parts[4]).toMatchObject({ part: "ats", state: "done" });
    expect(pkg.steps[4]).toMatchObject({ step: "ats", state: "current", blocked: null });
    expect(pkg.ats!.passing).toBe(pkg.ats!.checks.length);
    expect(pkg.ats!.checks.map((c) => [c.check, c.passed])).toContainEqual(["keywords", true]);
    expect(pkg.ats!.lines.slice(0, 3).map((l) => l.text)).toEqual([
      "Mira Petrova", "Security Analyst", "Sofia, Bulgaria · mira.petrova@example.com · +359 88 000 0175 · www.linkedin.com/in/mira-petrova-example",
    ]);
    expect(pkg.ats!.lines.every((l) => l.lost === null)).toBe(true);
  });
});

describe("approving the package", () => {
  it("waits while a check fails, naming it, until Kris accepts the failing check knowingly", async () => {
    const t = mira();
    // Python is in the profile, but only on the developer angle: this security CV doesn't print it.
    t.preparation.savePiece({ kind: "skill", text: "Python", tags: ["scripting"], angles: ["developer"] });
    const pkg = await upToAts(t, kestrelJob({ requirements: [{ text: "Incident response" }, { text: "Python", category: "skill" }] }));

    expect(pkg.ats!.checks.find((c) => c.check === "keywords")).toMatchObject({ passed: false, problems: ["Posting keyword not found: Python"] });
    expect(pkg.steps[4]).toMatchObject({ state: "current", sub: "1 check fails", blocked: "1 check fails: posting keywords found. Fix it, or approve knowing it fails." });
    const refused = await t.preparation.approvePackage(pkg.id);
    expect(refused).toMatchObject({ approved: false, blockedBy: "ats", reason: "1 check fails: posting keywords found. Fix it, or approve knowing it fails." });

    const approved = await t.preparation.approvePackage(pkg.id, { acceptFailingChecks: true });

    expect(approved).toMatchObject({ approved: true, package: { ats: { accepted: ["keywords"] }, chip: { kind: "ready", label: "Package ready" } } });
    expect(approved.package.steps.every((s) => s.approvedAt !== null)).toBe(true);
  });

  it("counts a gap Kris chose to leave out as a deliberate pass, with the reason", async () => {
    const t = mira();
    const job = kestrelJob({ requirements: [{ text: "Incident response" }, { text: "Kubernetes", category: "skill" }] });
    const pkg = await started(t, job);
    const gap = pkg.cvVersion!.flags.find((f) => f.kind === "gap")!;
    await t.preparation.decideFlag(pkg.id, gap.id, { option: "leave-out" });

    const ready = await upToAts(t, job);

    expect(ready.ats!.checks.find((c) => c.check === "keywords")).toMatchObject({ passed: true, notes: ["Kubernetes: a deliberate gap, left out"] });
    expect(await t.preparation.approvePackage(ready.id)).toMatchObject({ approved: true });
  });
});
