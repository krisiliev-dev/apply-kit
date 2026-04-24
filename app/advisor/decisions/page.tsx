"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdvisor } from "@/lib/advisor/store";
import { formatRelative } from "@/lib/advisor/ui";
import {
  DECISION_KINDS,
  DECISION_LABEL,
  type DecisionAnalysis,
  type DecisionInput,
  type DecisionKind,
} from "@/lib/advisor/types";
import { profile } from "@/content/profile";
import { cvList } from "@/content/cvs";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";
import { trackedFetch } from "@/lib/ai/tokenLedger";

// /advisor/decisions — three focused helpers in one page with tabs.
// Structured form per kind + optional free-form context → POST to
// /api/advisor/decisions → appended to the local history (cap 20).

export default function DecisionsPage() {
  const advisor = useAdvisor();
  const [tab, setTab] = useState<DecisionKind>("offer-evaluation");

  useEffect(() => {
    advisor.load();
  }, [advisor]);

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
      <Breadcrumbs current="Decisions" />

      <h1 className="font-display text-5xl mt-3">
        Decisions that don&apos;t <em>sugarcoat.</em>
      </h1>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 mt-3">
        Offer evaluation · stay-vs-go · pivot
      </p>

      <div className="mt-8 flex gap-0 border-b border-ink/10">
        {DECISION_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={
              "font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 border-b-2 " +
              (tab === k ? "border-ink text-ink" : "border-transparent text-ink/50 hover:text-ink")
            }
          >
            {DECISION_LABEL[k]}
          </button>
        ))}
      </div>

      <section className="mt-8">
        {tab === "offer-evaluation" ? <OfferForm /> : null}
        {tab === "stay-vs-go" ? <StayForm /> : null}
        {tab === "pivot" ? <PivotForm /> : null}
      </section>

      {advisor.decisions.length > 0 && (
        <section className="mt-16">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
              Recent analyses
            </h2>
            {advisor.decisions.length > 0 && (
              <button
                type="button"
                onClick={() => advisor.clearDecisions()}
                className="font-mono text-[10px] uppercase tracking-wider text-ink/50 hover:text-accent"
              >
                Clear history
              </button>
            )}
          </div>
          <ul className="space-y-6">
            {advisor.decisions.slice(0, 10).map((d) => (
              <DecisionCard key={d.id} decision={d} onRemove={() => advisor.removeDecision(d.id)} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

// ———————————————————————————————————————
// Forms, one per kind
// ———————————————————————————————————————

function OfferForm() {
  return (
    <KindForm<Extract<DecisionInput, { kind: "offer-evaluation" }>>
      kind="offer-evaluation"
      initial={{
        kind: "offer-evaluation",
        company: "",
        role: "",
      }}
      fields={[
        { key: "company", label: "Company", required: true },
        { key: "role", label: "Role", required: true },
        { key: "baseSalary", label: "Base salary" },
        { key: "equity", label: "Equity" },
        { key: "totalComp", label: "Total comp (if quoted)" },
        { key: "location", label: "Location" },
        { key: "reportingTo", label: "Reporting to" },
      ]}
    />
  );
}

function StayForm() {
  return (
    <KindForm<Extract<DecisionInput, { kind: "stay-vs-go" }>>
      kind="stay-vs-go"
      initial={{
        kind: "stay-vs-go",
        currentRole: "",
        currentCompany: "",
      }}
      fields={[
        { key: "currentRole", label: "Current role", required: true },
        { key: "currentCompany", label: "Current company", required: true },
        { key: "tenureMonths", label: "Tenure (months)", type: "number" },
        { key: "alternativeRole", label: "Alternative role" },
        { key: "alternativeCompany", label: "Alternative company" },
        { key: "compDelta", label: "Comp delta" },
      ]}
    />
  );
}

function PivotForm() {
  return (
    <KindForm<Extract<DecisionInput, { kind: "pivot" }>>
      kind="pivot"
      initial={{
        kind: "pivot",
        fromDomain: "",
        toDomain: "",
      }}
      fields={[
        { key: "fromDomain", label: "From domain", required: true },
        { key: "toDomain", label: "To domain", required: true },
        { key: "horizonMonths", label: "Horizon (months)", type: "number" },
      ]}
    />
  );
}

// ———————————————————————————————————————
// Generic typed form
// ———————————————————————————————————————

type FieldSpec<T> = {
  key: keyof T & string;
  label: string;
  required?: boolean;
  type?: "text" | "number";
};

function KindForm<T extends DecisionInput>({
  kind,
  initial,
  fields,
}: {
  kind: DecisionKind;
  initial: T;
  fields: FieldSpec<T>[];
}) {
  const advisor = useAdvisor();
  const [state, setState] = useState<T>(initial);
  const [ctx, setCtx] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = useCallback(
    (key: keyof T & string, val: string | number | undefined) => {
      setState((prev) => ({ ...prev, [key]: val } as T));
    },
    [],
  );

  const onGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const input: DecisionInput = { ...state, context: ctx || undefined } as DecisionInput;
      const res = await trackedFetch("/api/advisor/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, input, profile, cvVariants: cvList }),
      });
      const data = (await res.json()) as { decision?: DecisionAnalysis; error?: string };
      if (!res.ok || !data.decision) {
        setError(data.error ?? "Failed to generate analysis.");
        return;
      }
      advisor.addDecision(data.decision);
      setCtx("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [advisor, kind, state, ctx]);

  const missingRequired = fields
    .filter((f) => f.required)
    .some((f) => {
      const v = (state as Record<string, unknown>)[f.key];
      return v === undefined || v === null || v === "";
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!missingRequired) onGenerate();
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
              {f.label}
              {f.required ? " *" : ""}
            </span>
            <input
              type={f.type ?? "text"}
              value={
                ((state as Record<string, unknown>)[f.key] as string | number | undefined) ?? ""
              }
              onChange={(e) => {
                if (f.type === "number") {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  setField(f.key, Number.isNaN(n) ? undefined : n);
                } else {
                  setField(f.key, e.target.value);
                }
              }}
              required={f.required}
              className="border border-ink/15 px-3 py-2 text-sm focus:outline-none focus:border-ink"
            />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
          Context (free-form, optional)
        </span>
        <textarea
          value={ctx}
          onChange={(e) => setCtx(e.target.value)}
          rows={5}
          className="border border-ink/15 px-3 py-2 text-sm focus:outline-none focus:border-ink font-mono"
          placeholder="Anything the structured fields miss — manager concerns, deadline pressure, personal factors, etc."
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || missingRequired}
          className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
        >
          {busy ? "Thinking…" : "Generate analysis"}
        </button>
        {error ? <ApiKeyHint error={error} inline /> : null}
      </div>
    </form>
  );
}

function DecisionCard({ decision, onRemove }: { decision: DecisionAnalysis; onRemove: () => void }) {
  const confidenceTint =
    decision.confidence === "high"
      ? "text-ink"
      : decision.confidence === "mid"
      ? "text-ink/70"
      : "text-accent";
  return (
    <li className="border border-ink/10 p-5">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
          {DECISION_LABEL[decision.kind]} · {formatRelative(decision.generatedAt)}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="font-mono text-[10px] uppercase tracking-wider text-ink/40 hover:text-accent"
        >
          remove
        </button>
      </div>
      <p className="font-display text-xl italic border-l-2 border-ink/20 pl-4 mb-3">
        {decision.recommendation}
      </p>
      <p className="text-sm text-ink/70 leading-relaxed mb-4">{decision.inputSummary}</p>
      <p className={`font-mono text-[10px] uppercase tracking-wider mb-4 ${confidenceTint}`}>
        confidence · {decision.confidence}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
            Pros
          </p>
          <ul className="space-y-1.5 text-sm text-ink/80">
            {decision.pros.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-ink/35">+</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
            Cons
          </p>
          <ul className="space-y-1.5 text-sm text-ink/80">
            {decision.cons.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent/70">−</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
          Questions to probe
        </p>
        <ul className="space-y-1.5 text-sm text-ink/80">
          {decision.questions.map((q, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-ink/35">?</span>
              <span>{q}</span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

function Breadcrumbs({ current }: { current: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
        <Link href="/advisor" className="hover:text-ink">Advisor</Link> / {current}
      </p>
      <nav aria-label="Primary" className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 flex gap-4">
        <Link href="/" className="hover:text-ink">CV Workshop</Link>
        <Link href="/applications" className="hover:text-ink">Applications</Link>
      </nav>
    </div>
  );
}
