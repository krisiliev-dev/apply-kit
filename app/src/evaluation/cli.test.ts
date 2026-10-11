import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvaluationCase, Extractor, ExtractionInput, PostingFacts } from "@apply-kit/core";
import { runExtractionEvaluation, type EvaluationCliDeps } from "./cli.ts";

const nothing: PostingFacts = {
  language: "en", requirements: [], years: [], languages: [], certificates: [],
  workAuthorisation: { summary: "Not stated", visaSponsorship: "not-stated", source: null, confidence: 1 },
  remote: { mode: "not-stated", summary: "Not stated", locations: [], source: null, confidence: 1 },
  salary: { stated: false, min: null, max: null, currency: null, period: null, basis: "not-stated", source: null, confidence: 1 },
};

function evalCase(id: string): EvaluationCase {
  return {
    id, field: "dev",
    source: { kind: "greenhouse", url: `https://example.com/${id}`, fetchedOn: "2026-10-12" },
    input: { title: id, company: "Kestrel", location: "Sofia", text: "Go\nHybrid in Sofia" },
    expected: {
      language: "en", requirements: [{ text: "Go", kind: "required" }], years: [], languages: [], certificates: [],
      visaSponsorship: "not-stated", remote: { mode: "hybrid", locations: ["Sofia"] }, salary: null,
    },
  };
}

/** A fake extractor that finds the Go requirement and nothing else, at a fixed cost. */
function fakeExtractor(costUsd = 0.001, estimateUsd = 0.002) {
  const calls: ExtractionInput[] = [];
  const extractor: Extractor = {
    estimateCostUsd: () => estimateUsd,
    async extract(input) {
      calls.push(input);
      const facts = { ...nothing, requirements: [{ text: "Go", kind: "required" as const, category: "skill" as const, source: { quote: "Go", translation: null }, confidence: 0.9 }] };
      return { facts, costUsd, model: "fake/model" };
    },
  };
  return { extractor, calls };
}

function setup(env: Record<string, string | undefined>, overrides: Partial<EvaluationCliDeps> = {}) {
  const root = mkdtempSync(join(tmpdir(), "apply-kit-eval-"));
  const casesDir = join(root, "postings"), reportsDir = join(root, "reports");
  mkdirSync(casesDir);
  for (const id of ["one", "two"]) writeFileSync(join(casesDir, `${id}.json`), JSON.stringify(evalCase(id)));
  const out: string[] = [];
  const fake = fakeExtractor();
  const spends: number[] = [];
  const deps: EvaluationCliDeps = {
    env, casesDir, reportsDir,
    createExtractor: () => fake.extractor,
    openLedger: () => ({ spentThisMonthUsd: () => 0, record: (usd) => { spends.push(usd); }, close() {} }),
    now: () => new Date("2026-10-12T09:30:00Z"),
    log: (line) => out.push(line),
    ...overrides,
  };
  return { deps, out, calls: fake.calls, spends, reportsDir };
}

describe("pnpm eval:extraction", () => {
  it("refuses to run without the OpenRouter key, saying how to fix it, and calls nothing", async () => {
    const t = setup({ AI_MONTHLY_CAP_USD: "10" });

    const code = await runExtractionEvaluation(t.deps);

    expect(code).toBe(1);
    expect(t.out.join("\n")).toMatch(/OPENROUTER_API_KEY isn't set/);
    expect(t.calls).toHaveLength(0);
  });

  it("refuses to run without a monthly AI cap, like the service, which reads nothing without one", async () => {
    const t = setup({ OPENROUTER_API_KEY: "test-key" });

    expect(await runExtractionEvaluation(t.deps)).toBe(1);
    expect(t.out.join("\n")).toMatch(/AI_MONTHLY_CAP_USD isn't set/);
    expect(t.calls).toHaveLength(0);
  });

  it("refuses when the run could cross what is left of this month's budget, and says how much it needs", async () => {
    // Two postings estimated at $0.002 each; $9.997 of the $10 cap is already spent.
    const t = setup({ OPENROUTER_API_KEY: "test-key", AI_MONTHLY_CAP_USD: "10" }, {
      openLedger: () => ({ spentThisMonthUsd: () => 9.997, record() {}, close() {} }),
    });

    expect(await runExtractionEvaluation(t.deps)).toBe(1);
    const said = t.out.join("\n");
    expect(said).toMatch(/\$0\.004/);
    expect(said).toMatch(/\$0\.003 .*left/);
    expect(t.calls).toHaveLength(0);
  });

  it("reads every posting, prints accuracy per fact type and the cost, and saves a timestamped report", async () => {
    const t = setup({ OPENROUTER_API_KEY: "test-key", AI_MONTHLY_CAP_USD: "10" });

    expect(await runExtractionEvaluation(t.deps)).toBe(0);

    expect(t.calls.map((c) => c.title)).toEqual(["one", "two"]);
    const said = t.out.join("\n");
    // Requirements all found; the hybrid rule and Sofia never are.
    expect(said).toMatch(/requirements\s.*100%/);
    expect(said).toMatch(/remote\s.*0%\s.*0\/2/);
    expect(said).toMatch(/location\s.*0%/);
    expect(said).toMatch(/Cost: \$0\.002/);
    // Each read is booked against the month's budget.
    expect(t.spends).toEqual([0.001, 0.001]);

    const files = readdirSync(t.reportsDir);
    expect(files).toEqual(["extraction-2026-10-12T09-30-00Z.json"]);
    const report = JSON.parse(readFileSync(join(t.reportsDir, files[0]!), "utf8"));
    expect(report).toMatchObject({ model: "fake/model", costUsd: 0.002, startedAt: "2026-10-12T09:30:00.000Z", postings: 2 });
    expect(report.summary.facts.find((f: { fact: string }) => f.fact === "requirements")).toMatchObject({ recall: 1, precision: 1 });
    expect(report.cases).toHaveLength(2);
    expect(said).toContain(join(t.reportsDir, files[0]!));
  });

  it("shows the change against the previous report, so a new model or prompt can be compared", async () => {
    const t = setup({ OPENROUTER_API_KEY: "test-key", AI_MONTHLY_CAP_USD: "10" });
    await runExtractionEvaluation(t.deps);
    const previous = join(t.reportsDir, "extraction-2026-10-12T09-30-00Z.json");
    const report = JSON.parse(readFileSync(previous, "utf8"));
    report.summary.facts.find((f: { fact: string }) => f.fact === "requirements").f1 = 0.5;
    writeFileSync(previous, JSON.stringify(report));
    t.out.length = 0;

    await runExtractionEvaluation({ ...t.deps, now: () => new Date("2026-10-13T08:00:00Z") });

    expect(t.out.join("\n")).toMatch(/requirements\s.*100%.*\+50/);
    expect(t.out.join("\n")).toContain("extraction-2026-10-12T09-30-00Z.json");
  });
});
