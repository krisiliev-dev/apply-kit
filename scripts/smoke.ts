/*
 * Smoke test — hits every API endpoint with minimal-but-valid payloads.
 *
 * Goals:
 *   - AI-backed routes: when ANTHROPIC_API_KEY is *not* set, they must return
 *     400 with the canonical key-missing message (backward compat).
 *   - Non-AI routes (discover/*, jobs/ats-schema, pair/*): must return 2xx
 *     on valid input.
 *
 * Exits 0 on all-pass, 1 on any-fail. Prints a route-by-route summary.
 * Requires the dev server running at BASE_URL.
 */

import { engineerCV } from "@/content/cvs/engineer";
import { profile } from "@/content/profile";
import { seedFromContent } from "@/lib/jobs/seedFromContent";
import type { ParsedJob } from "@/lib/app/types";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

type Expected =
  | { kind: "ok" }
  | { kind: "status"; code: number }
  | { kind: "either"; codes: number[] };

type Probe = {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  expectedWhenKeyPresent: Expected;
  expectedWhenKeyMissing?: Expected;
  assertErrorContains?: string;
};

const SAMPLE_JOB: ParsedJob = {
  title: "Smoke Tester",
  company: "Smoke Inc",
  location: "Remote",
  description: "A synthetic posting used by the smoke script.",
  requirements: ["TypeScript", "Tests"],
  responsibilities: ["Run smoke tests", "Report results"],
  niceToHave: ["Vitest"],
  keywords: ["TypeScript", "smoke", "vitest"],
};

const SAMPLE_DOC = seedFromContent(engineerCV.slug, engineerCV);

