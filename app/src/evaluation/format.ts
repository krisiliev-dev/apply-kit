// The evaluation's printed tables: one row per fact type, then the headline score per slice.
import type { EvaluationSummary, FactScore } from "@apply-kit/core";

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);

/** F1 for list facts, accuracy for single facts. */
export const headline = (f: FactScore) => (f.type === "list" ? f.f1 : f.accuracy);

function change(now: FactScore, before: EvaluationSummary | undefined): string {
  const then = before?.facts.find((f) => f.fact === now.fact);
  const a = headline(now), b = then ? headline(then) : null;
  if (a == null || b == null) return "";
  const d = Math.round((a - b) * 100);
  return d === 0 ? "±0" : d > 0 ? `+${d}` : `${d}`;
}

const table = (rows: string[][]) => {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd());
};

export function formatSummary(summary: EvaluationSummary, previous?: EvaluationSummary): string[] {
  const rows = [["fact", "measure", "score", ...(previous ? ["vs last (pts)"] : []), "detail"]];
  for (const f of summary.facts) {
    const detail = f.type === "list"
      ? `precision ${pct(f.precision)} · recall ${pct(f.recall)} · ${f.expected} labelled, ${f.extracted} found, ${f.matched} matched${f.kindAgreement == null ? "" : ` · required/preferred right ${pct(f.kindAgreement)}`}`
      : `${f.correct}/${f.total} postings`;
    rows.push([f.fact, f.type === "list" ? "F1" : "accuracy", pct(headline(f)), ...(previous ? [change(f, previous)] : []), detail]);
  }
  return table(rows);
}

export function formatSlices(summary: EvaluationSummary, slices: Record<string, EvaluationSummary>): string[] {
  const order = ["en", "bg", "dev", "security", "design"];
  const keys = [...order.filter((k) => slices[k]), ...Object.keys(slices).filter((k) => !order.includes(k)).sort()];
  const rows = [["fact", "all", ...keys.map((k) => `${k} (${slices[k]!.postings})`)]];
  for (const f of summary.facts) {
    rows.push([f.fact, pct(headline(f)), ...keys.map((k) => pct(headline(slices[k]!.facts.find((x) => x.fact === f.fact)!)))]);
  }
  return table(rows);
}
