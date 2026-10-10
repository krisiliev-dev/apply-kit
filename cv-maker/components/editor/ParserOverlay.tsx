"use client";

import { useEffect, useMemo, useState } from "react";
import type { Page } from "@/lib/doc/types";
import { useEditor } from "@/lib/doc/store";
import type {
  CvEvaluation,
  EvalWarning,
} from "@/lib/evaluation/types";
import { computeParserCoverage } from "@/lib/evaluation/locate";

// ————————————————————————————————————————————————
// ParserOverlay — renders on top of a PageView when `showParserOverlay` is
// on. For every text node:
//   • green outline if Affinda successfully extracted its content
//   • red outline if the node LOOKS extractable (email/phone/name-like) but
//     wasn't matched
//   • no outline for decorative nodes (shapes, section labels, etc.)
//
// Also overlays small numbered warning badges near each node that has an
// associated warning. Click a badge → scroll the eval panel to that warning.
//
// The overlay subscribes to two window events:
//   • "cv-eval:result" — latest CvEvaluation from the EvalPanel
// so the EvalPanel doesn't need to re-own overlay state.
// ————————————————————————————————————————————————

export function ParserOverlay({ page }: { page: Page }) {
  const showParserOverlay = useEditor((s) => s.showParserOverlay);
  const doc = useEditor((s) => s.doc);

  const [evaluation, setEvaluation] = useState<CvEvaluation | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResult = (e: Event) => {
      const detail = (e as CustomEvent<CvEvaluation | null>).detail;
      setEvaluation(detail);
    };
    window.addEventListener("cv-eval:result", onResult);
    return () => window.removeEventListener("cv-eval:result", onResult);
  }, []);

  const coverage = useMemo(() => {
    if (!evaluation?.parseability.extracted) return null;
    return computeParserCoverage(doc, evaluation.parseability.extracted);
  }, [doc, evaluation]);

  const warningsByNode = useMemo(
    () => groupWarningsByNode(evaluation?.warnings ?? []),
    [evaluation],
  );

  if (!showParserOverlay) return null;

  const parserUnavailable =
    !evaluation || evaluation.parseability.extracted === null;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        // Dims the underlying canvas slightly so outlines read against it.
        // The per-node rendering below creates its own opaque outline boxes.
        zIndex: 50,
      }}
      data-parser-overlay="true"
    >
      {/* Dim layer — reduces page-background contrast */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(255,255,255,0.15)",
          mixBlendMode: "multiply",
          pointerEvents: "none",
        }}
      />

      {parserUnavailable && (
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            padding: "4px 8px",
            background: "rgba(20,20,20,0.85)",
            color: "#d6a63d",
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            pointerEvents: "auto",
          }}
        >
          parser unavailable — run the evaluator
        </div>
      )}

      {!parserUnavailable && coverage && (
        <>
          {page.nodes
            .filter((n) => n.type === "text" && !n.hidden)
            .map((n) => {
              const extracted = coverage.extractedNodeIds.includes(n.id);
              const unextracted =
                coverage.unextractedExtractableNodeIds.includes(n.id);
              if (!extracted && !unextracted) return null;

              const color = extracted ? "#4ec16d" : "#d64933";
              return (
                <div
                  key={`outline-${n.id}`}
                  style={{
                    position: "absolute",
                    left: `${n.x}mm`,
                    top: `${n.y}mm`,
                    width: `${n.w}mm`,
                    height: `${n.h}mm`,
                    border: `2px solid ${color}`,
                    background: extracted
                      ? "rgba(78,193,109,0.06)"
                      : "rgba(214,73,51,0.08)",
                    boxSizing: "border-box",
                    pointerEvents: "none",
                  }}
                  data-node-id={n.id}
                  data-parser-status={extracted ? "extracted" : "unextracted"}
                />
              );
            })}

          {/* Warning badges */}
          {page.nodes
            .filter((n) => warningsByNode.has(n.id))
            .map((n) => {
              const related = warningsByNode.get(n.id) ?? [];
              if (related.length === 0) return null;
              const first = related[0];
              return (
                <button
                  key={`badge-${n.id}`}
                  type="button"
                  onClick={() => focusWarning(first)}
                  title={first.message}
                  style={{
                    position: "absolute",
                    left: `calc(${n.x}mm + ${n.w}mm - 14px)`,
                    top: `calc(${n.y}mm - 8px)`,
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background:
                      first.severity === "error"
                        ? "#d64933"
                        : first.severity === "warn"
                          ? "#d6a63d"
                          : "#6d8ea8",
                    color: "white",
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "auto",
                    cursor: "pointer",
                    border: "none",
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  {related.length > 9 ? "9+" : related.length}
                </button>
              );
            })}
        </>
      )}
    </div>
  );
}

function groupWarningsByNode(
  warnings: EvalWarning[],
): Map<string, EvalWarning[]> {
  const map = new Map<string, EvalWarning[]>();
  for (const w of warnings) {
    for (const id of w.targetNodeIds ?? []) {
      const existing = map.get(id);
      if (existing) existing.push(w);
      else map.set(id, [w]);
    }
  }
  return map;
}

function focusWarning(w: EvalWarning): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("cv-eval:focus-warning", {
      detail: {
        layer: w.layer,
        kind: w.kind,
        message: w.message,
      },
    }),
  );
  // Also select the node so the user's eye is drawn to it.
  const ids = w.targetNodeIds ?? [];
  if (ids.length > 0) {
    useEditor.getState().select(ids);
  }
}