const PROBES: Probe[] = [
  // ————————————————————————————————————————————
  // AI routes — key-present → 200-ish, key-missing → 400 with canonical msg
  // ————————————————————————————————————————————
  {
    name: "POST /api/jobs/parse",
    method: "POST",
    path: "/api/jobs/parse",
    body: {
      text:
        "Staff engineer at a fictional company. 8 years of backend experience. TypeScript, Kafka, PostgreSQL.",
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/jobs/draft",
    method: "POST",
    path: "/api/jobs/draft",
    body: { job: SAMPLE_JOB, baseCv: engineerCV, skipEvaluation: true },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/cv-evaluate",
    method: "POST",
    path: "/api/cv-evaluate",
    body: { doc: SAMPLE_DOC },
    // The evaluator runs some passes even without a key (static inspectors),
    // so we accept 200.
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "ok" },
  },
  {
    name: "POST /api/cv-evaluate/refine (shape-check)",
    method: "POST",
    path: "/api/cv-evaluate/refine",
    body: { doc: SAMPLE_DOC, maxIterations: 1 },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "ok" },
  },
  {
    name: "POST /api/cv-evaluate/tenure-frame",
    method: "POST",
    path: "/api/cv-evaluate/tenure-frame",
    body: {
      experiences: [
        { role: "SWE", company: "A", startMonth: 0, endMonth: 6, tenureMonths: 6 },
      ],
      patterns: [],
    },
    expectedWhenKeyPresent: { kind: "ok" },
    // The route validates the Anthropic key before the short-circuit, so a
    // missing key surfaces as the canonical 400 even when the body is fine.
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/paraphrase",
    method: "POST",
    path: "/api/paraphrase",
    body: { text: "Please make this sound clearer." },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/cover-letter",
    method: "POST",
    path: "/api/cover-letter",
    body: { applicationId: "app_smoke", baseCV: engineerCV },
    // streams plain text; can't easily assert content, just the status code
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/chat",
    method: "POST",
    path: "/api/chat",
    body: {
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
      document: SAMPLE_DOC,
      selectedIds: [],
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/apply-fit/check",
    method: "POST",
    path: "/api/apply-fit/check",
    body: {
      parsedJob: SAMPLE_JOB,
      baseCV: engineerCV,
      profile,
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/pre-screen/draft",
    method: "POST",
    path: "/api/pre-screen/draft",
    body: {
      applicationId: "app_smoke",
      questions: [{ prompt: "Why us?", wordLimit: 100 }],
      baseCV: engineerCV,
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/follow-up/draft",
    method: "POST",
    path: "/api/follow-up/draft",
    body: {
      applicationId: "app_smoke",
      application: {
        id: "app_smoke",
        company: "Smoke Inc",
        role: "Tester",
        status: "applied",
        dateCreated: Date.now(),
        events: [],
      },
      kind: "post-apply",
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/interview/generate",
    method: "POST",
    path: "/api/interview/generate",
    body: {
      applicationId: "app_smoke",
      application: {
        id: "app_smoke",
        company: "Smoke Inc",
        role: "Tester",
        status: "screen",
        dateCreated: Date.now(),
        events: [],
      },
      baseCV: engineerCV,
      questionCount: 4,
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/interview/research",
    method: "POST",
    path: "/api/interview/research",
    body: { company: "Smoke Inc", role: "Tester" },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/rejection/extract",
    method: "POST",
    path: "/api/rejection/extract",
    body: {
      applicationId: "app_smoke",
      application: {
        id: "app_smoke",
        company: "Smoke Inc",
        role: "Tester",
        status: "rejected",
        dateCreated: Date.now(),
        events: [],
      },
      rawText: "We've decided to move forward with other candidates.",
      kind: "auto-rejection",
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/review/summarize",
    method: "POST",
    path: "/api/review/summarize",
    body: {
      funnel: { total: 1, applied: 1, screen: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0, ghosted: 0 },
      weekly: [],
      histogram: { buckets: [], sampleCount: 0, medianDays: null },
      variants: [],
      stall: { totalLosses: 0, counts: { resume: 0, screen: 0, interview: 0, final: 0, offer: 0 }, flag: null },
      lessons: [],
    },
    // total=1 → model call → key-missing triggers 400. But the handler
    // short-circuits when total=0. We use total=1 to exercise the key path.
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/salary/parse",
    method: "POST",
    path: "/api/salary/parse",
    body: { rawOfferText: "Base $180k, 0.25% equity, 4yr vest 1yr cliff." },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/salary/analyze",
    method: "POST",
    path: "/api/salary/analyze",
    body: {
      offer: {
        baseSalary: 180000,
        currency: "USD",
        equity: "0.25%",
        receivedAt: Date.now(),
        rawOfferText: "Base $180k",
      },
      baseCV: engineerCV,
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/advisor/narrative",
    method: "POST",
    path: "/api/advisor/narrative",
    body: { profile, cvVariants: [engineerCV] },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/advisor/skills",
    method: "POST",
    path: "/api/advisor/skills",
    body: {
      profile,
      cvVariants: [engineerCV],
      recentPostings: [SAMPLE_JOB],
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/advisor/ceiling",
    method: "POST",
    path: "/api/advisor/ceiling",
    body: {
      profile,
      cvVariants: [engineerCV],
      roles: [{ title: "Principal Engineer", company: "Smoke Inc" }],
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/advisor/decisions",
    method: "POST",
    path: "/api/advisor/decisions",
    body: {
      kind: "offer-evaluation",
      input: { kind: "offer-evaluation", freeform: "Evaluate this fake offer." },
    },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
    assertErrorContains: "ANTHROPIC_API_KEY",
  },
  {
    name: "POST /api/advisor/pacing (no model)",
    method: "POST",
    path: "/api/advisor/pacing",
    body: { applications: [] },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "ok" },
  },

  // ————————————————————————————————————————————
  // Non-AI routes — should work regardless of key
  // ————————————————————————————————————————————
  {
    name: "POST /api/discover/fetch",
    method: "POST",
    path: "/api/discover/fetch",
    body: { prefs: {} },
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "ok" },
  },
  {
    name: "POST /api/discover/ingest (invalid)",
    method: "POST",
    path: "/api/discover/ingest",
    body: {},
    // invalid body → 400 is the correct shape response, proves route is alive.
    expectedWhenKeyPresent: { kind: "status", code: 400 },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
  },
  {
    name: "GET /api/jobs/ats-schema (404 expected)",
    method: "GET",
    path: "/api/jobs/ats-schema?url=https://example.com",
    // Unknown ATS → 404 by design. Proves route is alive.
    expectedWhenKeyPresent: { kind: "status", code: 404 },
    expectedWhenKeyMissing: { kind: "status", code: 404 },
  },
  {
    name: "POST /api/pair/begin",
    method: "POST",
    path: "/api/pair/begin",
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "ok" },
  },
  {
    name: "GET /api/pair/devices",
    method: "GET",
    path: "/api/pair/devices",
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "ok" },
  },
  {
    name: "GET /api/pair/pending-count",
    method: "GET",
    path: "/api/pair/pending-count",
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "ok" },
  },
  {
    name: "POST /api/pair/pull",
    method: "POST",
    path: "/api/pair/pull",
    expectedWhenKeyPresent: { kind: "ok" },
    expectedWhenKeyMissing: { kind: "ok" },
  },
  {
    name: "POST /api/pair/revoke (missing deviceId)",
    method: "POST",
    path: "/api/pair/revoke",
    body: {},
    // Expect 400 — proves route is alive and validates input.
    expectedWhenKeyPresent: { kind: "status", code: 400 },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
  },
  {
    name: "POST /api/pair/complete (invalid)",
    method: "POST",
    path: "/api/pair/complete",
    body: {},
    expectedWhenKeyPresent: { kind: "status", code: 400 },
    expectedWhenKeyMissing: { kind: "status", code: 400 },
  },
  {
    name: "POST /api/pair/ingest (unauthorized)",
    method: "POST",
    path: "/api/pair/ingest",
    body: { items: [] },
    // No Authorization header → 401 expected. Proves route is alive.
    expectedWhenKeyPresent: { kind: "either", codes: [401, 400] },
    expectedWhenKeyMissing: { kind: "either", codes: [401, 400] },
  },
];

async function main(): Promise<void> {
  console.log(`Smoke test — ${PROBES.length} probes against ${BASE_URL}`);
  console.log(`ANTHROPIC_API_KEY: ${HAS_KEY ? "present" : "missing"}`);
  console.log("");

  const reachable = await checkDevServer();
  if (!reachable) {
    console.error(
      `\n✗ Dev server not reachable at ${BASE_URL}. Start it with:` +
        `\n    npm run dev\n  and re-run this script.`,
    );
    process.exit(2);
  }

  let passed = 0;
  let failed = 0;
  const failures: Array<{ name: string; reason: string }> = [];
  for (const probe of PROBES) {
    const outcome = await runProbe(probe);
    if (outcome.pass) {
      passed++;
      console.log(`✓ ${probe.name}  — ${outcome.detail}`);
    } else {
      failed++;
      failures.push({ name: probe.name, reason: outcome.detail });
      console.log(`✗ ${probe.name}  — ${outcome.detail}`);
    }
  }
  console.log("");
  console.log(`Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.name}: ${f.reason}`);
    process.exit(1);
  }
  process.exit(0);
}

async function checkDevServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/pair/pending-count`);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function runProbe(
  probe: Probe,
): Promise<{ pass: boolean; detail: string }> {
  const expectation = HAS_KEY
    ? probe.expectedWhenKeyPresent
    : probe.expectedWhenKeyMissing ?? probe.expectedWhenKeyPresent;
  let status = 0;
  let bodyText = "";
  try {
    const init: RequestInit = { method: probe.method };
    if (probe.body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(probe.body);
    }
    const res = await fetch(`${BASE_URL}${probe.path}`, init);
    status = res.status;
    // Don't block on streaming bodies — just read a capped slice.
    const text = await res.text();
    bodyText = text.slice(0, 400);
  } catch (err) {
    return {
      pass: false,
      detail: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const statusOk = statusMatches(status, expectation);
  let assertOk = true;
  if (!HAS_KEY && probe.assertErrorContains) {
    assertOk = bodyText.includes(probe.assertErrorContains);
  }

  const detail = `status=${status}${!statusOk ? ` (expected ${describeExpectation(expectation)})` : ""}${
    !assertOk ? ` | body missing "${probe.assertErrorContains}"` : ""
  }`;
  return {
    pass: statusOk && assertOk,
    detail,
  };
}

function statusMatches(status: number, expected: Expected): boolean {
  if (expected.kind === "ok") return status >= 200 && status < 300;
  if (expected.kind === "status") return status === expected.code;
  if (expected.kind === "either") return expected.codes.includes(status);
  return false;
}

function describeExpectation(exp: Expected): string {
  if (exp.kind === "ok") return "2xx";
  if (exp.kind === "status") return String(exp.code);
  return exp.codes.join("|");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
