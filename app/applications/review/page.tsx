"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApplications } from "@/lib/app/store";
import {
  buildReviewSnapshot,
  stageLabel,
  type FunnelCounts,
  type RecurringLesson,
  type ResponseHistogram,
  type ReviewSnapshot,
  type StallPattern,
  type VariantPerformance,
  type WeekBucket,
} from "@/lib/app/analytics";
import {
  BURN_LABEL,
  computeEffortBudget,
  loadTargetCapacity,
  saveTargetCapacity,
  type EffortBudget,
} from "@/lib/app/effortBudget";
import type { Application } from "@/lib/app/types";

export default function ReviewPage() {
  const { applications, loaded, load } = useApplications();
  const [nowTs] = useState<number>(() => Date.now());

  useEffect(() => {
    load();
  }, [load]);

  const snapshot = useMemo<ReviewSnapshot | null>(() => {
    if (!loaded) return null;
    return buildReviewSnapshot(applications, nowTs);
  }, [applications, loaded, nowTs]);

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
      <header className="mb-10">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            <Link href="/applications" className="hover:text-ink">
              Applications
            </Link>{" "}
            / Review
          </p>
          <nav className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/50 flex gap-4">
            <Link href="/" className="hover:text-ink">
              CV Workshop
            </Link>
            <Link href="/applications" className="hover:text-ink">
              All
            </Link>
          </nav>
        </div>
        <h1 className="font-display text-5xl mt-3">
          Last <em>90 days</em>
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 mt-3">
          A diagnostic, not a dashboard.
        </p>
      </header>

      {!loaded ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/40">
          Loading…
        </p>
      ) : !snapshot || snapshot.funnel.total === 0 ? (
        <EmptyState />
      ) : (
        <ReviewBody snapshot={snapshot} applications={applications} />
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <section className="border-y border-ink/10 py-16 text-center">
      <p className="font-display text-3xl italic text-ink/50">
        Nothing to review yet.
      </p>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40 mt-4">
        Log a few applications and come back — patterns emerge around ~10.
      </p>
      <Link
        href="/applications/new"
        className="inline-block mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70 hover:text-ink underline decoration-ink/20 underline-offset-4"
      >
        Log your first one →
      </Link>
    </section>
  );
}

function ReviewBody({
  snapshot,
  applications,
}: {
  snapshot: ReviewSnapshot;
  applications: Application[];
}) {
  return (
    <div className="space-y-16">
      <AISummarySection snapshot={snapshot} />
      <EffortBudgetSection applications={applications} />
      <FunnelSection funnel={snapshot.funnel} />
      <WeeklySection weekly={snapshot.weekly} />
      <HistogramSection histogram={snapshot.histogram} />
      <VariantSection variants={snapshot.variants} />
      <StallSection stall={snapshot.stall} />
      <LessonsSection lessons={snapshot.lessons} />
    </div>
  );
}

// ———————————————————————————————————————————————
// Effort budget
// ———————————————————————————————————————————————

function EffortBudgetSection({ applications }: { applications: Application[] }) {
  const [target, setTarget] = useState<number>(20);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTarget(loadTargetCapacity());
    setLoaded(true);
  }, []);

  const effort: EffortBudget = useMemo(
    () => computeEffortBudget(applications, { targetCapacity: target }),
    [applications, target],
  );

  const onChangeTarget = useCallback((n: number) => {
    const clamped = Math.max(1, Math.min(200, Math.round(n)));
    setTarget(clamped);
    saveTargetCapacity(clamped);
  }, []);

  if (!loaded) {
    return (
      <section>
        <SectionHeading>Effort budget · last 30 days</SectionHeading>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">
          …
        </p>
      </section>
    );
  }

  const metrics: Array<{ label: string; value: string; dim?: boolean }> = [
    {
      label: "Applied",
      value: String(effort.appliedInWindow),
    },
    { label: "Target", value: String(effort.targetCapacity), dim: true },
    {
      label: "Tailored",
      value: `${Math.round(effort.qualityRatio * 100)}%`,
    },
    {
      label: "Non-auto-rejected",
      value: `${Math.round(effort.responseRate * 100)}%`,
    },
    {
      label: "Burn rate",
      value: BURN_LABEL[effort.burnRate],
    },
  ];

  return (
    <section>
      <SectionHeading>Effort budget · last 30 days</SectionHeading>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-1">
              {m.label}
            </div>
            <div
              className={`font-display text-3xl ${m.dim ? "text-ink/40" : "text-ink"}`}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>
      <p className="border-l-2 border-accent/50 pl-3 text-sm text-ink/85 leading-snug mb-4">
        {effort.guidance}
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50">
          Target capacity
        </label>
        <input
          type="number"
          min={1}
          max={200}
          value={target}
          onChange={(e) => onChangeTarget(Number(e.target.value) || 1)}
          className="font-mono bg-transparent border border-ink/15 focus:border-ink/60 focus:outline-none px-2 py-1 w-20"
        />
        <span className="font-mono text-[11px] text-ink/50">
          high-quality applications / 30 days
        </span>
      </div>
    </section>
  );
}

