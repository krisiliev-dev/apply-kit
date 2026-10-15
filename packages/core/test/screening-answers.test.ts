import { describe, expect, it } from "vitest";
import type { DraftAnswerInput, DraftedAnswer, PackageJob, PieceInput } from "../src/index.ts";
import { fixtureFetch } from "./harness.ts";
import { createTestPreparation, fakeWriter, recordedDraftAnswer, recordedWhyAnswer } from "./preparation-harness.ts";

// Step 4 of a package, screening answers (ticket #66), through the preparation engine: the target
// posting's questions in the form's order, each answered from the answer bank, adapted, newly
// drafted or left for Kris, and the drafter Apply uses. Made-up people, companies and postings only.

const kestrelQuestions = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs/4410?questions=true";

/** The recorded drafts with their placeholder ids ("piece-phishing") swapped for the profile's. */
function withIds(answer: DraftedAnswer, ids: Record<string, string>): DraftedAnswer {
  return JSON.parse(JSON.stringify(answer).replace(/"piece-([a-z]+)"/g, (m, key: string) => (ids[key] ? JSON.stringify(ids[key]) : m))) as DraftedAnswer;
}

/** The writer's draft for a question: "Why …?" is written for the company; anything else is the incident answer. */
const recordedFor = (ids: Record<string, string>) => (input: DraftAnswerInput) =>
  withIds(/^why/i.test(input.question) ? recordedWhyAnswer : recordedDraftAnswer, ids);

type Options = Parameters<typeof createTestPreparation>[0] & { draft?: (input: DraftAnswerInput, ids: Record<string, string>) => DraftedAnswer | Error };

/** Mira Petrova's made-up master profile and answer bank (right to work, notice period), with Kestrel's recorded form. */
function mira(options: Options = {}) {
  const ids: Record<string, string> = {};
  const { draft, ...rest } = options;
  const writer = fakeWriter({ draftAnswer: (input) => (draft ? draft(input, ids) : recordedFor(ids)(input)) });
  const t = createTestPreparation({ writer, fetch: fixtureFetch({ [kestrelQuestions]: "greenhouse-kestrel-4410-questions.json" }), ...rest });
  const save = (key: string, input: PieceInput) => {
    const r = t.preparation.savePiece(input);
    if (!r.saved) throw new Error(`${key}: ${r.problems[0]!.message}`);
    ids[key] = r.piece.id;
  };
  save("analyst", { kind: "role", text: "", entry: { title: "Security Analyst", organisation: "Northwind Bank", city: "Sofia", start: "2022-03", end: null }, tags: ["SOC"], angles: ["security"] });
  save("detections", { kind: "achievement", text: "Wrote 30 detection rules that cut false alerts by a quarter.", belongsTo: ids.analyst, tags: ["SIEM"], angles: ["security"], numberSource: "measured" });
  save("phishing", { kind: "achievement", text: "Ran the response to a phishing campaign against the claims team.", belongsTo: ids.analyst, tags: ["incident response"], angles: ["security"] });
  save("wazuh", { kind: "skill", text: "Wazuh", tags: ["SIEM"], angles: ["security"] });
  t.preparation.saveAngle({ angle: "security", summary: "Security analyst at a bank, writing detection rules." });
  t.preparation.saveContact({
    nameLatin: "Mira Petrova", nameCyrillic: "Мира Петрова", email: "mira.petrova@example.com", phone: "+359 88 000 0175", city: "Sofia", country: "Bulgaria",
    links: ["https://www.linkedin.com/in/mira-petrova-example"],
  });
  const bank = (input: Parameters<typeof t.preparation.saveAnswer>[0]) => {
    const r = t.preparation.saveAnswer(input);
    if (!r.saved) throw new Error(r.problems[0]!.message);
    return r.answer;
  };
  bank({ question: "Right to work in Bulgaria", wordings: ["Do you have the right to work in Bulgaria?"], versions: { en: "Yes", bg: "Да" }, category: "standard", kind: "yes-no" });
  bank({ question: "Notice period", wordings: ["What is your notice period?"], versions: { en: "1 month", bg: "1 месец" }, category: "standard" });
  return { ...t, ids, writer, bank };
}

