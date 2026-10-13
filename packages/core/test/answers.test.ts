import { describe, expect, it } from "vitest";
import { createTestPreparation } from "./preparation-harness.ts";

// The answer bank through the preparation engine (ticket #56): what Profile shows and what Apply
// (#40) fills portals from. Made-up person only: Mira Petrova, mira.petrova@example.com.

/** Saves an answer Kris adds in Profile, failing the test if it's refused. */
function add(t: ReturnType<typeof createTestPreparation>, input: Parameters<ReturnType<typeof createTestPreparation>["preparation"]["saveAnswer"]>[0]) {
  const r = t.preparation.saveAnswer(input);
  if (!r.saved) throw new Error(r.problems.map((p) => p.message).join(" "));
  return r.answer;
}

const noticePeriod = {
  question: "Notice period",
  wordings: ["When could you start?", "How much notice do you need to give?", "Срок на предизвестие"],
  versions: { en: "1 month", bg: "1 месец" },
  category: "standard",
  kind: "text",
  mode: "fill",
} as const;

describe("finding an answer for a portal's question", () => {
  it("finds an answer by one of its other wordings, in the language asked for", () => {
    const t = createTestPreparation();
    const saved = add(t, noticePeriod);

    const found = t.preparation.findAnswer("How much notice do you need to give?", "en");

    expect(found).toMatchObject({ answerId: saved.id, question: "Notice period", confidence: 1, fill: { action: "fill", value: "1 month" } });
  });

  it("finds an answer by a Bulgarian wording and gives the Bulgarian version", () => {
    const t = createTestPreparation();
    const saved = add(t, noticePeriod);

    const found = t.preparation.findAnswer("Срок на предизвестие:", "bg");

    expect(found).toMatchObject({ answerId: saved.id, confidence: 1, fill: { action: "fill", value: "1 месец" } });
  });

  it("matches a close wording with less confidence, and nothing for an unrelated question", () => {
    const t = createTestPreparation();
    add(t, noticePeriod);

    const close = t.preparation.findAnswer("How much notice do you have to give your employer?", "en");
    const unrelated = t.preparation.findAnswer("Do you have a driving licence?", "en");

    expect(close?.question).toBe("Notice period");
    expect(close?.confidence).toBeGreaterThanOrEqual(0.75);
    expect(close?.confidence).toBeLessThan(1);
    expect(unrelated).toBeNull();
  });

  it("doesn't take a question about another skill for the same question", () => {
    const t = createTestPreparation();
    add(t, { question: "Years of experience with Splunk", versions: { en: "3" }, category: "screening", kind: "number" });

    expect(t.preparation.findAnswer("Years of experience with Python", "en")).toBeNull();
    expect(t.preparation.findAnswer("Years of Splunk experience", "en")?.confidence).toBe(1);
  });

  it("never gives an 'ask each time' or 'leave blank' answer as a value", () => {
    const t = createTestPreparation();
    const rule = { text: "Upper half of the client's budget", params: null };
    add(t, { question: "Day rate for contract work", wordings: ["Expected day rate", "Дневна ставка"], versions: { en: "€300" }, category: "screening", kind: "rule", mode: "ask", rule });
    add(t, { question: "Religion", wordings: ["What is your religion?", "Вероизповедание"], versions: { en: "Prefer not to say", bg: "Предпочитам да не посоча" }, category: "standard", mode: "blank" });

    expect(t.preparation.findAnswer("Expected day rate", "en")?.fill).toEqual({ action: "ask", rule });
    expect(t.preparation.findAnswer("Дневна ставка", "bg")?.fill).toEqual({ action: "ask", rule });
    expect(t.preparation.findAnswer("What is your religion?", "en")?.fill).toEqual({ action: "leave-blank", whenRequired: "Prefer not to say" });
    expect(t.preparation.findAnswer("Вероизповедание", "bg")?.fill).toEqual({ action: "leave-blank", whenRequired: "Предпочитам да не посоча" });
  });

  it("never fills an answer in another language: it says which languages the bank has", () => {
    const t = createTestPreparation();
    add(t, { question: "Years of experience with Splunk", versions: { en: "3" }, category: "screening", kind: "number" });

    expect(t.preparation.findAnswer("Years of experience with Splunk", "bg")?.fill).toEqual({ action: "no-version", languages: ["en"] });
  });
});

