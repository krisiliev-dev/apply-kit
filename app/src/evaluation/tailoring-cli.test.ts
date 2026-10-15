import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentRenderer, PdfTextReader, TailorCvInput, TailoredCv, Writer, WriterRequest } from "@apply-kit/core";
import { recordTailoringVerdicts, runTailoringEvaluationCli, type TailoringCliDeps } from "./tailoring-cli.ts";
import { evaluationEngine } from "./tailoring-engine.ts";
import { repoRoot } from "../config.ts";

// `pnpm eval:tailoring` (#69) over the real fixture set (fictional profiles), with a fake writer and
// a fake printer: never the live model. The report, the blind sheet and recording the verdicts.

/** A writer that keeps every piece's own words, and one that adds a stock phrase to the letter. */
function fakeWriter(model: string, letterLine = "I wrote the work my profile lists.", costUsd = 0.001) {
  const calls: WriterRequest[] = [];
  const out = <T>(output: T) => ({ output, costUsd, model, excerpts: [] });
  const cv = (input: TailorCvInput): TailoredCv => ({
    summary: { text: input.angle.summary, pieceIds: input.pieces.filter((p) => p.kind === "achievement").slice(0, 1).map((p) => p.id), claim: "reworded", why: "", honest: null },
    roles: input.pieces.filter((p) => p.kind === "role" && p.entry).map((r) => ({
      pieceId: r.id, title: r.entry!.title, employer: r.entry!.organisation, start: r.entry!.start, end: r.entry!.end, why: "",
      bullets: input.pieces.filter((p) => p.belongsTo === r.id).map((p) => ({ text: p.text, pieceIds: [p.id], claim: "as-written" as const, why: "", honest: null })),
    })),
    skills: input.pieces.filter((p) => p.kind === "skill").map((p) => ({ text: p.text, pieceIds: [p.id] })),
    evidence: [], notes: [],
  });
  const writer: Writer = {
    estimateCostUsd: () => costUsd * 2,
    draftPieces: async () => { throw new Error("not used"); },
    coachTurn: async () => { throw new Error("not used"); },
    learnVoice: async (input) => { calls.push({ task: "learn-voice", input }); return out({ rules: [] }); },
    tailorCv: async (input) => { calls.push({ task: "tailor-cv", input }); return out(cv(input)); },
    writeLetter: async (input) => {
      calls.push({ task: "write-letter", input });
      return out({ greeting: "Hello,", paragraphs: [{ sentences: [{ text: letterLine, forCompany: false, pieceIds: [] }] }], closing: "Kind regards," });
    },
    draftAnswer: async (input) => {
      calls.push({ task: "draft-answer", input });
      const p = input.pieces.find((x) => x.kind === "achievement")!;
      return out({ text: p.text, pieceIds: [p.id], claim: "as-written" as const, honest: null, companySpecific: false });
    },
  };
  return { writer, calls };
}

const onePage: DocumentRenderer = { render: async () => ({ pdf: new TextEncoder().encode("%PDF-fake"), pages: 1 }) };
const noText: PdfTextReader = { read: async () => ({ pages: [{ lines: [] }] }) };

function setup(env: Record<string, string | undefined>, overrides: Partial<TailoringCliDeps> = {}) {
  const root = mkdtempSync(join(tmpdir(), "apply-kit-tailoring-"));
  const reportsDir = join(root, "reports");
  const out: string[] = [];
  const spends: number[] = [];
  const writers = new Map<string, ReturnType<typeof fakeWriter>>();
  const created: { model?: string; maxPrice?: { prompt: number; completion: number } }[] = [];
  const deps: TailoringCliDeps = {
    env,
    setDir: join(repoRoot, "eval", "tailoring"),
    postingsDir: join(repoRoot, "eval", "extraction", "postings"),
    reportsDir,
    insideRepo: true,
    createWriter: (options) => {
      created.push(options);
      const model = options.model ?? "fake/flash";
      const w = fakeWriter(model, model === "fake/strong" ? "I am passionate about this work." : undefined);
      writers.set(model, w);
      return w.writer;
    },
    engine: (dir) => evaluationEngine({ renderer: onePage, pdfReader: noText, pdfDir: dir }),
    openLedger: () => ({ spentThisMonthUsd: () => spends.reduce((a, b) => a + b, 0), record: (usd) => { spends.push(usd); }, close() {} }),
    now: () => new Date("2026-10-16T08:00:00Z"),
    random: () => 0.3,
    log: (line) => out.push(line),
    ...overrides,
  };
  return { deps, out, spends, writers, created, reportsDir, root };
}

const key = { OPENROUTER_API_KEY: "test-key", AI_MONTHLY_CAP_USD: "10", OPENROUTER_MODEL: "fake/flash" };
const runDir = "tailoring-2026-10-16T08-00-00Z";