/** A made-up Kestrel Payments job: its Greenhouse page (the target) and a LinkedIn alert that found it first. */
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
    requirements: [{ text: "Experience triaging alerts in a SIEM" }, { text: "Incident response" }],
    screening: { salary: { min: 2800, max: 3600, currency: "EUR", period: "month", basis: "gross" } },
    postings: [
      { id: "posting-gh", site: "job-boards.greenhouse.io", url: "https://job-boards.greenhouse.io/kestrel/jobs/4410", firstSeenAt: "2026-10-10T08:00:00Z", source: { name: "Kestrel Payments", kind: "greenhouse", label: "Greenhouse", category: "ats" } },
      { id: "posting-li", site: "linkedin.com", url: "https://www.linkedin.com/jobs/view/4410", firstSeenAt: "2026-10-09T07:00:00Z", source: { name: "LinkedIn alerts", kind: "email", label: "LinkedIn", category: "email" } },
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

describe("the target posting's questions", () => {
  it("come from a recorded Greenhouse form, in the form's order, each with its origin", async () => {
    const t = mira();

    const pkg = await started(t);

    expect(pkg.answers).toMatchObject({ from: "form", site: "job-boards.greenhouse.io" });
    expect(pkg.answers!.questions.map((q) => [q.question, q.origin, q.text])).toEqual([
      ["Do you have the right to work in Bulgaria?", "bank", "Yes"],
      ["What is your notice period?", "bank", "1 month"],
      ["What are your salary expectations? (gross monthly, EUR)", "needs-you", ""],
      ["Why Kestrel Payments?", "new", recordedWhyAnswer.text],
      ["Describe a security incident you handled.", "new", recordedDraftAnswer.text],
      ["How did you hear about us?", "new", "LinkedIn"],
      ["LinkedIn Profile", "bank", "https://www.linkedin.com/in/mira-petrova-example"],
    ]);
    expect(pkg.answers!.summary).toBe("7 questions from job-boards.greenhouse.io, in the form's order · 3 from your answer bank · 3 new drafts · 1 needs you.");
    expect(pkg.parts[3]).toMatchObject({ part: "answers", state: "done", what: "7 questions · 3 from your answer bank" });
  });
});

/** One question's answer as the step shows it. */
const question = (pkg: { answers: { questions: { question: string }[] } | null }, text: string) => {
  const q = pkg.answers?.questions.find((x) => x.question.startsWith(text));
  if (!q) throw new Error(`No question "${text}"`);
  return q as NonNullable<Awaited<ReturnType<typeof started>>["answers"]>["questions"][number];
};

describe("salary", () => {
  it("always needs Kris, with the posting's range, the floor, the last answer and the rule's suggestion", async () => {
    const t = mira();
    const corvid = await started(t, kestrelJob({ id: "job-corvid", company: "Corvid Logistics" }));
    t.preparation.setScreeningAnswer(corvid.id, "question_31003", "€3,300");

    const pkg = await started(t);

    expect(question(pkg, "What are your salary")).toMatchObject({
      origin: "needs-you", label: "Needs you", text: "", needsYou: true,
      salary: {
        range: "€2,800–3,600 gross", floor: 2000, last: { amount: 3300, company: "Corvid Logistics" }, suggested: 3400,
        text: "Posting range €2,800–3,600 gross · your minimum €2,000 · last asked at Corvid Logistics: €3,300. Suggested €3,400 by your answer-bank rule (upper half of the posting's stated range, never under €2,000 a month).",
      },
    });
  });

  it("is never filled from the bank, even when the bank has a number for it", async () => {
    const t = mira();
    const salary = t.preparation.listAnswers({ search: "Salary expectations" }).answers[0]!;
    t.preparation.saveAnswer({ ...salary, wordings: [...salary.wordings.map((w) => w.text), "What are your salary expectations? (gross monthly, EUR)"], mode: "fill", kind: "text", versions: { en: "3000" } });

    const pkg = await started(t);

    expect(question(pkg, "What are your salary")).toMatchObject({ origin: "needs-you", text: "", salary: { suggested: 3400 } });
  });

  it("takes one number, never saved to the bank", async () => {
    const t = mira();
    const pkg = await started(t);

    expect(t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3,000–3,500")).toMatchObject({ changed: false, reason: "Give one number: the form takes a number, not a range." });
    const set = t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3400");
    expect(question(set.package, "What are your salary")).toMatchObject({ text: "3400", needsYou: false, yours: true, save: { offered: false } });
    expect(t.preparation.saveScreeningAnswerToBank(pkg.id, "question_31003")).toMatchObject({ changed: false, reason: "Salary depends on the job, so the number is never saved to the answer bank." });
  });
});

describe("an answer adapted from the bank", () => {
  it("is trimmed to the form's limit by whole sentences and lists exactly what was removed", async () => {
    const t = mira();
    t.bank({
      question: "Describe a security incident you handled", category: "screening",
      versions: { en: "In 2024 a phishing campaign reached the claims team at Northwind Bank. I ran the response and had the affected sessions revoked within the hour. Afterwards I ran a short awareness session for the claims team and wrote a guide on reporting suspicious mail." },
    });

    const pkg = await started(t);

    expect(question(pkg, "Describe a security incident")).toMatchObject({
      origin: "adapted", label: "Answer bank · adapted",
      text: "In 2024 a phishing campaign reached the claims team at Northwind Bank. I ran the response and had the affected sessions revoked within the hour.",
      note: "Your answer, trimmed by 1 sentence to fit. No facts added.",
      changed: { removed: ["Afterwards I ran a short awareness session for the claims team and wrote a guide on reporting suspicious mail."], note: "Your answer bank keeps the full version." },
      limit: { words: 40, chars: null }, words: 25,
    });
  });
});

describe("saving to the answer bank", () => {
  it("is never offered or done for a company-specific answer", async () => {
    const t = mira();
    const pkg = await started(t);

    expect(question(pkg, "Why Kestrel")).toMatchObject({ save: { offered: false, note: "Written for this company: not saved to the answer bank." } });
    expect(t.preparation.saveScreeningAnswerToBank(pkg.id, "question_31004")).toMatchObject({
      changed: false, reason: "Written for Kestrel Payments: answers like this are written fresh for each job, so they aren't saved to the answer bank.",
    });
    expect(t.preparation.listAnswers({ search: "Kestrel" }).total).toBe(0);
  });

  it("is offered for a reusable new answer, which becomes a screening answer in the bank", async () => {
    const t = mira();
    const pkg = await started(t);
    expect(question(pkg, "Describe a security incident")).toMatchObject({ origin: "new", save: { offered: true } });

    const saved = t.preparation.saveScreeningAnswerToBank(pkg.id, "question_31005");

    expect(question(saved.package, "Describe a security incident")).toMatchObject({ save: { offered: false, savedTo: expect.any(String) } });
    expect(t.preparation.findAnswer("Describe a security incident you handled", "en")).toMatchObject({ fill: { action: "fill", value: recordedDraftAnswer.text } });
    expect(t.preparation.listAnswers({ category: "screening" }).answers[0]).toMatchObject({ category: "screening", source: { from: "Kestrel Payments package", jobId: "job-kestrel" } });
  });
});

describe("Approve", () => {
  it("waits for every answer that needs Kris, naming the first one to go to", async () => {
    const t = mira();
    const pkg = await started(t);

    expect(pkg.answers!.waiting).toEqual({ questionId: "question_31003", reason: "1 answer needs you: salary" });
    expect(pkg.steps[3]).toMatchObject({ sub: "1 needs you" });

    const done = t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3400");

    expect(done.package.answers!.waiting).toBeNull();
    expect(done.package.steps[3]).not.toMatchObject({ sub: "1 needs you" });
  });

  it("an answer Kris writes is checked against the form's limit, with its words counted", async () => {
    const t = mira();
    const pkg = await started(t);
    const long = Array.from({ length: 41 }, (_, i) => `word${i}`).join(" ");

    expect(t.preparation.setScreeningAnswer(pkg.id, "question_31005", long)).toMatchObject({ changed: false, reason: "The form takes at most 40 words; this is 41." });
    expect(t.preparation.setScreeningAnswer(pkg.id, "question_31001", "Maybe")).toMatchObject({ changed: false, reason: "Choose one of the form's options." });
    const set = t.preparation.setScreeningAnswer(pkg.id, "question_31005", "I ran the response to a phishing campaign.");
    expect(question(set.package, "Describe a security incident")).toMatchObject({ text: "I ran the response to a phishing campaign.", words: 8, yours: true });
  });
});
