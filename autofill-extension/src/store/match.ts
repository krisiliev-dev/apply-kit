import type { AnswerRecord, FieldContext, MatchResult } from "../shared/types";
import { jaccard } from "../shared/normalize";
import { allRecords, getByQuestion } from "./db";

// Thresholds are intentionally gentle — we only *suggest*, the user always decides.
const EXACT_CONF = 1;
const JACCARD_MIN = 0.45;
const KIND_PENALTY = 0.15;

// TODO: upgrade to embedding-based semantic match once paraphrase API is wired.
// Shape is already there: swap the `jaccard(...)` call with a cosine-sim over vectors
// stored alongside each record.

export async function findBestMatch(
  field: FieldContext,
): Promise<MatchResult | null> {
  // 1. Exact normalized question match first (cheap, index-backed).
  const exact = await getByQuestion(field.questionNormalized);
  if (exact && exact.answers.length > 0) {
    const latest = exact.answers[exact.answers.length - 1];
    if (latest) {
      return {
        record: exact,
        confidence: EXACT_CONF - (exact.fieldKind === field.kind ? 0 : KIND_PENALTY),
        suggestion: latest.value,
      };
    }
  }

  // 2. Fuzzy fallback over all records. In practice the store is small (hundreds of
  // entries) so linear scan is fine. Replace with ANN once we add embeddings.
  const records = await allRecords();
  let best: MatchResult | null = null;
  for (const rec of records) {
    if (rec.answers.length === 0) continue;
    const sim = jaccard(field.questionNormalized, rec.questionNormalized);
    if (sim < JACCARD_MIN) continue;
    const kindPenalty = rec.fieldKind === field.kind ? 0 : KIND_PENALTY;
    const conf = sim - kindPenalty;
    if (!best || conf > best.confidence) {
      const latest = rec.answers[rec.answers.length - 1];
      if (!latest) continue;
      best = { record: rec, confidence: conf, suggestion: latest.value };
    }
  }

  return best;
}

export function pickLatest(rec: AnswerRecord): string | null {
  if (rec.answers.length === 0) return null;
  return rec.answers[rec.answers.length - 1]?.value ?? null;
}