describe("an answer changed in a portal", () => {
  const kubernetes = { question: "Kubernetes experience", versions: { en: "I haven't used Kubernetes in production." }, category: "screening" } as const;
  const typed = "No production experience; one personal k3s project in 2025.";

  it("waits in Profile with both versions, and counts in the answer bank's section and the nav badge", () => {
    const t = createTestPreparation();
    const saved = add(t, kubernetes);

    t.preparation.recordPortalEdit(saved.id, { language: "en", text: typed, portal: "Halden Systems Workday form", jobId: "job:1" });

    expect(t.preparation.answer(saved.id)?.portalEdit).toMatchObject({ language: "en", before: "I haven't used Kubernetes in production.", text: typed, portal: "Halden Systems Workday form", jobId: "job:1" });
    expect(t.preparation.profileSummary()).toMatchObject({ needsYou: { answerBank: 1 }, needsYouTotal: 1 });
  });

  it("Keep new uses the portal's version and keeps the old one in the answer's history", async () => {
    const t = createTestPreparation();
    const saved = add(t, kubernetes);
    await t.clock.advance(24 * 3600_000);
    t.preparation.recordPortalEdit(saved.id, { language: "en", text: typed, portal: "Halden Systems Workday form" });

    t.preparation.resolvePortalEdit(saved.id, "keep-new");

    const after = t.preparation.answer(saved.id);
    expect(after?.versions.en).toBe(typed);
    expect(after?.portalEdit).toBeNull();
    expect(t.preparation.answerHistory(saved.id)).toEqual([
      { at: "2026-10-13T07:30:00.000Z", event: "changed", where: "Halden Systems Workday form", language: "en", before: "I haven't used Kubernetes in production.", after: typed },
      { at: "2026-10-12T07:30:00.000Z", event: "created", where: "Added in Profile", language: null, before: null, after: null },
    ]);
    expect(t.preparation.profileSummary().needsYou.answerBank).toBe(0);
  });

  it("Keep old leaves the answer as it was and notes the version it turned down", () => {
    const t = createTestPreparation();
    const saved = add(t, kubernetes);
    t.preparation.recordPortalEdit(saved.id, { language: "en", text: typed, portal: "Halden Systems Workday form" });

    t.preparation.resolvePortalEdit(saved.id, "keep-old");

    expect(t.preparation.answer(saved.id)).toMatchObject({ versions: kubernetes.versions, portalEdit: null });
    expect(t.preparation.answerHistory(saved.id)[0]).toMatchObject({ event: "kept-old", where: "Halden Systems Workday form", before: kubernetes.versions.en, after: typed });
  });

  it("isn't a question when Kris typed what the bank already has", () => {
    const t = createTestPreparation();
    const saved = add(t, kubernetes);

    const recorded = t.preparation.recordPortalEdit(saved.id, { language: "en", text: ` ${kubernetes.versions.en} `, portal: "Halden Systems Workday form" });

    expect(recorded).toBe(false);
    expect(t.preparation.answer(saved.id)?.portalEdit).toBeNull();
  });
});

describe("using an answer", () => {
  it("counts each use and remembers the last", async () => {
    const t = createTestPreparation();
    const saved = add(t, noticePeriod);
    t.preparation.recordAnswerUse(saved.id);
    await t.clock.advance(3600_000);

    t.preparation.recordAnswerUse(saved.id);

    expect(t.preparation.answer(saved.id)).toMatchObject({ useCount: 2, lastUsedAt: "2026-10-12T08:30:00.000Z" });
  });

  it("keeps a new answer Apply adds with the job and portal it came from", () => {
    const t = createTestPreparation();

    const r = t.preparation.saveAnswer(
      { question: "Do you hold a security clearance?", versions: { en: "No" }, category: "screening", kind: "yes-no" },
      { from: "Halden Systems Workday form", jobId: "job:1", portal: "Halden Systems Workday form" },
    );

    expect(r).toMatchObject({ saved: true, answer: { source: { from: "Halden Systems Workday form", jobId: "job:1", portal: "Halden Systems Workday form" } } });
  });
});

