"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/lib/doc/store";
import type { CvDocument } from "@/lib/doc/types";
import type {
  ArchetypeReport,
  CvEvaluation,
  EvalWarning,
  ProofInspectorReport,
  RecruiterReport,
  TenureReport,
} from "@/lib/evaluation/types";
import {
  appendToHistory,
  readHistory,
  type HistoryEntry,
} from "@/lib/evaluation/history";
import { diffDocuments, type DocDiff } from "@/lib/evaluation/diff";
import { computeParserCoverage } from "@/lib/evaluation/locate";
import { SixSecondCard } from "./SixSecondCard";
import { NumberInspectorPanel } from "./NumberInspectorPanel";
import { inspectProof } from "@/lib/evaluation/proofInspector";
import { detectArchetypes } from "@/lib/evaluation/archetypeDetector";
import { inspectTenure } from "@/lib/evaluation/tenureInspector";
import { ARCHETYPE_BY_CATEGORY_LABEL } from "@/lib/evaluation/archetypes";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";

// ————————————————————————————————————————————————
// Eval panel — right-pane tab for CV evaluation.
//
// Modes:
//   idle      — shows last eval, big "Evaluate" + "Evaluate + improve".
//   running   — live progress with iteration/stage messages.
//   done      — layered scorecard, flat warning list, layer cards (including
//               the new 6-second and number-inspector surfaces), parser view
//               toggle, before/after diff.
//
// Scores stream in via /api/cv-evaluate/refine NDJSON so the UI can show
// "iteration 2/3: fixing parseability…" as it happens.
//
// The number-inspector runs independently in its own panel — it doesn't need
// a server round-trip and surfaces results live on every keystroke.
// ————————————————————————————————————————————————

type Mode = "idle" | "running" | "done";

type ProgressLine = {
  iteration?: number;
  stage?: string;
  message: string;
};

type IterationSummary = {
  index: number;
  score: number;
  warningCount: number;
};