describe("pnpm eval:tailoring", () => {
  it("refuses without the OpenRouter key or a monthly cap, and calls nothing", async () => {
    for (const env of [{ AI_MONTHLY_CAP_USD: "10" }, { OPENROUTER_API_KEY: "test-key" }]) {
      const t = setup(env);
      expect(await runTailoringEvaluationCli(t.deps)).toBe(1);
      expect(t.out.join("\n")).toMatch(/OPENROUTER_API_KEY isn't set|AI_MONTHLY_CAP_USD isn't set/);
      expect(t.created).toHaveLength(0);
    }
  });

  it("refuses when the run could cross what is left of this month's budget, saying how much it needs", async () => {
    const t = setup({ ...key, AI_MONTHLY_CAP_USD: "0.01" });

    expect(await runTailoringEvaluationCli(t.deps)).toBe(1);
    expect(t.out.join("\n")).toMatch(/estimated at up to \$[\d.]+, but only \$0\.01 .* is left/);
    expect([...t.writers.values()].flatMap((w) => w.calls)).toHaveLength(0);
  });

  it("never reads a profile that isn't marked fictional from inside the repository", async () => {
    const t = setup(key);
    const set = join(t.root, "set");
    cpSync(t.deps.setDir, set, { recursive: true });
    const file = join(set, "profiles", "nia-design.json");
    writeFileSync(file, readFileSync(file, "utf8").replace("\"fictional\": true", "\"fictional\": false"));

    expect(await runTailoringEvaluationCli({ ...t.deps, setDir: set })).toBe(1);
    expect(t.out.join("\n")).toMatch(/nia-design isn't marked fictional/);
    // Outside the repository (in the data folder), real samples are allowed.
    expect(await runTailoringEvaluationCli({ ...t.deps, setDir: set, insideRepo: false, reportsDir: join(set, "reports") })).toBe(0);
  });

  it("runs end to end on the fixture set with one model and writes a readable report, booking the spending", async () => {
    const t = setup(key);

    expect(await runTailoringEvaluationCli(t.deps)).toBe(0);

    const dir = join(t.reportsDir, runDir);
    expect(readdirSync(dir).sort()).toEqual(expect.arrayContaining(["report.json", "report.md"]));
    const md = readFileSync(join(dir, "report.md"), "utf8");
    expect(md).toContain("# Tailoring evaluation");
    expect(md).toContain("8 cases");
    expect(md).toContain("### nia-a1 · ");
    expect(t.spends.length).toBe(8);
    expect(t.spends.every((s) => s > 0)).toBe(true);
    const said = t.out.join("\n");
    expect(said).toMatch(/\[8\/8\] nia-a1 · fake\/flash · \$/);
    expect(said).toContain(join(dir, "report.md"));
    expect(said).toMatch(/EVAL_STRONGER_MODEL/);
  });

  it("with a stronger model, writes only the blind sheet; the report comes once every verdict is recorded", async () => {
    const t = setup({ ...key, EVAL_STRONGER_MODEL: "fake/strong", EVAL_STRONGER_MAX_PRICE: "3,15" });

    expect(await runTailoringEvaluationCli(t.deps)).toBe(0);

    expect(t.created.map((c) => c.model ?? "default")).toEqual(["fake/flash", "fake/strong"]);
    expect(t.created[1]!.maxPrice).toEqual({ prompt: 3, completion: 15 });
    const dir = join(t.reportsDir, runDir);
    expect(existsSync(join(dir, "report.md"))).toBe(false);
    const sheetFile = join(dir, "blind-sheet.md");
    const sheet = readFileSync(sheetFile, "utf8");
    expect(sheet).toContain("## Case 8 of 8");
    expect(sheet).not.toMatch(/fake\/strong|fake\/flash/);
    // Nothing else in the folder names the models in plain text either.
    for (const f of readdirSync(dir)) {
      if (f === "pdfs") continue;
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/fake\/strong|fake\/flash/);
    }

    // Not every case judged yet: nothing is revealed.
    writeFileSync(sheetFile, sheet.replace("Verdict (A, B or same): ", "Verdict (A, B or same): A"));
    const out: string[] = [];
    expect(await recordTailoringVerdicts({ reportsDir: t.reportsDir, log: (l) => out.push(l) })).toBe(1);
    expect(out.join("\n")).toMatch(/7 cases have no verdict yet: Case 2 \(mira-tide\)/);
    expect(existsSync(join(dir, "report.md"))).toBe(false);

    writeFileSync(sheetFile, sheet.replace(/^Verdict \(A, B or same\): $/gm, "Verdict (A, B or same): B").replace(/^Why: $/gm, "Why: Plainer"));
    out.length = 0;
    expect(await recordTailoringVerdicts({ reportsDir: t.reportsDir, log: (l) => out.push(l) })).toBe(0);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    // random() = 0.3: the first model is Version A everywhere, so B is the stronger one.
    expect(md).toContain("fake/strong preferred 8 · fake/flash preferred 0 · the same 0.");
    expect(md).toMatch(/\| Stock phrases \| 0 \| 5 \|/); // The English stock phrase, in the five English letters.
    expect(JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf8")).tally).toEqual({ "fake/flash": 0, "fake/strong": 8, same: 0 });
    expect(out.join("\n")).toMatch(/fake\/strong preferred 8/);
  });
});