describe("adding and editing an answer", () => {
  it("refuses an answer with no question, or no version to fill", () => {
    const t = createTestPreparation();

    const r = t.preparation.saveAnswer({ question: " ", versions: { en: " " }, category: "standard", mode: "fill" });

    expect(r).toEqual({ saved: false, problems: [
      { field: "question", message: "Give the question, as you'd name it." },
      { field: "en", message: "Give the answer in English or Bulgarian, or choose \"Ask me each time\" or \"Leave it blank\"." },
    ] });
  });

  it("refuses a wording another answer already matches", () => {
    const t = createTestPreparation();
    add(t, noticePeriod);

    const r = t.preparation.saveAnswer({ question: "Start date", wordings: ["When could you start"], versions: { en: "In a month" }, category: "standard" });

    expect(r).toEqual({ saved: false, problems: [{ field: "wordings", message: "\"When could you start\" already finds your answer to \"Notice period\". Add it there, or remove it here." }] });
  });

  it("refuses a letter-style question: those are written fresh for each job", () => {
    const t = createTestPreparation();

    const r = t.preparation.saveAnswer({ question: "Why do you want to work at Kestrel Payments?", versions: { en: "Because…" }, category: "screening" });

    expect(r).toMatchObject({ saved: false, problems: [{ field: "question" }] });
  });

  it("checks a yes/no or number answer is one", () => {
    const t = createTestPreparation();

    const r = t.preparation.saveAnswer({ question: "Years of experience with Splunk", versions: { en: "three", bg: "3" }, category: "screening", kind: "number" });
    const ok = t.preparation.saveAnswer({ question: "Visa sponsorship needed", versions: { en: "No", bg: "Не" }, category: "standard", kind: "yes-no" });

    expect(r).toEqual({ saved: false, problems: [{ field: "en", message: "A number answer is a number, like 3." }] });
    expect(ok.saved).toBe(true);
  });

  it("notes each changed version in the history", async () => {
    const t = createTestPreparation();
    const saved = add(t, { ...noticePeriod, versions: { en: "2 weeks" } });
    await t.clock.advance(3600_000);

    add(t, { ...noticePeriod, id: saved.id });

    expect(t.preparation.answerHistory(saved.id).map((c) => [c.event, c.where, c.language, c.before, c.after])).toEqual([
      ["changed", "Profile", "bg", null, "1 месец"],
      ["changed", "Profile", "en", "2 weeks", "1 month"],
      ["created", "Added in Profile", null, null, null],
    ]);
  });

  it("deletes an answer: it's no longer found", () => {
    const t = createTestPreparation();
    const saved = add(t, noticePeriod);

    expect(t.preparation.deleteAnswer(saved.id)).toBe(true);
    expect(t.preparation.deleteAnswer(saved.id)).toBe(false);
    expect(t.preparation.findAnswer("Notice period", "en")).toBeNull();
    expect(t.preparation.answer(saved.id)).toBeNull();
  });
});

describe("browsing the answer bank", () => {
  /** Mira's bank: the 2 defaults and 12 answers, one used today, one used 100 days ago, the rest never used. */
  async function bank() {
    const t = createTestPreparation();
    const old = add(t, { question: "Years of experience with Splunk", versions: { en: "3" }, category: "screening", kind: "number" });
    t.preparation.recordAnswerUse(old.id);
    await t.clock.advance(100 * 24 * 3600_000);
    const today = add(t, noticePeriod);
    t.preparation.recordAnswerUse(today.id);
    for (let i = 1; i <= 10; i++) add(t, { question: `Screening question ${i}`, versions: { en: `Answer ${i}` }, category: i <= 2 ? "standard" : "screening" });
    return t;
  }

  it("lists standard answers first, counts standard, screening and not used in 90 days, and pages the table", async () => {
    const t = await bank();

    const first = t.preparation.listAnswers({ pageSize: 5 });
    const third = t.preparation.listAnswers({ pageSize: 5, page: 3 });

    expect(first.counts).toEqual({ all: 14, standard: 5, screening: 9, notUsedIn90Days: 3 });
    expect(first).toMatchObject({ total: 14, page: 1, pageSize: 5 });
    expect(first.answers.map((a) => a.question)).toEqual(["Salary expectations", "Gender, ethnicity and other diversity questions", "Notice period", "Screening question 1", "Screening question 2"]);
    expect(third.answers.map((a) => a.question)).toEqual(["Screening question 7", "Screening question 8", "Screening question 9", "Screening question 10"]);
  });

  it("filters by category, by not used in 90 days, and searches questions, wordings and answers", async () => {
    const t = await bank();

    expect(t.preparation.listAnswers({ category: "standard", search: "question" }).answers.map((a) => a.question)).toEqual(["Gender, ethnicity and other diversity questions", "Screening question 1", "Screening question 2"]);
    expect(t.preparation.listAnswers({ notUsedIn90Days: true, category: "screening" }).answers.map((a) => a.question)).toEqual(["Years of experience with Splunk"]);
    expect(t.preparation.listAnswers({ search: "предизвестие" }).answers.map((a) => a.question)).toEqual(["Notice period"]);
    expect(t.preparation.listAnswers({ search: "answer 10" })).toMatchObject({ total: 1, counts: { all: 1, standard: 0, screening: 1, notUsedIn90Days: 0 } });
  });

  it("lists the portal edits waiting for Kris, whatever the filters", async () => {
    const t = await bank();
    const notice = t.preparation.listAnswers({ search: "Notice period" }).answers[0]!;
    t.preparation.recordPortalEdit(notice.id, { language: "en", text: "2 weeks", portal: "Kestrel Payments Greenhouse form" });

    const list = t.preparation.listAnswers({ category: "screening" });

    expect(list.portalEdits).toEqual([expect.objectContaining({ id: notice.id, question: "Notice period", portalEdit: expect.objectContaining({ before: "1 month", text: "2 weeks" }) })]);
  });
});

