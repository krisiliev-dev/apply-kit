import type { CvDocument, TextNode } from "@/lib/doc/types";
import type { NumberInspectorFlag, NumberInspectorReport } from "./types";

// ————————————————————————————————————————————————
// "Where's the number?" inspector.
//
// Walks every text node in the CvDocument and surfaces bullets that claim an
// outcome (improved, shipped, scaled, led, …) but include no scope, metric,
// or baseline. A bullet like "Improved site performance" is weaker than
// "Cut p95 latency 38% (700ms → 430ms) across 3M MAU" — this catches the
// former so the author can add the number.
//
// Runs entirely client-side with no LLM call — cheap enough to fire on every
// keystroke, which is what the NumberInspectorPanel does.
// ————————————————————————————————————————————————

// Verbs that claim a result — presence of one of these without a number is
// the core signal we care about. Deliberately conservative (false-negatives
// are better than over-flagging cosmetic lines).
const OUTCOME_VERB_PATTERNS: RegExp[] = [
  /\b(improv|increas|reduc|decreas|drov?|drove)\w*\b/i,
  /\b(ship|shipp|deliver|launch|rollout|rolled out)\w*\b/i,
  /\b(scal|grew|grow|expand|accelerat)\w*\b/i,
  /\b(led|leading|manag|direct|own|owned|driv)\w*\b/i,
  /\b(built|build|architect|design|redesign|rebuilt|rebuild)\w*\b/i,
  /\b(cut|saved|save|sav)\w*\b/i,
  /\b(migrat|convert|transform|overhaul|refactor)\w*\b/i,
  /\b(optimiz|stabili|automat|streamlin)\w*\b/i,
];

// Numbers, percentages, money, units. If any match, the bullet has "a number".
const NUMBER_PATTERNS: RegExp[] = [
  /\b\d+[,\d]*(?:\.\d+)?\b/, // 12, 1,234, 3.14
  /\b\d+%\b/, // 42%
  /[$€£¥]\s?\d/, // $5, €12
  /\b\d+\s?(?:k|m|b|bn|mm)\b/i, // 5k, 10M
];

// Words that imply magnitude, scope, or user volume even without digits.
// These rescue bullets like "led team of dozens" — less common but valid.
const MAGNITUDE_WORDS: RegExp[] = [
  /\b(millions?|thousands?|hundreds?|dozens?)\b/i,
  /\b(users?|customers?|clients?|tenants?|members?|employees?|engineers?|developers?|teams?)\b/i,
  /\b(requests?|queries|ops|rps|qps|tps|iops)\b/i,
  /\b(revenue|arr|mrr|gmv|nrr|cac|ltv|bookings?)\b/i,
  /\b(ms|milliseconds?|seconds?|minutes?|hours?)\b/i,
  /\b(p50|p90|p95|p99|latency|throughput|bandwidth|uptime)\b/i,
];

// A node is "a bullet" if it starts with a bullet marker OR its layer name
// suggests it's part of an experience/project section. We also accept nodes
// whose content is a single sentence with an outcome verb — those often live
// inside a bulleted block even if the bullet character lives in a sibling.
const BULLET_MARKER_RE = /^\s*[•\-\*•◦]\s+/;

const EXPERIENCE_NAME_RE = /\b(exp|experience|project|work|bullet|role)\b/i;

export function inspectNumbers(doc: CvDocument): NumberInspectorReport {
  const flagged: NumberInspectorFlag[] = [];
  let totalBullets = 0;
  let bulletsWithMetrics = 0;

  for (const node of iterTextNodes(doc)) {
    if (!isBulletLike(node)) continue;

    // A text node may be a multi-line bulleted block. Treat each non-empty
    // line that has an outcome verb as its own candidate. The marker is
    // stripped before the metric check so `"• Improved X"` is scored the same
    // as `"Improved X"`.
    const lines = node.content
      .split(/\r?\n/)
      .map((l) => stripMarker(l).trim())
      .filter((l) => l.length > 0);

    // If the block itself looks like one bullet (no newlines), score the whole
    // thing as one bullet rather than per-sentence.
    const candidates = lines.length <= 1 ? [stripMarker(node.content).trim()] : lines;

    let nodeHasOutcome = false;
    let nodeHasMetric = false;

    for (const line of candidates) {
      if (!line) continue;
      const hasVerb = hasOutcomeVerb(line);
      if (!hasVerb) continue;

      nodeHasOutcome = true;
      totalBullets++;

      if (hasMetricOrScope(line)) {
        bulletsWithMetrics++;
        nodeHasMetric = true;
      } else {
        flagged.push({
          nodeId: node.id,
          text: truncate(line, 140),
          reason: "Outcome verb without a number, percentage, or scope.",
        });
      }
    }

    // A defensive fallback: if the node had NO line-level outcome but reads
    // like a bullet (short, starts with marker), still check the whole node.
    if (!nodeHasOutcome && candidates.length > 0) {
      const whole = candidates.join(" ");
      if (hasOutcomeVerb(whole)) {
        totalBullets++;
        if (hasMetricOrScope(whole)) {
          bulletsWithMetrics++;
        } else {
          flagged.push({
            nodeId: node.id,
            text: truncate(whole, 140),
            reason: "Outcome verb without a number, percentage, or scope.",
          });
        }
      }
    } else if (nodeHasOutcome && !nodeHasMetric && candidates.length > 1) {
      // already flagged per-line — nothing more to do
    }
  }

  const score = totalBullets === 0 ? 100 : Math.round((bulletsWithMetrics / totalBullets) * 100);

  return {
    totalBullets,
    bulletsWithMetrics,
    flaggedBullets: flagged,
    score,
  };
}

function* iterTextNodes(doc: CvDocument): Generator<TextNode> {
  for (const page of doc.pages) {
    for (const n of page.nodes) {
      if (n.type === "text" && !n.hidden) yield n;
    }
  }
}

function isBulletLike(node: TextNode): boolean {
  const content = node.content.trim();
  if (!content) return false;
  if (BULLET_MARKER_RE.test(content)) return true;
  if (node.name && EXPERIENCE_NAME_RE.test(node.name)) return true;
  // Multi-line block where every non-empty line has a bullet marker.
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length >= 2 && lines.every((l) => BULLET_MARKER_RE.test(l))) {
    return true;
  }
  return false;
}

function stripMarker(line: string): string {
  return line.replace(BULLET_MARKER_RE, "");
}

function hasOutcomeVerb(text: string): boolean {
  return OUTCOME_VERB_PATTERNS.some((re) => re.test(text));
}

function hasMetricOrScope(text: string): boolean {
  for (const re of NUMBER_PATTERNS) {
    if (re.test(text)) return true;
  }
  for (const re of MAGNITUDE_WORDS) {
    if (re.test(text)) return true;
  }
  return false;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