// ———————————————————————————————————————————————
// AI summary
// ———————————————————————————————————————————————

function AISummarySection({ snapshot }: { snapshot: ReviewSnapshot }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/review/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          funnel: snapshot.funnel,
          weekly: snapshot.weekly,
          histogram: snapshot.histogram,
          variants: snapshot.variants,
          stall: snapshot.stall,
          lessons: snapshot.lessons,
        }),
      });
      const data = (await res.json()) as { summary?: string; error?: string };
      if (!res.ok || !data.summary) {
        setError(data.error ?? "Failed to generate summary.");
        return;
      }
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [snapshot]);

  return (
    <section>
      <SectionHeading>Diagnostic</SectionHeading>
      {summary ? (
        <div className="border-l-2 border-accent/50 pl-5">
          <p className="font-display text-xl italic text-ink/85 leading-relaxed">
            {summary}
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={busy}
            className="mt-5 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink disabled:opacity-40"
          >
            {busy ? "Thinking…" : "Regenerate"}
          </button>
        </div>
      ) : (
        <div className="border-l-2 border-ink/15 pl-5">
          <p className="font-display italic text-ink/50">
            Generate a 3–5 sentence diagnostic from the numbers below.
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={busy}
            className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
          >
            {busy ? "Thinking…" : "Write diagnostic"}
          </button>
          {error && (
            <p className="mt-3 font-mono text-[11px] text-accent">{error}</p>
          )}
        </div>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————
// Funnel
// ———————————————————————————————————————————————

function FunnelSection({ funnel }: { funnel: FunnelCounts }) {
  const rows: Array<{ label: string; count: number; emphasis?: boolean }> = [
    { label: "Applied", count: funnel.applied, emphasis: true },
    { label: "Screen", count: funnel.screen },
    { label: "Interview", count: funnel.interview },
    { label: "Offer", count: funnel.offer, emphasis: true },
  ];
  const outcomes: Array<{ label: string; count: number }> = [
    { label: "Rejected", count: funnel.rejected },
    { label: "Withdrawn", count: funnel.withdrawn },
    { label: "Ghosted", count: funnel.ghosted },
  ];
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <section>
      <SectionHeading>Funnel</SectionHeading>
      <div className="space-y-2">
        {rows.map((r) => {
          const width = Math.max(2, Math.round((r.count / max) * 100));
          return (
            <div key={r.label} className="flex items-center gap-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60 w-24 shrink-0">
                {r.label}
              </div>
              <div className="flex-1 h-6 relative bg-ink/[0.03]">
                <div
                  className={`absolute inset-y-0 left-0 ${
                    r.emphasis ? "bg-ink/70" : "bg-ink/30"
                  }`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <div className="font-mono text-sm text-ink/80 w-12 text-right shrink-0">
                {r.count}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
        {outcomes.map((o) => (
          <div key={o.label} className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50">
              {o.label}
            </span>
            <span className="font-mono text-sm text-ink/70">{o.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ———————————————————————————————————————————————
// Weekly trend
// ———————————————————————————————————————————————

function WeeklySection({ weekly }: { weekly: WeekBucket[] }) {
  const anyData = weekly.some((w) => w.sent > 0 || w.responded > 0);
  const maxY = Math.max(1, ...weekly.map((w) => Math.max(w.sent, w.responded)));
  const W = 640;
  const H = 120;
  const padL = 28;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = weekly.length;
  const xAt = (i: number) => padL + (i * innerW) / Math.max(1, n - 1);
  const yAt = (v: number) => padT + innerH - (v / maxY) * innerH;

  const pathFor = (pick: (w: WeekBucket) => number) =>
    weekly.map((w, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(pick(w))}`).join(" ");
  const areaFor = (pick: (w: WeekBucket) => number) => {
    if (n === 0) return "";
    const start = `M ${xAt(0)} ${yAt(0)}`;
    const line = weekly.map((w, i) => `L ${xAt(i)} ${yAt(pick(w))}`).join(" ");
    const end = `L ${xAt(n - 1)} ${yAt(0)} Z`;
    return `${start} ${line} ${end}`;
  };

  return (
    <section>
      <SectionHeading>Weekly · sent vs. responded</SectionHeading>
      {!anyData ? (
        <p className="font-display italic text-ink/50">
          Not enough data for a trend.
        </p>
      ) : (
        <div className="text-ink/70">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="w-full h-32"
            role="img"
            aria-label="Weekly sent vs responded"
          >
            {/* baseline */}
            <line
              x1={padL}
              y1={padT + innerH}
              x2={W - padR}
              y2={padT + innerH}
              stroke="currentColor"
              strokeOpacity={0.15}
            />
            {/* sent area (muted) */}
            <path
              d={areaFor((w) => w.sent)}
              fill="currentColor"
              fillOpacity={0.1}
            />
            {/* responded area (stronger) */}
            <path
              d={areaFor((w) => w.responded)}
              fill="currentColor"
              fillOpacity={0.3}
            />
            {/* sent line */}
            <path
              d={pathFor((w) => w.sent)}
              stroke="currentColor"
              strokeWidth={1}
              strokeOpacity={0.5}
              fill="none"
            />
            {/* responded line */}
            <path
              d={pathFor((w) => w.responded)}
              stroke="currentColor"
              strokeWidth={1.5}
              fill="none"
            />
            {/* y-axis max label */}
            <text
              x={padL - 6}
              y={padT + 4}
              fontSize={9}
              textAnchor="end"
              fill="currentColor"
              fillOpacity={0.5}
              fontFamily="monospace"
            >
              {maxY}
            </text>
            <text
              x={padL - 6}
              y={padT + innerH}
              fontSize={9}
              textAnchor="end"
              fill="currentColor"
              fillOpacity={0.5}
              fontFamily="monospace"
            >
              0
            </text>
            {/* x-axis labels: first, middle, last */}
            {[0, Math.floor(n / 2), n - 1]
              .filter((i, idx, arr) => arr.indexOf(i) === idx)
              .map((i) => (
                <text
                  key={i}
                  x={xAt(i)}
                  y={H - 4}
                  fontSize={9}
                  textAnchor="middle"
                  fill="currentColor"
                  fillOpacity={0.5}
                  fontFamily="monospace"
                >
                  {weekly[i]?.label}
                </text>
              ))}
          </svg>
          <div className="flex gap-6 mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-[1px] bg-ink/50" /> Sent
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-[2px] bg-ink" /> Responded
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————
// Time-to-response histogram
// ———————————————————————————————————————————————

function HistogramSection({ histogram }: { histogram: ResponseHistogram }) {
  if (histogram.sampleCount === 0) {
    return (
      <section>
        <SectionHeading>Time to response</SectionHeading>
        <p className="font-display italic text-ink/50">
          No responses yet — nothing to plot.
        </p>
      </section>
    );
  }

  const max = Math.max(1, ...histogram.buckets.map((b) => b.count));

  return (
    <section>
      <SectionHeading>
        Time to response{" "}
        <span className="font-normal normal-case tracking-normal text-ink/50">
          · median {histogram.medianDays ?? "—"}d · n={histogram.sampleCount}
        </span>
      </SectionHeading>
      <div className="flex items-end gap-3 h-32">
        {histogram.buckets.map((b) => {
          const h = Math.max(2, Math.round((b.count / max) * 100));
          return (
            <div
              key={b.label}
              className="flex-1 flex flex-col items-center gap-2"
            >
              <div className="flex-1 w-full flex items-end">
                <div
                  className="w-full bg-ink/25"
                  style={{ height: `${h}%` }}
                  title={`${b.count} in ${b.label}`}
                />
              </div>
              <div className="font-mono text-[10px] text-ink/70">{b.count}</div>
              <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-ink/50">
                {b.label}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ———————————————————————————————————————————————
// Variant performance
// ———————————————————————————————————————————————

function VariantSection({ variants }: { variants: VariantPerformance[] }) {
  if (variants.length === 0) {
    return (
      <section>
        <SectionHeading>CV variants</SectionHeading>
        <p className="font-display italic text-ink/50">No variant data.</p>
      </section>
    );
  }

  return (
    <section>
      <SectionHeading>CV variants</SectionHeading>
      <div className="border-y border-ink/10">
        <div className="grid grid-cols-[1.4fr_repeat(6,1fr)] gap-2 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 border-b border-ink/10">
          <div>Slug</div>
          <div className="text-right">Applied</div>
          <div className="text-right">Screen</div>
          <div className="text-right">Interview</div>
          <div className="text-right">Offer</div>
          <div className="text-right">Resp %</div>
          <div className="text-right">Int %</div>
        </div>
        {variants.map((v) => (
          <div
            key={v.cvSlug}
            className="grid grid-cols-[1.4fr_repeat(6,1fr)] gap-2 py-2 font-mono text-[12px] text-ink/80 border-b border-ink/5 last:border-b-0"
          >
            <div className="truncate">{v.cvSlug}</div>
            <div className="text-right">{v.applied}</div>
            <div className="text-right">{v.screen}</div>
            <div className="text-right">{v.interview}</div>
            <div className="text-right">{v.offer}</div>
            <div className="text-right">{Math.round(v.responseRate * 100)}</div>
            <div className="text-right">{Math.round(v.interviewRate * 100)}</div>
          </div>
        ))}
      </div>
      {variants.length === 1 && (
        <p className="mt-3 font-mono text-[11px] text-ink/50">
          Only one variant in flight — nothing to compare against yet.
        </p>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————
// Stall pattern
// ———————————————————————————————————————————————

function StallSection({ stall }: { stall: StallPattern }) {
  return (
    <section>
      <SectionHeading>Where losses cluster</SectionHeading>
      {stall.totalLosses === 0 ? (
        <p className="font-display italic text-ink/50">
          No recorded losses yet. Attach a rejection signal on a closed
          application to populate this.
        </p>
      ) : (
        <div>
          <div className="grid grid-cols-5 gap-3 mb-4">
            {(
              ["resume", "screen", "interview", "final", "offer"] as const
            ).map((stage) => {
              const count = stall.counts[stage];
              const pct = stall.totalLosses
                ? (count / stall.totalLosses) * 100
                : 0;
              return (
                <div key={stage}>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 mb-1">
                    {stageLabel(stage)}
                  </div>
                  <div className="h-16 bg-ink/[0.03] relative">
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-ink/40"
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <div className="font-mono text-[11px] text-ink/80 mt-1">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
          {stall.flag && (
            <p className="border-l-2 border-accent/50 pl-3 text-sm text-ink/80">
              {stall.flag}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————
// Recurring lessons
// ———————————————————————————————————————————————

function LessonsSection({ lessons }: { lessons: RecurringLesson[] }) {
  return (
    <section>
      <SectionHeading>Recurring lessons</SectionHeading>
      {lessons.length === 0 ? (
        <p className="font-display italic text-ink/50">
          Attach rejection signals to surface themes here.
        </p>
      ) : (
        <ul className="space-y-3">
          {lessons.map((l, i) => (
            <li
              key={i}
              className="border-l-2 border-accent/50 pl-4 flex gap-4 items-baseline"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 w-10 shrink-0">
                ×{l.occurrences}
              </span>
              <span className="text-sm text-ink/85 leading-snug">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————
// Primitives
// ———————————————————————————————————————————————

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-5">
      {children}
    </h2>
  );
}
