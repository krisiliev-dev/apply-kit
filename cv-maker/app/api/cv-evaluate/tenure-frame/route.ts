import { generateText } from "ai";
import { z } from "zod";
import type {
  TenureExperienceSummary,
  TenurePatternWarning,
} from "@/lib/evaluation/types";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/cv-evaluate/tenure-frame
//
// Body:  { experiences: TenureExperienceSummary[], patterns: TenurePatternWarning[] }
// Reply: { framings: string[] }  — one or two one-sentence framings the user
//        can drop into their profile summary to pre-empt tenure-pattern
//        pushback.
//
// Rate-limited by an in-memory cache: identical input → cached framing for
// 10 minutes. Same cache survives server restart-free dev (it's just a
// module-level Map). Not shared across regions; that's fine for this.
//
// Model: Anthropic claude-sonnet-4-6 via the AI SDK provider. No tool calls,
// plain generateText — we want short, warm sentences, not a structured object.

export const runtime = "nodejs";
export const maxDuration = 30;

const experienceSchema = z.object({
  role: z.string(),
  company: z.string(),
  startMonth: z.number().nullable(),
  endMonth: z.number().nullable(),
  tenureMonths: z.number().nullable(),
});

const patternSchema = z.object({
  kind: z.enum([
    "consecutive-short-tenure",
    "overall-short-tenure",
    "gap",
  ]),
  message: z.string(),
  experienceIndexes: z.array(z.number()),
});

const bodySchema = z.object({
  experiences: z.array(experienceSchema).max(20),
  patterns: z.array(patternSchema).max(10),
  settings: z.unknown().optional(),
});

// In-memory cache — Map<hash, { framings, ts }>. Trimmed implicitly by TTL
// check on read. Node module scope; survives between requests within a
// warm server instance.
type CacheEntry = { framings: string[]; ts: number };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      {
        error: "Invalid body.",
        issues: parsed.error.issues.map((i) => i.message),
      },
      400,
    );
  }

  const settings = (raw && typeof raw === "object"
    ? ((raw as { settings?: Settings }).settings)
    : undefined);

  let resolved;
  try {
    resolved = resolveForRoute("evaluator", { settings });
  } catch (err) {
    return respondProviderError(err, { feature: "evaluator", settings });
  }

  const { experiences, patterns } = parsed.data;
  if (patterns.length === 0) {
    return json({ framings: [] });
  }

  const cacheKey = hashInput(experiences, patterns);
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return json({ framings: cached.framings, cached: true });
  }

  const prompt = buildPrompt(experiences, patterns);

  try {
    const { text, usage } = await generateText({
      model: resolved.model,
      system: SYSTEM,
      prompt,
    });
    const framings = splitFramings(text);
    CACHE.set(cacheKey, { framings, ts: Date.now() });
    return jsonWithUsage(
      { framings },
      {
        feature: resolved.feature,
        choice: resolved.choice,
        usage,
      },
    );
  } catch (err) {
    return respondProviderError(err, {
      feature: resolved.feature,
      choice: resolved.choice,
    });
  }
}

const SYSTEM = `You help a candidate reframe a tenure pattern before a recruiter notices it.

You will see:
  • A list of experiences (role, company, month counts).
  • Flagged patterns: short consecutive stints, low average tenure, or gaps.

Return one or two sentences the candidate could add to their profile summary.
Each sentence should:
  • Own the pattern rather than hide it.
  • Reframe it as an intentional operating mode, not a flaw.
  • Be concrete — reference a skill or a pace, not a vibe.
  • Be short. One line. No preamble, no markdown, no quotes.

Examples of the shape we want:
  "Operator-type — thrives on 6–12 month ship cycles and chooses assignments accordingly."
  "Two deliberate breaks in the last five years for full-stack learning sprints; both shipped."

Output plain text. Separate multiple sentences with a newline. No bullets, no numbering.`;

function buildPrompt(
  experiences: TenureExperienceSummary[],
  patterns: TenurePatternWarning[],
): string {
  const lines: string[] = [];
  lines.push("Experiences (most recent first):");
  experiences.forEach((e, i) => {
    const tenure = e.tenureMonths !== null ? `${e.tenureMonths}mo` : "?";
    lines.push(`  ${i + 1}. ${e.role} · ${e.company} · ${tenure}`);
  });
  lines.push("");
  lines.push("Flagged patterns:");
  patterns.forEach((p) => {
    lines.push(`  • [${p.kind}] ${p.message}`);
  });
  lines.push("");
  lines.push("Return one or two framings now.");
  return lines.join("\n");
}

// Split model output into separate one-liners — newline, semicolon, or
// sentence boundary with a pipe. Keep only the non-empty ones.
function splitFramings(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((s) => s.trim().replace(/^[-•*]\s*/, "").replace(/^\d+[.)]\s*/, ""))
    .filter((s) => s.length > 0 && s.length < 280)
    .slice(0, 2);
}

// Stable JSON-style hash. String-based, since it's keyed by content not size.
function hashInput(
  experiences: TenureExperienceSummary[],
  patterns: TenurePatternWarning[],
): string {
  const payload = JSON.stringify({
    e: experiences.map((x) => [
      x.role,
      x.company,
      x.startMonth,
      x.endMonth,
      x.tenureMonths,
    ]),
    p: patterns.map((x) => [x.kind, x.message]),
  });
  // Cheap FNV-1a-ish roll; good enough for a cache key.
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
