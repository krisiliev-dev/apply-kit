import { describe, expect, it } from "vitest";
import { runEvaluation, scoreCase, type EvaluationCase, type ExpectedFacts } from "../src/index.ts";
import { cannedFacts, fakeExtractor } from "./harness.ts";

const q = { quote: "x", translation: null };
const nothing: ExpectedFacts = {
  language: "en", requirements: [], years: [], languages: [], certificates: [],
  visaSponsorship: "not-stated", remote: { mode: "not-stated", locations: [] }, salary: null,
};
const req = (text: string, kind: "required" | "preferred" = "required") =>
  ({ text, kind, category: "skill" as const, source: q, confidence: 0.9 });

describe("scoring one posting: requirements", () => {
  it("matches requirements worded differently but about the same thing, and counts misses and extras", () => {
    const score = scoreCase(
      { ...nothing, requirements: [
        { text: "3+ years in security operations", kind: "required" },
        { text: "Splunk or Elastic", kind: "required" },
        { text: "CISSP", kind: "preferred" },
      ] },
      cannedFacts({ requirements: [
        req("3+ years of security operations experience"),
        req("Hands-on Splunk or Elastic SIEM"),
        req("Bachelor's degree in Computer Science"),
      ] }),
    );
    expect(score.requirements).toMatchObject({ expected: 3, extracted: 3, matched: 2, kindAgreed: 2 });
    expect(score.requirements.missed).toEqual(["CISSP"]);
    expect(score.requirements.extra).toEqual(["Bachelor's degree in Computer Science"]);
  });
});

describe("scoring one posting: requirement tolerance", () => {
  it("doesn't match asks that only share filler words, and counts a required/preferred mix-up against kind", () => {
    const score = scoreCase(
      { ...nothing, requirements: [
        { text: "Experience with Python", kind: "required" },
        { text: "Strong knowledge of Kubernetes", kind: "preferred" },
      ] },
      cannedFacts({ requirements: [req("Experience with Go"), req("Kubernetes", "required")] }),
    );
    expect(score.requirements).toMatchObject({ matched: 1, kindAgreed: 0, missed: ["Experience with Python"], extra: ["Experience with Go"] });
  });
});

const yrs = (min: number, max: number | null, kind: "required" | "preferred" = "required") =>
  ({ min, max, about: "anything", kind, source: q, confidence: 0.9 });

describe("scoring one posting: years", () => {
  it("credits years only when the numbers are exactly right, whatever they are said to be about", () => {
    const score = scoreCase(
      { ...nothing, years: [
        { min: 3, max: null, about: "security operations", kind: "required" },
        { min: 2, max: 4, kind: "required" },
        { min: 5, max: null, kind: "preferred" },
      ] },
      cannedFacts({ years: [yrs(3, null), yrs(2, 5), yrs(5, 5, "required")] }),
    );
    // "5 years" read as 5–5 is the same ask as 5+; 2–5 is not 2–4.
    expect(score.years).toMatchObject({ expected: 3, extracted: 3, matched: 2, kindAgreed: 1, missed: ["2–4 years"], extra: ["2–5 years"] });
  });
});

describe("scoring one posting: languages, certificates and locations", () => {
  it("matches languages by name, certificates by wording, and places when one names the other", () => {
    const score = scoreCase(
      { ...nothing,
        languages: [{ language: "English", level: "C1", kind: "required" }, { language: "German", kind: "preferred" }],
        certificates: [{ name: "OSCP", kind: "preferred" }, { name: "CISSP", kind: "required" }],
        remote: { mode: "hybrid", locations: ["Sofia", "Plovdiv"] },
      },
      cannedFacts({
        languages: [{ language: "english", level: "fluent", kind: "required", source: q, confidence: 0.9 }],
        certificates: [{ name: "OSCP certification", kind: "preferred", source: q, confidence: 0.9 }],
        remote: { mode: "hybrid", summary: "", locations: ["Sofia, Bulgaria", "Varna"], source: q, confidence: 0.9 },
      }),
    );
    expect(score.languages).toMatchObject({ matched: 1, kindAgreed: 1, missed: ["German"], extra: [] });
    expect(score.certificates).toMatchObject({ matched: 1, kindAgreed: 1, missed: ["CISSP"] });
    expect(score.locations).toMatchObject({ expected: 2, extracted: 2, matched: 1, kindAgreed: null, missed: ["Plovdiv"], extra: ["Varna"] });
  });
});

