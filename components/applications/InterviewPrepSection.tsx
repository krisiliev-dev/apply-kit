"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { useApplications } from "@/lib/app/store";
import type {
  Application,
  InterviewConfidence,
  InterviewPrep,
  InterviewQuestion,
  InterviewQuestionKind,
} from "@/lib/app/types";
import { cvs } from "@/content/cvs";
import { defaultCV } from "@/content/cvs/default";
import { formatDateTime } from "@/lib/app/ui";

// Interview prep — visible when the application has reached screen/interview/offer.
// - Optional company-notes paste block feeds richer generation.
// - Generation uses /api/interview/generate (generateObject); hydrates InterviewPrep
//   on the application record.
// - Per-question UI supports expand/collapse, user draft (autosaved on blur),
//   confidence, practice timestamp, regenerate, delete, and custom questions.

const KIND_LABEL: Record<InterviewQuestionKind, string> = {
  behavioral: "Behavioral",
  technical: "Technical",
  "system-design": "System design",
  values: "Values",
  situational: "Situational",
  "culture-fit": "Culture fit",
  other: "Other",
};

const KIND_FILTERS: { value: InterviewQuestionKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "behavioral", label: "Behavioral" },
  { value: "technical", label: "Technical" },
  { value: "system-design", label: "System design" },
  { value: "values", label: "Values" },
  { value: "situational", label: "Situational" },
  { value: "culture-fit", label: "Culture fit" },
  { value: "other", label: "Other" },
];

const CONFIDENCE_OPTIONS: { value: InterviewConfidence; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "mid", label: "Mid" },
  { value: "high", label: "High" },
];

function resolveBaseCV(cvSlug?: string) {
  if (cvSlug && cvs[cvSlug]) return cvs[cvSlug];
  return defaultCV;
}