export function EvalPanel({ slug }: { slug: string }) {
  const doc = useEditor((s) => s.doc);
  const showParserOverlay = useEditor((s) => s.showParserOverlay);
  const setShowParserOverlay = useEditor((s) => s.setShowParserOverlay);

  const [mode, setMode] = useState<Mode>("idle");
  const [evaluation, setEvaluation] = useState<CvEvaluation | null>(null);
  const [progress, setProgress] = useState<ProgressLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [iterationSummaries, setIterationSummaries] = useState<
    IterationSummary[]
  >([]);
  const [docBefore, setDocBefore] = useState<CvDocument | null>(null);
  const [docAfter, setDocAfter] = useState<CvDocument | null>(null);
  const [evalBefore, setEvalBefore] = useState<CvEvaluation | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHistory(readHistory(slug));
  }, [slug]);

  // Derived — coverage map for the current doc against the last evaluation.
  // Pushed out as two window events: one for the legacy coverage consumers,
  // one carrying the full evaluation so ParserOverlay can read warnings too.
  const currentParserCoverage = useMemo(() => {
    if (!evaluation?.parseability.extracted) return null;
    return computeParserCoverage(doc, evaluation.parseability.extracted);
  }, [doc, evaluation]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("cv-eval:coverage", {
        detail: currentParserCoverage
          ? {
              extractedIds: currentParserCoverage.extractedNodeIds,
              unextractedIds:
                currentParserCoverage.unextractedExtractableNodeIds,
            }
          : null,
      }),
    );
  }, [currentParserCoverage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("cv-eval:result", { detail: evaluation }),
    );
  }, [evaluation]);

  const runEvaluate = useCallback(
    async ({ refine }: { refine: boolean }) => {
      setMode("running");
      setProgress([]);
      setError(null);
      setIterationSummaries([]);
      setDocBefore(doc);
      setEvalBefore(evaluation);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (!refine) {
          const res = await fetch("/api/cv-evaluate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ doc }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(body.error ?? `Server returned ${res.status}.`);
          }
          const data = (await res.json()) as CvEvaluation;
          setEvaluation(data);
          setDocAfter(doc);
          appendToHistory(slug, data);
          setHistory(readHistory(slug));
          setMode("done");
          return;
        }

        const res = await fetch("/api/cv-evaluate/refine", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/x-ndjson",
          },
          body: JSON.stringify({ doc }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`Server returned ${res.status}.`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const iterations: IterationSummary[] = [];

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let frame: unknown;
            try {
              frame = JSON.parse(line);
            } catch {
              continue;
            }
            handleFrame(frame, {
              setProgress: (fn) => setProgress(fn),
              onIteration: (it) => {
                iterations.push(it);
                setIterationSummaries([...iterations]);
              },
              onFinal: (ev, best) => {
                setEvaluation(ev);
                setDocAfter(best);
                appendToHistory(slug, ev);
                setHistory(readHistory(slug));
              },
              onError: (msg) => setError(msg),
            });
          }
        }

        setMode("done");
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setMode("idle");
          return;
        }
        setError(err instanceof Error ? err.message : "Evaluation failed.");
        setMode("done");
      } finally {
        abortRef.current = null;
      }
    },
    [doc, evaluation, slug],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const loadBest = useCallback(() => {
    if (docAfter) {
      useEditor.getState().loadDoc(docAfter);
    }
  }, [docAfter]);

  const diff = useMemo<DocDiff | null>(() => {
    if (!docBefore || !docAfter) return null;
    return diffDocuments(
      docBefore,
      docAfter,
      evalBefore ?? undefined,
      evaluation ?? undefined,
    );
  }, [docBefore, docAfter, evalBefore, evaluation]);

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      data-editor-chrome
      style={{ color: "var(--color-editor-text)" }}
    >
      <div
        className="px-3 py-3 border-b space-y-2"
        style={{ borderColor: "var(--color-editor-border)" }}
      >
        <div className="flex items-center gap-2">
          <button
            className="editor-btn flex-1"
            disabled={mode === "running"}
            onClick={() => runEvaluate({ refine: false })}
          >
            Evaluate
          </button>
          <button
            className="editor-btn flex-1"
            disabled={mode === "running"}
            onClick={() => runEvaluate({ refine: true })}
            title="Run all layers and iteratively refine up to 3 times"
          >
            Evaluate + improve
          </button>
          {mode === "running" && (
            <button className="editor-btn" onClick={stop}>
              stop
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono">
          <button
            type="button"
            className="editor-btn"
            onClick={() => setShowParserOverlay(!showParserOverlay)}
            aria-pressed={showParserOverlay}
            style={{
              background: showParserOverlay
                ? "rgba(78,193,109,0.15)"
                : undefined,
            }}
          >
            Parser view {showParserOverlay ? "on" : "off"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-4">
        {/* Always-on — runs on every doc change, no API call. */}
        <NumberInspectorPanel />
        <ProofInspectorPanel />
        <ArchetypePanel />
        <TenurePanel />

        {mode === "idle" && !evaluation && <EmptyState history={history} />}

        {mode === "running" && (
          <RunningState progress={progress} iterations={iterationSummaries} />
        )}

        {error && <ApiKeyHint error={error} />}

        {evaluation && mode !== "running" && (
          <>
            <ScoreBlock evaluation={evaluation} history={history} />
            <LayerBlock evaluation={evaluation} />
            {evaluation.sixSecond && (
              <SixSecondCard report={evaluation.sixSecond} />
            )}
            <RecruiterBlock recruiter={evaluation.recruiter} />
            <WarningsBlock warnings={evaluation.warnings} />
            {iterationSummaries.length > 1 && (
              <IterationTrace iterations={iterationSummaries} />
            )}
            {diff && diff.changedCount > 0 && (
              <DiffBlock diff={diff} onLoadBest={loadBest} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ————————————————————————————————————————————————
// NDJSON frame handling
// ————————————————————————————————————————————————

type FrameHandlers = {
  setProgress: (fn: (lines: ProgressLine[]) => ProgressLine[]) => void;
  onIteration: (it: IterationSummary) => void;
  onFinal: (ev: CvEvaluation, bestDoc: CvDocument) => void;
  onError: (msg: string) => void;
};

type StreamFrame = {
  type: string;
  iteration?: number;
  stage?: string;
  message?: string;
  score?: number;
  delta?: number;
  warningCount?: number;
  best?: {
    doc: CvDocument;
    evaluation: CvEvaluation;
  };
};

function handleFrame(raw: unknown, h: FrameHandlers): void {
  if (!raw || typeof raw !== "object") return;
  const f = raw as StreamFrame;
  switch (f.type) {
    case "stage":
      h.setProgress((lines) => [
        ...lines,
        {
          iteration: f.iteration,
          stage: f.stage,
          message: f.message ?? "",
        },
      ]);
      return;
    case "refining":
      h.setProgress((lines) => [
        ...lines,
        {
          iteration: f.iteration,
          stage: "refining",
          message: f.message ?? "",
        },
      ]);
      return;
    case "iteration-done":
      if (typeof f.iteration === "number" && typeof f.score === "number") {
        h.onIteration({
          index: f.iteration,
          score: f.score,
          warningCount: f.warningCount ?? 0,
        });
      }
      return;
    case "result":
      if (f.best) {
        h.onFinal(f.best.evaluation, f.best.doc);
      }
      return;
    case "done":
      return;
    case "error":
      h.onError(f.message ?? "Evaluation error.");
      return;
  }
}

// ————————————————————————————————————————————————
// Subcomponents
// ————————————————————————————————————————————————

function EmptyState({ history }: { history: HistoryEntry[] }) {
  return (
    <div className="space-y-3">
      <p className="font-mono text-[11px] text-[var(--color-editor-text-dim)] leading-relaxed">
        Run the evaluator to render your CV to PDF, push it through Affinda
        (ATS parser), run a recruiter-eye skim, and (when Affinda is wired up)
        a 6-second glance test. Then let the loop iteratively fix what it
        finds.
      </p>
      {history.length > 0 && <HistorySparkline history={history} />}
    </div>
  );
}

function RunningState({
  progress,
  iterations,
}: {
  progress: ProgressLine[];
  iterations: IterationSummary[];
}) {
  const last = progress[progress.length - 1];
  return (
    <div className="space-y-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
        {iterations.length > 0
          ? `Iteration ${iterations.length + 1}…`
          : "Evaluating…"}
      </div>
      {last && (
        <div className="font-mono text-[12px] text-[var(--color-editor-text)]">
          {last.iteration !== undefined ? `#${last.iteration + 1} · ` : ""}
          {last.stage ? `[${last.stage}] ` : ""}
          {last.message}
        </div>
      )}
      {iterations.length > 0 && (
        <div className="flex items-center gap-2 font-mono text-[11px]">
          {iterations.map((it) => (
            <div
              key={it.index}
              className="px-2 py-1 border"
              style={{ borderColor: "var(--color-editor-border)" }}
            >
              iter {it.index + 1}: {it.score}
            </div>
          ))}
        </div>
      )}
      <details className="font-mono text-[10px] text-[var(--color-editor-text-dim)]">
        <summary className="cursor-pointer">progress log</summary>
        <ul className="mt-2 space-y-1 max-h-40 overflow-auto">
          {progress.map((p, i) => (
            <li key={i}>
              {p.iteration !== undefined ? `#${p.iteration + 1} ` : ""}
              {p.stage ? `[${p.stage}] ` : ""}
              {p.message}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ScoreBlock({
  evaluation,
  history,
}: {
  evaluation: CvEvaluation;
  history: HistoryEntry[];
}) {
  const color =
    evaluation.overall >= 80
      ? "#4ec16d"
      : evaluation.overall >= 60
        ? "#d6a63d"
        : "#d64933";
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          Overall
        </span>
        <span
          className="font-display text-4xl tabular-nums"
          style={{ color }}
        >
          {evaluation.overall}
        </span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-[var(--color-editor-text-dim)]">
        {new Date(evaluation.evaluatedAt).toLocaleString()} · run{" "}
        {evaluation.runId}
      </div>
      {history.length > 1 && <HistorySparkline history={history} />}
    </section>
  );
}

function HistorySparkline({ history }: { history: HistoryEntry[] }) {
  const w = 260;
  const h = 36;
  const max = 100;
  const min = 0;
  const step = history.length > 1 ? w / (history.length - 1) : w;
  const pts = history.map((e, i) => {
    const x = i * step;
    const y = h - ((e.overall - min) / (max - min)) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <div className="mt-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-editor-text-dim)] mb-1">
        History (last {history.length})
      </div>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="block"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        <polyline
          fill="none"
          stroke="var(--color-editor-select, #4ec16d)"
          strokeWidth="1.5"
          points={pts.join(" ")}
        />
        {history.map((e, i) => {
          const x = i * step;
          const y = h - ((e.overall - 0) / 100) * h;
          return (
            <circle
              key={e.runId}
              cx={x}
              cy={y}
              r="2"
              fill="var(--color-editor-select, #4ec16d)"
            >
              <title>
                {new Date(e.evaluatedAt).toLocaleString()} · {e.overall}
              </title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

function LayerBlock({ evaluation }: { evaluation: CvEvaluation }) {
  return (
    <section className="space-y-2">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
        Layers
      </h3>
      <LayerRow
        label="Parseability"
        score={evaluation.parseability.score}
        detail={
          evaluation.parseability.extracted
            ? `${extractionSummary(evaluation.parseability)} extracted`
            : "parser unavailable"
        }
      />
      <LayerRow
        label="Keywords"
        score={evaluation.keywords.score}
        detail={`${Math.round(evaluation.keywords.coverage * 100)}% coverage${
          evaluation.keywords.missed.length
            ? ` · missing ${evaluation.keywords.missed.length}`
            : ""
        }`}
      />
      <LayerRow
        label="Recruiter"
        score={recruiterNumeric(evaluation.recruiter)}
        detail={
          evaluation.recruiter.unavailable
            ? "unavailable"
            : `odds: ${evaluation.recruiter.interviewOdds}`
        }
      />
      {evaluation.sixSecond && (
        <LayerRow
          label="6-second"
          score={evaluation.sixSecond.scannabilityScore}
          detail={
            evaluation.sixSecond.unavailable
              ? "unavailable"
              : `${evaluation.sixSecond.misreadings.length} misread${
                  evaluation.sixSecond.misreadings.length === 1 ? "" : "s"
                }`
          }
        />
      )}
      {evaluation.numbers && (
        <LayerRow
          label="Numbers"
          score={evaluation.numbers.score}
          detail={`${evaluation.numbers.bulletsWithMetrics}/${evaluation.numbers.totalBullets} bullets with metric`}
        />
      )}
      {evaluation.proof && (
        <LayerRow
          label="Proof"
          score={evaluation.proof.score}
          detail={`${evaluation.proof.bulletsWithProof}/${evaluation.proof.bulletsTotal} bullets with proof link`}
        />
      )}
      {evaluation.archetype && (
        <LayerRow
          label="Boilerplate"
          score={evaluation.archetype.score}
          detail={`${evaluation.archetype.uniqueMatches} boilerplate phrase${
            evaluation.archetype.uniqueMatches === 1 ? "" : "s"
          } detected`}
        />
      )}
      {evaluation.tenure && (
        <LayerRow
          label="Tenure"
          score={evaluation.tenure.score}
          detail={
            evaluation.tenure.averageTenureMonths !== null
              ? `avg ${evaluation.tenure.averageTenureMonths}mo · ${evaluation.tenure.warnings.length} flag${evaluation.tenure.warnings.length === 1 ? "" : "s"}`
              : "no parseable dates"
          }
        />
      )}
    </section>
  );
}

function extractionSummary(p: CvEvaluation["parseability"]): string {
  if (!p.extracted) return "nothing";
  const bits: string[] = [];
  if (p.extracted.name) bits.push("name");
  if (p.extracted.email) bits.push("email");
  if (p.extracted.phone) bits.push("phone");
  bits.push(`${p.extracted.workExperience.length} jobs`);
  bits.push(`${p.extracted.skills.length} skills`);
  return bits.join(" / ");
}

function recruiterNumeric(r: RecruiterReport): number {
  if (r.unavailable) return 60;
  const base =
    r.interviewOdds === "Low" ? 35 : r.interviewOdds === "Mid" ? 65 : 85;
  return Math.max(0, base - Math.min(r.flaggedIssues.length * 3, 15));
}

function LayerRow({
  label,
  score,
  detail,
}: {
  label: string;
  score: number;
  detail: string;
}) {
  return (
    <div className="grid grid-cols-[90px_1fr_50px] items-center gap-2 font-mono text-[11px]">
      <span className="text-[var(--color-editor-text-dim)] uppercase tracking-[0.15em]">
        {label}
      </span>
      <div className="h-1.5 bg-[rgba(255,255,255,0.08)] relative overflow-hidden">
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${score}%`,
            background:
              score >= 80 ? "#4ec16d" : score >= 60 ? "#d6a63d" : "#d64933",
          }}
        />
      </div>
      <span className="text-right tabular-nums">{score}</span>
      <span
        className="col-span-3 text-[10px] text-[var(--color-editor-text-dim)]"
        style={{ marginTop: -4 }}
      >
        {detail}
      </span>
    </div>
  );
}

function RecruiterBlock({ recruiter }: { recruiter: RecruiterReport }) {
  if (recruiter.unavailable) {
    return (
      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          Recruiter pass
        </h3>
        <p className="font-mono text-[11px] text-[var(--color-editor-text-dim)]">
          {recruiter.unavailableReason ?? "unavailable"}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
        Recruiter pass
      </h3>
      <RecruiterLine label="Strongest" value={recruiter.strongestSignal} />
      <RecruiterLine label="Weakness" value={recruiter.biggestWeakness} />
      <RecruiterLine label="Fix" value={recruiter.concreteImprovement} />
      <RecruiterLine label="Odds" value={recruiter.interviewOdds} />
    </section>
  );
}

function RecruiterLine({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="font-mono text-[11px]">
      <span className="text-[var(--color-editor-text-dim)] uppercase tracking-[0.15em] mr-2">
        {label}
      </span>
      <span className="text-[var(--color-editor-text)]">{value}</span>
    </div>
  );
}

function WarningsBlock({ warnings }: { warnings: EvalWarning[] }) {
  if (warnings.length === 0) {
    return (
      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          Warnings
        </h3>
        <p className="font-mono text-[11px] text-[var(--color-editor-text-dim)]">
          Nothing flagged — clean across all layers.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
        Warnings ({warnings.length})
      </h3>
      <ul className="mt-2 space-y-1">
        {warnings.map((w, i) => (
          <li
            key={i}
            className="font-mono text-[11px] leading-snug flex gap-2"
            onMouseEnter={() => highlightTargets(w.targetNodeIds ?? [])}
            onMouseLeave={() => highlightTargets([])}
          >
            <span
              className="shrink-0"
              style={{
                color:
                  w.severity === "error"
                    ? "#d64933"
                    : w.severity === "warn"
                      ? "#d6a63d"
                      : "#6d8ea8",
              }}
            >
              ■
            </span>
            <span>
              <span className="text-[var(--color-editor-text-dim)] uppercase tracking-[0.1em] mr-1 text-[10px]">
                {w.layer}:{w.kind}
              </span>
              <span className="text-[var(--color-editor-text)]">
                {w.message}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function highlightTargets(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cv-eval:highlight", { detail: ids }));
}

function IterationTrace({ iterations }: { iterations: IterationSummary[] }) {
  return (
    <section>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
        Refinement trace
      </h3>
      <ul className="mt-2 space-y-1 font-mono text-[11px]">
        {iterations.map((it, i) => {
          const prev = iterations[i - 1];
          const delta = prev ? it.score - prev.score : 0;
          return (
            <li key={it.index} className="flex items-center gap-2">
              <span className="text-[var(--color-editor-text-dim)]">
                iter {it.index + 1}
              </span>
              <span className="tabular-nums">{it.score}</span>
              {prev && (
                <span
                  className="tabular-nums"
                  style={{
                    color:
                      delta > 0 ? "#4ec16d" : delta < 0 ? "#d64933" : undefined,
                  }}
                >
                  ({delta > 0 ? "+" : ""}
                  {delta})
                </span>
              )}
              <span className="text-[var(--color-editor-text-dim)]">
                {it.warningCount} flags
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DiffBlock({
  diff,
  onLoadBest,
}: {
  diff: DocDiff;
  onLoadBest: () => void;
}) {
  const changed = diff.nodeDiffs.filter((d) => d.kind === "changed");
  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          Changes ({diff.changedCount} nodes)
        </h3>
        <button className="editor-btn" onClick={onLoadBest}>
          Apply best
        </button>
      </div>
      {diff.scoreDelta && (
        <div className="mt-2 font-mono text-[11px] space-x-3">
          <span>
            Δ overall{" "}
            <span
              className="tabular-nums"
              style={{
                color:
                  diff.scoreDelta.overall > 0
                    ? "#4ec16d"
                    : diff.scoreDelta.overall < 0
                      ? "#d64933"
                      : undefined,
              }}
            >
              {diff.scoreDelta.overall > 0 ? "+" : ""}
              {diff.scoreDelta.overall}
            </span>
          </span>
          <span className="text-[var(--color-editor-text-dim)]">
            parse {sign(diff.scoreDelta.parseability)} · kw{" "}
            {sign(diff.scoreDelta.keywords)} · recr{" "}
            {sign(diff.scoreDelta.recruiter)}
          </span>
        </div>
      )}
      <ul className="mt-2 space-y-2 max-h-64 overflow-auto">
        {changed.slice(0, 12).map((d) => (
          <li
            key={d.nodeId}
            className="font-mono text-[11px] border px-2 py-2"
            style={{ borderColor: "var(--color-editor-border)" }}
          >
            <div className="text-[10px] text-[var(--color-editor-text-dim)]">
              {d.nodeId}
            </div>
            {d.textChunks ? (
              <p className="mt-1 leading-snug">
                {d.textChunks.map((c, i) => (
                  <span
                    key={i}
                    style={{
                      background: c.added
                        ? "rgba(78,193,109,0.25)"
                        : c.removed
                          ? "rgba(214,73,51,0.25)"
                          : undefined,
                      textDecoration: c.removed ? "line-through" : undefined,
                      opacity: c.removed ? 0.75 : 1,
                    }}
                  >
                    {c.value}
                  </span>
                ))}
              </p>
            ) : (
              <p className="mt-1 text-[var(--color-editor-text-dim)]">
                non-text change
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function sign(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

// ————————————————————————————————————————————————
// Always-on static panels. Each re-runs on every doc change via a memo
// keyed on `doc`. Zero LLM calls. Safe to render live as the user types.
// ————————————————————————————————————————————————

function ProofInspectorPanel() {
  const doc = useEditor((s) => s.doc);
  const select = useEditor((s) => s.select);
  const report: ProofInspectorReport = useMemo(() => inspectProof(doc), [doc]);

  if (report.bulletsTotal === 0) return null;

  const color =
    report.score >= 80 ? "#4ec16d" : report.score >= 60 ? "#d6a63d" : "#d64933";

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          Proof of work
        </h3>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color }}
        >
          {report.bulletsWithProof}/{report.bulletsTotal}
        </span>
      </div>

      {report.missing.length === 0 ? (
        <p className="mt-1 font-mono text-[11px] text-[var(--color-editor-text-dim)] leading-snug">
          Every required bullet has a proof link. Nice.
        </p>
      ) : (
        <ul className="mt-2 space-y-1 max-h-60 overflow-auto">
          {report.missing.map((f, i) => (
            <li key={`${f.nodeId}-${i}`}>
              <button
                type="button"
                onClick={() => select([f.nodeId])}
                className="w-full text-left font-mono text-[11px] leading-snug px-2 py-1 border transition-colors"
                style={{
                  borderColor: "var(--color-editor-border)",
                  color: "var(--color-editor-text)",
                }}
                title="Add a proofUrl in the Inspector"
              >
                <span className="mr-2 shrink-0" style={{ color: "#d64933" }}>
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

function ArchetypePanel() {
  const doc = useEditor((s) => s.doc);
  const select = useEditor((s) => s.select);
  const [open, setOpen] = useState(false);
  const report: ArchetypeReport = useMemo(() => detectArchetypes(doc), [doc]);

  // Group matches by category so long lists stay skimmable.
  const byCategory = useMemo(() => {
    const map = new Map<string, typeof report.matches>();
    for (const m of report.matches) {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    }
    return map;
  }, [report.matches]);

  if (report.matches.length === 0) return null;

  const color =
    report.score >= 80 ? "#4ec16d" : report.score >= 60 ? "#d6a63d" : "#d64933";

  return (
    <section>
      <button
        type="button"
        className="w-full flex items-baseline justify-between"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          Boilerplate language {open ? "▾" : "▸"}
        </span>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color }}
        >
          {report.matches.length} hit{report.matches.length === 1 ? "" : "s"}
        </span>
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {Array.from(byCategory.entries()).map(([cat, items]) => (
            <li key={cat}>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-editor-text-dim)]">
                {ARCHETYPE_BY_CATEGORY_LABEL[
                  cat as keyof typeof ARCHETYPE_BY_CATEGORY_LABEL
                ] ?? cat}
              </div>
              <ul className="mt-1 space-y-1">
                {items.map((m, i) => (
                  <li key={`${m.nodeId}-${i}`}>
                    <button
                      type="button"
                      onClick={() => select([m.nodeId])}
                      className="w-full text-left font-mono text-[11px] leading-snug px-2 py-1 border transition-colors"
                      style={{
                        borderColor: "var(--color-editor-border)",
                        color: "var(--color-editor-text)",
                      }}
                      title={m.suggestion}
                    >
                      <span
                        className="mr-2 shrink-0"
                        style={{ color: "#6d8ea8" }}
                      >
                        ◇
                      </span>
                      <span className="font-mono">&ldquo;{m.phrase}&rdquo;</span>
                      <span className="text-[var(--color-editor-text-dim)]">
                        {" "}
                        — {m.suggestion}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Tenure panel — static report plus a "suggest framing" button that hits
// the /api/cv-evaluate/tenure-frame route. The returned framings can be
// applied to the profile summary node (detected by name prefix) via
// updateNode; if there's no summary node we fall back to clipboard.
function TenurePanel() {
  const doc = useEditor((s) => s.doc);
  const updateNode = useEditor((s) => s.updateNode);
  const report: TenureReport = useMemo(() => inspectTenure(doc), [doc]);

  const [framings, setFramings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const askForFraming = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cv-evaluate/tenure-frame", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          experiences: report.experiences,
          patterns: report.warnings,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}.`);
      }
      const data = (await res.json()) as { framings?: string[] };
      setFramings(data.framings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Framing request failed.");
    } finally {
      setLoading(false);
    }
  }, [report.experiences, report.warnings]);

  const findSummaryNodeId = useCallback((): string | null => {
    for (const page of doc.pages) {
      for (const n of page.nodes) {
        if (n.type !== "text") continue;
        const name = (n.name ?? "").toLowerCase();
        if (
          name.includes("about body") ||
          name.includes("summary") ||
          name.includes("profile")
        ) {
          return n.id;
        }
      }
    }
    return null;
  }, [doc]);

  const applyFraming = useCallback(
    async (line: string) => {
      const summaryId = findSummaryNodeId();
      if (summaryId) {
        const node = doc.pages
          .flatMap((p) => p.nodes)
          .find((n) => n.id === summaryId);
        if (node && node.type === "text") {
          const existing = node.content.trim();
          const next = existing ? `${existing}\n\n${line}` : line;
          updateNode(summaryId, { content: next });
          setApplied("appended to profile summary");
          return;
        }
      }
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(line);
          setApplied("copied to clipboard");
          return;
        } catch {
          // fall through
        }
      }
      setApplied("no summary node found; copy manually");
    },
    [doc, findSummaryNodeId, updateNode],
  );

  if (report.experiences.length === 0) return null;

  const color =
    report.score >= 80 ? "#4ec16d" : report.score >= 60 ? "#d6a63d" : "#d64933";

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          Tenure
        </h3>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color }}
        >
          {report.averageTenureMonths !== null
            ? `avg ${report.averageTenureMonths}mo`
            : "–"}
        </span>
      </div>

      {report.warnings.length === 0 ? (
        <p className="mt-1 font-mono text-[11px] text-[var(--color-editor-text-dim)] leading-snug">
          No tenure patterns flagged.
        </p>
      ) : (
        <>
          <ul className="mt-2 space-y-1">
            {report.warnings.map((w, i) => (
              <li
                key={`${w.kind}-${i}`}
                className="font-mono text-[11px] leading-snug px-2 py-1 border"
                style={{ borderColor: "var(--color-editor-border)" }}
              >
                <span
                  className="mr-2"
                  style={{
                    color: w.kind === "gap" ? "#6d8ea8" : "#d6a63d",
                  }}
                >
                  ▲
                </span>
                <span className="text-[10px] text-[var(--color-editor-text-dim)] uppercase tracking-[0.1em] mr-1">
                  {w.kind}
                </span>
                <span>{w.message}</span>
              </li>
            ))}
          </ul>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="editor-btn"
              onClick={askForFraming}
              disabled={loading}
              title="Ask Claude for a one-line reframe you can add to your profile summary."
            >
              {loading ? "thinking…" : "suggest framing"}
            </button>
            {applied && (
              <span className="font-mono text-[10px] text-[var(--color-editor-text-dim)]">
                {applied}
              </span>
            )}
          </div>

          {error && <div className="mt-2"><ApiKeyHint error={error} inline /></div>}

          {framings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {framings.map((line, i) => (
                <li
                  key={i}
                  className="font-mono text-[11px] leading-snug px-2 py-1 border"
                  style={{ borderColor: "var(--color-editor-border)" }}
                >
                  <div className="mb-1">{line}</div>
                  <button
                    type="button"
                    className="editor-btn"
                    onClick={() => applyFraming(line)}
                  >
                    use as profile summary
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