const salary = (s: Partial<{ min: number | null; max: number | null; currency: string | null; period: "year" | "month" | null; basis: "gross" | "net" | "not-stated" }>) =>
  ({ stated: true, min: null, max: null, currency: null, period: null, basis: "not-stated" as const, source: q, confidence: 0.9, ...s });

describe("scoring one posting: single facts", () => {
  it("counts the remote rule, visa rule and posting language right only when they are exactly as labelled", () => {
    const score = scoreCase(
      { ...nothing, language: "bg", visaSponsorship: "not-offered", remote: { mode: "hybrid", locations: [] } },
      cannedFacts({ language: "bg", remote: { mode: "on-site", summary: "", locations: [], source: q, confidence: 0.9 } }),
    );
    expect(score).toMatchObject({ language: true, remote: false, workAuthorisation: false });
  });

  it("counts a salary right only with exactly the labelled amounts, currency, period and basis", () => {
    const label: ExpectedFacts = { ...nothing, salary: { min: 5500, max: 7000, currency: "BGN", period: "month", basis: "gross" } };
    const right = salary({ min: 5500, max: 7000, currency: "bgn", period: "month", basis: "gross" });
    expect(scoreCase(label, cannedFacts({ salary: right })).salary).toBe(true);
    expect(scoreCase(label, cannedFacts({ salary: { ...right, max: 7500 } })).salary).toBe(false);
    expect(scoreCase(label, cannedFacts({ salary: { ...right, basis: "not-stated" } })).salary).toBe(false);
    expect(scoreCase(label, cannedFacts()).salary).toBe(false);
  });

  it("treats one amount the same whether it is read as a minimum or as a range of one", () => {
    const label: ExpectedFacts = { ...nothing, salary: { min: 4000, max: null, currency: "EUR", period: "month", basis: "net" } };
    expect(scoreCase(label, cannedFacts({ salary: salary({ min: 4000, max: 4000, currency: "EUR", period: "month", basis: "net" }) })).salary).toBe(true);
    expect(scoreCase(label, cannedFacts({ salary: salary({ min: null, max: 4000, currency: "EUR", period: "month", basis: "net" }) })).salary).toBe(false);
  });

  it("counts 'not stated' as right only when the extractor also says nothing about pay", () => {
    expect(scoreCase(nothing, cannedFacts()).salary).toBe(true);
    expect(scoreCase(nothing, cannedFacts({ salary: salary({ min: 3000, currency: "EUR" }) })).salary).toBe(false);
    // A "stated" salary with no amounts says nothing either.
    expect(scoreCase(nothing, cannedFacts({ salary: salary({}) })).salary).toBe(true);
  });
});

const evalCase = (id: string, expected: Partial<ExpectedFacts>, extra: Partial<EvaluationCase> = {}): EvaluationCase => ({
  id, field: "security",
  source: { kind: "greenhouse", url: `https://example.com/${id}`, fetchedOn: "2026-10-12" },
  input: { title: id, company: "Kestrel", location: "Sofia", text: "The posting." },
  expected: { ...nothing, ...expected },
  ...extra,
});