export function InterviewPrepSection({ app }: { app: Application }) {
  const {
    setInterviewPrep,
    updateInterviewQuestion,
    addInterviewQuestion,
    removeInterviewQuestion,
  } = useApplications();

  const prep = app.interviewPrep;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!prep);
  const [companyNotes, setCompanyNotes] = useState("");
  const [questionCount, setQuestionCount] = useState(12);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [kindFilter, setKindFilter] = useState<InterviewQuestionKind | "all">(
    "all",
  );
  const [search, setSearch] = useState("");
  const [onlyUnpracticed, setOnlyUnpracticed] = useState(false);
  const [customQuestion, setCustomQuestion] = useState("");

  const onGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const baseCV = resolveBaseCV(app.cvSlug);
      const res = await fetch("/api/interview/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationId: app.id,
          application: app,
          baseCV,
          questionCount,
          companyNotes: companyNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const msg = (await safeJsonError(res)) ?? `Generation failed (${res.status})`;
        setError(msg);
        return;
      }
      const data = (await res.json()) as { prep: InterviewPrep };
      if (!data?.prep) {
        setError("No prep returned.");
        return;
      }
      setInterviewPrep(app.id, data.prep);
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }, [app, companyNotes, questionCount, setInterviewPrep]);

  const onDiscard = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.confirm("Discard the interview prep for this application?")) {
      setInterviewPrep(app.id, undefined);
      setShowForm(true);
    }
  }, [app.id, setInterviewPrep]);

  const onToggleExpand = useCallback((qid: string) => {
    setExpanded((s) => ({ ...s, [qid]: !s[qid] }));
  }, []);

  const onAddCustom = useCallback(() => {
    const text = customQuestion.trim();
    if (!text) return;
    const q: InterviewQuestion = {
      id: nanoid(8),
      question: text,
      kind: "other",
      rationale: "User-added.",
    };
    addInterviewQuestion(app.id, q);
    setCustomQuestion("");
  }, [addInterviewQuestion, app.id, customQuestion]);

  const questions = prep?.questions ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return questions.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (onlyUnpracticed && item.lastPracticedAt) return false;
      if (q) {
        const hay =
          `${item.question} ${item.rationale} ${item.kind}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [questions, kindFilter, search, onlyUnpracticed]);

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Interview prep
        </h2>
        {prep && !showForm && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-accent"
            >
              Discard
            </button>
          </div>
        )}
      </div>

      {!prep && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 border border-ink/20 text-ink/70 hover:border-ink hover:text-ink"
        >
          Generate interview prep
        </button>
      )}

      {showForm && (
        <div className="border border-ink/10 p-5 mb-4">
          <div className="grid grid-cols-[120px_1fr] gap-y-5 gap-x-6 items-start">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 pt-2">
              Questions
            </div>
            <div>
              <input
                type="range"
                min={4}
                max={24}
                step={1}
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="w-full max-w-xs accent-ink"
                aria-label="Question count"
              />
              <div className="font-mono text-[11px] text-ink/60 mt-1">
                {questionCount} questions
              </div>
            </div>

            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 pt-2">
              Research notes
            </div>
            <div>
              <textarea
                value={companyNotes}
                onChange={(e) => setCompanyNotes(e.target.value)}
                rows={5}
                placeholder="Paste URLs, Glassdoor quotes, engineering-blog excerpts — anything that would help the model reason about this company's interview style. Optional."
                className="w-full bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 text-sm leading-relaxed placeholder:text-ink/30 resize-y"
              />
              <p className="font-mono text-[10px] tracking-[0.15em] text-ink/40 mt-1">
                No scraping — the model reads only what you paste.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-6">
            <button
              type="button"
              onClick={onGenerate}
              disabled={busy}
              className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
            >
              {busy ? "Generating…" : prep ? "Regenerate" : "Generate"}
            </button>
            {prep && !busy && (
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
              >
                Cancel
              </button>
            )}
            {!app.jobData && (
              <span className="font-mono text-[11px] text-ink/40">
                No parsed job — generating from company + role only.
              </span>
            )}
            {!app.cvSlug && (
              <span className="font-mono text-[11px] text-ink/40">
                No CV linked — falling back to the default CV.
              </span>
            )}
          </div>

          {error && (
            <p className="mt-4 font-mono text-[11px] text-accent">{error}</p>
          )}
        </div>
      )}

      {prep && (
        <div>
          {prep.companyResearch && (
            <CompanyResearchCard research={prep.companyResearch} />
          )}

          <div className="flex flex-wrap items-center gap-3 mt-6 mb-4">
            <div
              role="tablist"
              aria-label="Filter by question kind"
              className="flex flex-wrap gap-1.5"
            >
              {KIND_FILTERS.map((f) => {
                const active = kindFilter === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setKindFilter(f.value)}
                    className={`font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-1 border transition-colors ${
                      active
                        ? "bg-ink text-paper border-ink"
                        : "bg-transparent text-ink/60 border-ink/15 hover:border-ink/40"
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions…"
              className="font-mono text-[11px] bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-2 py-1 placeholder:text-ink/30"
            />

            <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyUnpracticed}
                onChange={(e) => setOnlyUnpracticed(e.target.checked)}
                className="accent-ink"
              />
              Un-practiced only
            </label>

            <span className="font-mono text-[10px] tracking-[0.2em] text-ink/40 ml-auto">
              {filtered.length}/{questions.length} · generated{" "}
              {formatDateTime(prep.generatedAt)}
            </span>
          </div>

          <ul className="space-y-2">
            {filtered.map((q) => (
              <QuestionRow
                key={q.id}
                appId={app.id}
                q={q}
                expanded={!!expanded[q.id]}
                onToggle={() => onToggleExpand(q.id)}
                onPatch={(patch) =>
                  updateInterviewQuestion(app.id, q.id, patch)
                }
                onDelete={() => removeInterviewQuestion(app.id, q.id)}
              />
            ))}
          </ul>

          {filtered.length === 0 && (
            <p className="font-display italic text-ink/40 mt-2">
              No questions match these filters.
            </p>
          )}

          <form
            className="mt-6 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onAddCustom();
            }}
          >
            <input
              type="text"
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder="Add a custom question you want to practice"
              className="flex-1 bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 text-sm placeholder:text-ink/30"
            />
            <button
              type="submit"
              disabled={!customQuestion.trim()}
              className="font-mono text-[11px] uppercase tracking-[0.2em] px-3 py-2 border border-ink/20 text-ink/70 hover:border-ink hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————

