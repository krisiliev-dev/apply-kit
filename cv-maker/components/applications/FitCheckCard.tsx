"use client";

import { useCallback, useState } from "react";
import type {
  ApplyFitCheck,
  ApplyFitEffort,
  ApplyFitVerdict,
  ParsedJob,
} from "@/lib/app/types";
import type { CVContent, Profile } from "@/lib/types";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";
import { trackedFetch } from "@/lib/ai/tokenLedger";

// FitCheckCard — brutally honest pre-application read.
// Used in two surfaces:
//   - /jobs/[appId] (JobDetailView) — post-parse, pre-draft
//   - /discover (modal) — before spending tokens on tailoring
//
// Accepts the inputs it needs, an optional cached result, and a "save on
// generate" hook so callers can cache the result wherever they like.

const VERDICT_LABEL: Record<ApplyFitVerdict, string> = {
  strong: "Strong fit",
  plausible: "Plausible",
  stretch: "Stretch",
  misaligned: "Misaligned",
};

const VERDICT_CLASS: Record<ApplyFitVerdict, string> = {
  strong: "bg-ink text-paper border-ink",
  plausible: "bg-accent/10 text-accent border-accent/30",
  stretch: "bg-ink/5 text-ink/70 border-ink/20",
  misaligned: "bg-ink/5 text-ink/40 border-ink/15 line-through",
};

const EFFORT_LABEL: Record<ApplyFitEffort, string> = {
  low: "Low tailor",
  mid: "Mid tailor",
  high: "High tailor",
};

export type FitCheckInputs = {
  parsedJob: ParsedJob;
  baseCV: CVContent;
  profile: Profile;
};

export function FitCheckCard({
  inputs,
  cached,
  onResult,
  compact = false,
}: {
  inputs: FitCheckInputs;
  cached?: ApplyFitCheck;
  onResult?: (fit: ApplyFitCheck) => void;
  compact?: boolean;
}) {
  const [fit, setFit] = useState<ApplyFitCheck | null>(cached ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await trackedFetch("/api/apply-fit/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inputs),
      });
      const data = (await res.json()) as {
        fit?: ApplyFitCheck;
        error?: string;
      };
      if (!res.ok || !data.fit) {
        setError(data.error ?? "Fit check failed.");
        return;
      }
      setFit(data.fit);
      onResult?.(data.fit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [inputs, onResult]);

  if (!fit) {
    return (
      <div className={`border border-ink/10 ${compact ? "p-4" : "p-5"}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            Fit check · honest read
          </h3>
        </div>
        <p className={`font-display italic text-ink/50 ${compact ? "mt-2 text-sm" : "mt-3"}`}>
          Before you spend energy tailoring — ask whether this role is even
          aligned with your CV.
        </p>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
        >
          {busy ? "Reading the posting…" : "Check fit"}
        </button>
        {error && <div className="mt-3"><ApiKeyHint error={error} inline /></div>}
      </div>
    );
  }

  return (
    <div className={`border border-ink/10 ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Fit check
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-1 border ${VERDICT_CLASS[fit.overallFit]}`}
          >
            {VERDICT_LABEL[fit.overallFit]}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-ink/15 text-ink/70">
            {EFFORT_LABEL[fit.effortEstimate]}
          </span>
        </div>
      </div>

      <p className="mt-4 border-l-2 border-accent/50 pl-3 font-display italic text-ink/85 leading-snug">
        {fit.honest}
      </p>

      <div className="mt-5 grid md:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
            Weaknesses (read first)
          </p>
          <ul className="space-y-1.5">
            {fit.weaknesses.map((w, i) => (
              <li
                key={`w-${i}`}
                className="text-sm text-ink/85 leading-snug flex gap-2"
              >
                <span className="text-accent shrink-0">·</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
            Strengths
          </p>
          <ul className="space-y-1.5">
            {fit.strengths.map((s, i) => (
              <li
                key={`s-${i}`}
                className="text-sm text-ink/75 leading-snug flex gap-2"
              >
                <span className="text-ink/40 shrink-0">·</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {fit.deltaQuestions.length > 0 && (
        <div className="mt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
            Before you apply — clarify
          </p>
          <ul className="space-y-1.5">
            {fit.deltaQuestions.map((q, i) => (
              <li
                key={`q-${i}`}
                className="text-sm text-ink/75 leading-snug italic"
              >
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex items-center gap-4">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink disabled:opacity-40"
        >
          {busy ? "Thinking…" : "Regenerate"}
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
          Checked {new Date(fit.generatedAt).toLocaleDateString()}
        </span>
      </div>

      {error && <div className="mt-3"><ApiKeyHint error={error} inline /></div>}
    </div>
  );
}