describe("default answers", () => {
  const mira = {
    nameLatin: "Mira Petrova", nameCyrillic: "Мира Петрова", email: "mira.petrova@example.com", phone: "+359 88 000 0199",
    city: "Sofia", country: "Bulgaria", links: ["https://www.linkedin.com/in/mira-petrova-example", "https://github.com/mira-example", "https://mira.example.com"],
  };

  it("start with salary as ask each time with its rule, and diversity questions left blank", () => {
    const t = createTestPreparation();

    const salary = t.preparation.findAnswer("What are your salary expectations?", "en");
    const gender = t.preparation.findAnswer("What is your gender?", "bg");

    expect(salary?.fill).toEqual({
      action: "ask",
      rule: { text: "Upper half of the posting's stated range, never under €2,000 a month", params: { kind: "salary", take: "upper-half", floor: 2000, currency: "EUR" } },
    });
    expect(gender?.fill).toEqual({ action: "leave-blank", whenRequired: "Предпочитам да не посоча" });
    expect(t.preparation.listAnswers().counts).toMatchObject({ all: 2, standard: 2 });
    expect(t.preparation.listAnswers().answers.map((a) => a.source.from)).toEqual(["Added as a default", "Added as a default"]);
  });

  it("come from the contact details once they're saved", () => {
    const t = createTestPreparation();
    t.preparation.saveContact(mira);

    const fill = (q: string, l: "en" | "bg" = "en") => t.preparation.findAnswer(q, l)?.fill;

    expect(fill("Email address")).toEqual({ action: "fill", value: "mira.petrova@example.com" });
    expect(fill("Телефон", "bg")).toEqual({ action: "fill", value: "+359 88 000 0199" });
    expect(fill("LinkedIn URL")).toEqual({ action: "fill", value: "https://www.linkedin.com/in/mira-petrova-example" });
    expect(fill("GitHub")).toEqual({ action: "fill", value: "https://github.com/mira-example" });
    expect(fill("Portfolio")).toEqual({ action: "fill", value: "https://mira.example.com" });
    expect(fill("Current location")).toEqual({ action: "fill", value: "Sofia, Bulgaria" });
    expect(t.preparation.listAnswers({ search: "mira.petrova" }).answers[0]?.source.from).toBe("From your contact details");
  });

  it("follow the contact details until Kris edits them, and a deleted one stays deleted", () => {
    const t = createTestPreparation();
    t.preparation.saveContact(mira);
    const email = t.preparation.findAnswer("Email", "en")!;
    const phone = t.preparation.findAnswer("Phone number", "en")!;
    add(t, { ...t.preparation.answer(phone.answerId)!, wordings: t.preparation.answer(phone.answerId)!.wordings.map((w) => w.text), versions: { en: "+359 88 000 0100" } });
    t.preparation.deleteAnswer(t.preparation.findAnswer("GitHub", "en")!.answerId);

    t.preparation.saveContact({ ...mira, email: "mira.jobs@example.com", phone: "+359 88 000 0111" });

    expect(t.preparation.findAnswer("Email", "en")?.fill).toEqual({ action: "fill", value: "mira.jobs@example.com" });
    expect(t.preparation.answerHistory(email.answerId)[0]).toMatchObject({ event: "changed", where: "Your contact details", before: "mira.petrova@example.com", after: "mira.jobs@example.com" });
    expect(t.preparation.findAnswer("Phone number", "en")?.fill).toEqual({ action: "fill", value: "+359 88 000 0100" });
    expect(t.preparation.findAnswer("GitHub", "en")).toBeNull();
  });
});