function CompanyResearchCard({
  research,
}: {
  research: NonNullable<InterviewPrep["companyResearch"]>;
}) {
  return (
    <div className="border border-ink/10 bg-ink/[0.015] px-5 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
        Company read
      </div>
      <p className="font-display text-[15px] leading-relaxed text-ink/85">
        {research.summary}
      </p>
      {research.likelyInterviewStyle && (
        <p className="mt-3 text-sm italic text-ink/60">
          {research.likelyInterviewStyle}
        </p>
      )}
      {research.publicSignals.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {research.publicSignals.map((s, i) => (
            <li key={`${s.source}-${i}`} className="text-sm text-ink/75">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 mr-2">
                [{s.source}]
              </span>
              {s.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionRow({
  appId,
  q,
  expanded,
  onToggle,
  onPatch,
  onDelete,
}: {
  appId: string;
  q: InterviewQuestion;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<Omit<InterviewQuestion, "id">>) => void;
  onDelete: () => void;
}) {
  const [localDraft, setLocalDraft] = useState(q.userDraft ?? "");
  // Keep the draft in sync if external changes come in (e.g. a regeneration
  // rewrote the question). The effect only fires when the upstream value
  // actually changes — the user's typing isn't disrupted.
  useEffect(() => {
    setLocalDraft(q.userDraft ?? "");
  }, [q.userDraft]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === " " || e.key === "Space" || e.code === "Space") {
        e.preventDefault();
        onToggle();
      }
    },
    [onToggle],
  );

  return (
    <li className="border border-ink/10 hover:border-ink/20 transition-colors">
      <button
        type="button"
        onClick={onToggle}
        onKeyDown={onKeyDown}
        aria-expanded={expanded}
        className="w-full text-left px-5 py-3 flex items-start gap-4 focus:outline-none focus:bg-ink/[0.02]"
      >
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.2em] px-1.5 py-0.5 border shrink-0 mt-1 ${
            q.kind === "technical" || q.kind === "system-design"
              ? "border-accent/30 text-accent bg-accent/5"
              : "border-ink/15 text-ink/60"
          }`}
        >
          {KIND_LABEL[q.kind]}
        </span>
        <span className="font-display text-[17px] leading-snug text-ink/90 flex-1">
          {q.question}
        </span>
        {q.lastPracticedAt && (
          <span className="font-mono text-[10px] tracking-[0.15em] text-ink/40 shrink-0 mt-1.5">
            practiced {formatDateTime(q.lastPracticedAt)}
          </span>
        )}
        <span
          aria-hidden="true"
          className={`font-mono text-ink/40 shrink-0 mt-1 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          <p className="text-sm text-ink/60 italic">{q.rationale}</p>

          {q.starAnswer && (
            <div className="border-l border-ink/15 pl-4 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50">
                Practice answer (STAR)
              </div>
              <StarField label="Situation" value={q.starAnswer.situation} />
              <StarField label="Task" value={q.starAnswer.task} />
              <StarField label="Action" value={q.starAnswer.action} />
              <StarField label="Result" value={q.starAnswer.result} />
              {q.starAnswer.sourcedFrom && (
                <p className="font-mono text-[10px] tracking-[0.15em] text-ink/40">
                  Sourced from — {q.starAnswer.sourcedFrom}
                </p>
              )}
            </div>
          )}

          <div>
            <label
              htmlFor={`draft-${appId}-${q.id}`}
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 block mb-1"
            >
              Your draft
            </label>
            <textarea
              id={`draft-${appId}-${q.id}`}
              value={localDraft}
              onChange={(e) => setLocalDraft(e.target.value)}
              onBlur={() => {
                if (localDraft !== (q.userDraft ?? "")) {
                  onPatch({ userDraft: localDraft });
                }
              }}
              rows={4}
              placeholder="Draft your own version — auto-saves on blur."
              className="w-full bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 text-sm leading-relaxed placeholder:text-ink/30 resize-y"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50">
                Confidence
              </span>
              <div role="radiogroup" className="flex gap-1">
                {CONFIDENCE_OPTIONS.map((c) => {
                  const active = q.confidence === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onPatch({ confidence: c.value })}
                      className={`font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-1 border transition-colors ${
                        active
                          ? "bg-ink text-paper border-ink"
                          : "bg-transparent text-ink/60 border-ink/15 hover:border-ink/40"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onPatch({ lastPracticedAt: Date.now() })}
              className="font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-ink/15 text-ink/70 hover:border-ink/40 hover:text-ink"
            >
              Mark practiced
            </button>

            <button
              type="button"
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  window.confirm("Delete this question?")
                ) {
                  onDelete();
                }
              }}
              className="font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-1 text-ink/40 hover:text-accent ml-auto"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function StarField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">
        {label}
      </div>
      <p className="text-sm text-ink/85 leading-relaxed">{value}</p>
    </div>
  );
}

async function safeJsonError(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (data && typeof data.error === "string") return data.error;
    return null;
  } catch {
    return null;
  }
}
