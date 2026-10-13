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
    expect(close?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(close?.confidence).toBeLessThan(1);
    expect(unrelated).toBeNull();
  });

  it("never gives an 'ask each time' or 'leave blank' answer as a value", () => {
    const t = createTestPreparation();
    const rule = { text: "Upper half of the posting's stated range, never under €2,000 a month", params: { kind: "salary", take: "upper-half", floor: 2000, currency: "EUR" } } as const;
    add(t, { question: "Salary expectations", wordings: ["Expected salary", "Желано възнаграждение"], versions: { en: "€2,500 a month" }, category: "standard", kind: "rule", mode: "ask", rule });
    add(t, { question: "Gender", wordings: ["What is your gender?", "Пол"], versions: { en: "Prefer not to say", bg: "Предпочитам да не посоча" }, category: "standard", mode: "blank" });

    expect(t.preparation.findAnswer("Expected salary", "en")?.fill).toEqual({ action: "ask", rule });
    expect(t.preparation.findAnswer("Желано възнаграждение", "bg")?.fill).toEqual({ action: "ask", rule });
    expect(t.preparation.findAnswer("What is your gender?", "en")?.fill).toEqual({ action: "leave-blank", whenRequired: "Prefer not to say" });
    expect(t.preparation.findAnswer("Пол", "bg")?.fill).toEqual({ action: "leave-blank", whenRequired: "Предпочитам да не посоча" });
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
