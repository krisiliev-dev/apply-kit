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
