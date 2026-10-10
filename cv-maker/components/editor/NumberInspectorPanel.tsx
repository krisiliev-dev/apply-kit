"use client";

import { useMemo } from "react";
import { useEditor } from "@/lib/doc/store";
import { inspectNumbers } from "@/lib/evaluation/numberInspector";

// Inline "where's the number?" inspector. Re-runs on every doc change. Shows
// a dense list of flagged bullets; clicking a row selects the source node on
// the canvas so the author can jump straight to the fix.
//
// Fast enough (~1ms on typical CVs) to run live as the user types. Re-runs
// automatically on every doc change because useEditor subscribes us.
export function NumberInspectorPanel() {
  const doc = useEditor((s) => s.doc);
  const select = useEditor((s) => s.select);

  const report = useMemo(() => inspectNumbers(doc), [doc]);

  const color =
    report.score >= 80
      ? "#4ec16d"
      : report.score >= 60
        ? "#d6a63d"
        : "#d64933";

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          Where&apos;s the number?
        </h3>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color }}
        >
          {report.bulletsWithMetrics}/{report.totalBullets}
        </span>
      </div>

      {report.totalBullets === 0 ? (
        <p className="mt-1 font-mono text-[11px] text-[var(--color-editor-text-dim)] leading-snug">
          No outcome-claiming bullets detected yet. Bullets with verbs like
          &ldquo;shipped&rdquo;, &ldquo;led&rdquo;, &ldquo;improved&rdquo; will
          appear here.
        </p>
      ) : report.flaggedBullets.length === 0 ? (
        <p className="mt-1 font-mono text-[11px] text-[var(--color-editor-text-dim)] leading-snug">
          Every outcome bullet has a number or scope. Nice.
        </p>
      ) : (
        <ul className="mt-2 space-y-1 max-h-60 overflow-auto">
          {report.flaggedBullets.map((f, i) => (
            <li key={`${f.nodeId}-${i}`}>
              <button
                type="button"
                onClick={() => select([f.nodeId])}
                className="w-full text-left font-mono text-[11px] leading-snug px-2 py-1 border transition-colors"
                style={{
                  borderColor: "var(--color-editor-border)",
                  color: "var(--color-editor-text)",
                }}
                title={f.reason}
              >
                <span
                  className="mr-2 shrink-0"
                  style={{ color: "#d6a63d" }}
                >
                  ◆
                </span>
                <span>{f.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