describe("running the evaluation", () => {
  it("reads every posting with the extractor and reports accuracy per fact type over the whole set", async () => {
    const cases = [
      evalCase("soc-analyst", {
        requirements: [{ text: "Splunk", kind: "required" }, { text: "Python scripting", kind: "preferred" }],
        years: [{ min: 3, max: null, kind: "required" }],
        salary: { min: 3000, max: 4000, currency: "EUR", period: "month", basis: "gross" },
      }),
      evalCase("pentester", { requirements: [{ text: "OSCP", kind: "required" }], remote: { mode: "remote", locations: ["EU"] } }),
    ];
    const extractor = fakeExtractor({
      "soc-analyst": cannedFacts({
        requirements: [req("Splunk"), req("Python scripting", "required"), req("Team player")],
        years: [yrs(3, null)],
        salary: salary({ min: 3000, max: 4000, currency: "EUR", period: "month", basis: "gross" }),
      }),
      "pentester": cannedFacts({ requirements: [req("OSCP")] }),
    }, { costUsd: 0.002 });

    const report = await runEvaluation({ cases, extractor, budgetUsd: 1 });

    expect(extractor.calls.map((c) => c.title)).toEqual(["soc-analyst", "pentester"]);
    expect(report.costUsd).toBeCloseTo(0.004);
    expect(report.model).toBe("fake/extractor");
    const fact = (name: string) => report.summary.facts.find((f) => f.fact === name);
    // Requirements: 3 labelled, 4 extracted, 3 matched, 2 of them asked the same way.
    expect(fact("requirements")).toMatchObject({ expected: 3, extracted: 4, matched: 3, precision: 0.75, recall: 1, kindAgreement: 2 / 3 });
    expect(fact("years")).toMatchObject({ precision: 1, recall: 1, f1: 1 });
    expect(fact("salary")).toMatchObject({ correct: 2, total: 2, accuracy: 1 });
    expect(fact("remote")).toMatchObject({ correct: 1, total: 2, accuracy: 0.5 });
    expect(fact("location")).toMatchObject({ expected: 1, extracted: 0, matched: 0, recall: 0, precision: null, f1: 0 });
    expect(report.cases.map((c) => c.status)).toEqual(["read", "read"]);
  });

  it("stops reading once the next posting's estimate would cross the budget, and says which were skipped", async () => {
    const cases = ["a", "b", "c"].map((id) => evalCase(id, {}));
    const extractor = fakeExtractor({}, { costUsd: 0.01, estimateUsd: 0.02 });

    const report = await runEvaluation({ cases, extractor, budgetUsd: 0.035, concurrency: 1 });

    // a: 0.02 estimated fits; b: 0.01 spent + 0.02 fits; c: 0.02 spent + 0.02 crosses 0.035.
    expect(extractor.calls.map((c) => c.title)).toEqual(["a", "b"]);
    expect(report.cases.map((c) => c.status)).toEqual(["read", "read", "skipped"]);
    expect(report.summary).toMatchObject({ postings: 2, skipped: 1 });
    expect(report.costUsd).toBeCloseTo(0.02);
  });

  it("scores a posting the extractor failed on as finding nothing and getting every fact wrong", async () => {
    const cases = [evalCase("broken", { requirements: [{ text: "Go", kind: "required" }] })];
    const extractor = fakeExtractor({ broken: new Error("The model's answer didn't match the schema") });

    const report = await runEvaluation({ cases, extractor, budgetUsd: 1 });

    expect(report.cases[0]).toMatchObject({ status: "failed", error: "The model's answer didn't match the schema" });
    const fact = (name: string) => report.summary.facts.find((f) => f.fact === name);
    expect(fact("requirements")).toMatchObject({ expected: 1, matched: 0, recall: 0 });
    // Even though the label says salary isn't stated, a failed read doesn't get it right.
    expect(fact("salary")).toMatchObject({ correct: 0, total: 1 });
    expect(report.summary.failed).toBe(1);
  });

  it("also reports the scores per posting language and per field, so Bulgarian postings can be compared", async () => {
    const bg = evalCase("bg-sysadmin", { language: "bg", remote: { mode: "on-site", locations: ["Sofia"] } }, { field: "dev" });
    const en = evalCase("en-designer", { remote: { mode: "remote", locations: [] } }, { field: "design" });
    const extractor = fakeExtractor({ "bg-sysadmin": cannedFacts({ language: "bg" }), "en-designer": cannedFacts({ remote: { mode: "remote", summary: "", locations: [], source: q, confidence: 1 } }) });

    const report = await runEvaluation({ cases: [bg, en], extractor, budgetUsd: 1 });

    const remote = (slice: string) => report.slices[slice]!.facts.find((f) => f.fact === "remote");
    expect(Object.keys(report.slices).sort()).toEqual(["bg", "design", "dev", "en"]);
    expect(remote("bg")).toMatchObject({ correct: 0, total: 1 });
    expect(remote("en")).toMatchObject({ correct: 1, total: 1 });
    expect(remote("dev")).toMatchObject({ correct: 0, total: 1 });
  });
});
