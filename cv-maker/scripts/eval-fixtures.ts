/*
 * Fixture-based eval harness.
 *
 * Usage: `npm run eval:fixtures` (requires `npm run dev` in a separate shell).
 *
 * For each fictional posting under `scripts/fixtures/*.json` the script:
 *   1. POSTs the description to /api/jobs/parse → ParsedJob
 *   2. POSTs (baseCv, job) to /api/jobs/draft (skipEvaluation=true for speed)
 *   3. POSTs (doc) to /api/cv-evaluate
 *   4. Captures score, warnings, timing, cost from the `x-cv-usage` response
 *      header at each hop.
 * Then writes a Markdown report to scripts/fixtures/report-YYYY-MM-DD.md.
 *
 * The script does not spin up its own dev server — it expects one at
 * BASE_URL (default http://localhost:3000). If the dev server isn't running
 * you'll get a clear error with a prompt to start it.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engineerCV } from "@/content/cvs/engineer";
import type { ParsedJob } from "@/lib/app/types";
import type { CvEvaluation } from "@/lib/evaluation/types";
import type { CvDocument } from "@/lib/doc/types";
import { seedFromContent } from "@/lib/jobs/seedFromContent";
import { decodeUsageHeader } from "@/lib/ai/tokenTracker";
import type { CVContent } from "@/lib/types";

type Fixture = {
  id: string;
  description: string;
  expectedKeywords: string[];
};

type HopResult<T> = {
  ok: true;
  body: T;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
} | {
  ok: false;
  error: string;
  status?: number;
  durationMs: number;
};

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const FIXTURES_DIR = join(process.cwd(), "scripts", "fixtures");
const REPORT_PATH = join(
  FIXTURES_DIR,
  `report-${new Date().toISOString().slice(0, 10)}.md`,
);

async function main(): Promise<void> {
  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found in scripts/fixtures/*.json");
    process.exit(1);
  }
  console.log(`Eval harness — ${fixtures.length} fixture(s) against ${BASE_URL}`);
  console.log(`Base CV: ${engineerCV.slug} (${engineerCV.targetRole})`);

  const reachable = await checkDevServer();
  if (!reachable) {
    console.error(
      `\n✗ Dev server not reachable at ${BASE_URL}. Start it with:` +
        `\n    npm run dev\n  and re-run this script.`,
    );
    process.exit(2);
  }

  const rows: ReportRow[] = [];
  for (const f of fixtures) {
    console.log(`\n— ${f.id}`);
    const row = await runOne(f);
    rows.push(row);
    logRow(row);
  }

  const md = renderReport(rows);
  writeFileSync(REPORT_PATH, md, "utf8");
  console.log(`\n✓ Report written to ${REPORT_PATH}`);
}

function loadFixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const file of readdirSync(FIXTURES_DIR)) {
    if (!file.endsWith(".json")) continue;
    const raw = readFileSync(join(FIXTURES_DIR, file), "utf8");
    const parsed = JSON.parse(raw) as Fixture;
    if (!parsed.id || !parsed.description) continue;
    out.push(parsed);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

async function checkDevServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/pair/pending-count`, {
      method: "GET",
    });
    // Any response (even 4xx) proves the server is up.
    return res.status < 500;
  } catch {
    return false;
  }
}

type ReportRow = {
  id: string;
  parseResult: HopResult<{ job: ParsedJob }>;
  draftResult: HopResult<{ cv: unknown; eval?: unknown }>;
  evalResult: HopResult<CvEvaluation>;
  score: number | null;
  warningCount: number;
  keywordHits: { expected: number; matched: number };
  totalCostUsd: number;
  totalDurationMs: number;
};

async function runOne(f: Fixture): Promise<ReportRow> {
  const parseResult = await postJson<{ job: ParsedJob }>("/api/jobs/parse", {
    text: f.description,
  });

  let draftResult: HopResult<{ cv: unknown; eval?: unknown }> = {
    ok: false,
    error: "skipped — parse failed",
    durationMs: 0,
  };
  let evalResult: HopResult<CvEvaluation> = {
    ok: false,
    error: "skipped — draft failed",
    durationMs: 0,
  };
  let score: number | null = null;
  let warningCount = 0;

  if (parseResult.ok) {
    draftResult = await postJson<{ cv: CVContent; eval?: unknown }>(
      "/api/jobs/draft",
      {
        job: parseResult.body.job,
        baseCv: engineerCV,
        skipEvaluation: true,
      },
    );

    if (draftResult.ok) {
      // Seed a CvDocument from the drafted CVContent so the evaluator has
      // something structural to chew on.
      const tailoredContent = draftResult.body.cv as CVContent;
      const doc: CvDocument = seedFromContent(
        tailoredContent.slug || engineerCV.slug,
        tailoredContent,
      );
      evalResult = await postJson<CvEvaluation>("/api/cv-evaluate", {
        doc,
        parsedJob: parseResult.body.job,
      });
      if (evalResult.ok) {
        score = evalResult.body.overall;
        warningCount = evalResult.body.warnings.length;
      }
    }
  }

  const matchedKeywords = parseResult.ok
    ? countMatches(parseResult.body.job.keywords, f.expectedKeywords)
    : 0;

  const totalCostUsd = sum([
    parseResult.ok ? parseResult.costUsd : 0,
    draftResult.ok ? draftResult.costUsd : 0,
    evalResult.ok ? evalResult.costUsd : 0,
  ]);
  const totalDurationMs =
    parseResult.durationMs + draftResult.durationMs + evalResult.durationMs;

  return {
    id: f.id,
    parseResult,
    draftResult,
    evalResult,
    score,
    warningCount,
    keywordHits: {
      expected: f.expectedKeywords.length,
      matched: matchedKeywords,
    },
    totalCostUsd,
    totalDurationMs,
  };
}

async function postJson<T>(
  path: string,
  body: unknown,
): Promise<HopResult<T>> {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const durationMs = Date.now() - start;
    const usage = decodeUsageHeader(res.headers.get("x-cv-usage"));
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: extractError(parsed) ?? `HTTP ${res.status}`,
        status: res.status,
        durationMs,
      };
    }
    return {
      ok: true,
      body: parsed as T,
      durationMs,
      costUsd: usage?.costUsd ?? 0,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

function countMatches(actual: string[], expected: string[]): number {
  const lower = new Set(actual.map((s) => s.toLowerCase().trim()));
  let matches = 0;
  for (const e of expected) {
    if (lower.has(e.toLowerCase().trim())) matches++;
    else {
      // Loose match — partial substring.
      for (const a of lower) {
        if (a.includes(e.toLowerCase()) || e.toLowerCase().includes(a)) {
          matches++;
          break;
        }
      }
    }
  }
  return matches;
}

function extractError(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const v = (body as Record<string, unknown>).error;
    if (typeof v === "string") return v;
  }
  return null;
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function logRow(row: ReportRow): void {
  const parts = [
    row.parseResult.ok ? "parse ✓" : `parse ✗ (${row.parseResult.error.slice(0, 60)})`,
    row.draftResult.ok ? "draft ✓" : `draft ✗ (${row.draftResult.error.slice(0, 60)})`,
    row.evalResult.ok
      ? `eval ✓ score=${row.score}/100 warn=${row.warningCount}`
      : `eval ✗ (${row.evalResult.error.slice(0, 60)})`,
    `keywords=${row.keywordHits.matched}/${row.keywordHits.expected}`,
    `cost=$${row.totalCostUsd.toFixed(4)}`,
    `${row.totalDurationMs}ms`,
  ];
  console.log(`  ${parts.join(" · ")}`);
}

function renderReport(rows: ReportRow[]): string {
  const totalCost = rows.reduce((s, r) => s + r.totalCostUsd, 0);
  const totalMs = rows.reduce((s, r) => s + r.totalDurationMs, 0);
  const scored = rows.filter((r) => r.score !== null);
  const avgScore =
    scored.length === 0
      ? null
      : scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length;

  const lines: string[] = [];
  lines.push(`# Fixture eval report — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Base CV: \`${engineerCV.slug}\` (${engineerCV.targetRole})`);
  lines.push(`Endpoint: ${BASE_URL}`);
  lines.push("");
  lines.push(`Total cost: $${totalCost.toFixed(4)}`);
  lines.push(`Total time: ${totalMs}ms`);
  if (avgScore !== null) {
    lines.push(`Average eval score: ${avgScore.toFixed(1)}/100`);
  }
  lines.push("");
  lines.push("## Per-fixture");
  lines.push("");
  lines.push(
    "| Fixture | Parse | Draft | Eval | Score | Warn | Keywords | Cost | Time |",
  );
  lines.push(
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of rows) {
    lines.push(
      [
        `\`${r.id}\``,
        r.parseResult.ok ? "✓" : "✗",
        r.draftResult.ok ? "✓" : "✗",
        r.evalResult.ok ? "✓" : "✗",
        r.score ?? "—",
        r.warningCount,
        `${r.keywordHits.matched}/${r.keywordHits.expected}`,
        `$${r.totalCostUsd.toFixed(4)}`,
        `${r.totalDurationMs}ms`,
      ]
        .map((v) => `| ${v}`)
        .join(" ") + " |",
    );
  }
  lines.push("");
  lines.push("## Failure details");
  lines.push("");
  for (const r of rows) {
    const fails: string[] = [];
    if (!r.parseResult.ok) fails.push(`parse: ${r.parseResult.error}`);
    if (!r.draftResult.ok && r.parseResult.ok) fails.push(`draft: ${r.draftResult.error}`);
    if (!r.evalResult.ok && r.draftResult.ok) fails.push(`eval: ${r.evalResult.error}`);
    if (fails.length === 0) continue;
    lines.push(`### \`${r.id}\``);
    for (const f of fails) lines.push(`- ${f}`);
    lines.push("");
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
