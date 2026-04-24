"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompletion } from "@ai-sdk/react";
import { useApplications } from "@/lib/app/store";
import {
  APPLICATION_STATUSES,
  CLOSED_UNFAVOURABLE_STATUSES,
  REJECTION_REASON_KINDS,
  REJECTION_REASON_LABEL,
  type Application,
  type ApplicationStatus,
  type ApplicationEvent,
  type CoverLetter,
  type CoverLetterTone,
  type RejectionReasonKind,
  type RejectionSignal,
  type RejectionExtractedSignals,
} from "@/lib/app/types";
import { STATUS_CLASS, STATUS_LABEL, formatDateTime } from "@/lib/app/ui";
import { exportApplicationBundle } from "@/lib/app/coverLetterExport";
import { defaultCV } from "@/content/cvs/default";
import { cvs } from "@/content/cvs";

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";

  const {
    applications,
    loaded,
    load,
    setField,
    updateStatus,
    remove,
    setCoverLetter,
    setRejectionSignal,
    clearRejectionSignal,
  } = useApplications();

  useEffect(() => {
    load();
  }, [load]);

  const app = useMemo(
    () => applications.find((a) => a.id === id),
    [applications, id],
  );

  if (!loaded) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/40">
          Loading…
        </p>
      </main>
    );
  }

  if (!app) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Applications / <span className="text-ink/40">not found</span>
        </p>
        <h1 className="font-display text-4xl mt-4">
          No application with that id.
        </h1>
        <Link
          href="/applications"
          className="inline-block mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70 hover:text-ink underline decoration-ink/20 underline-offset-4"
        >
          Back to list
        </Link>
      </main>
    );
  }

  const events = [...(app.events ?? [])].sort((a, b) => b.at - a.at);

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <header className="mb-10">
        <div className="flex items-start justify-between gap-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            <Link href="/applications" className="hover:text-ink">
              Applications
            </Link>{" "}
            / {app.id}
          </p>
          <ExportAllButton app={app} />
        </div>

        <InlineText
          value={app.company}
          onCommit={(v) => setField(app.id, { company: v || app.company })}
          className="font-display text-5xl mt-3 block w-full"
          placeholder="Company"
        />
        <InlineText
          value={app.role}
          onCommit={(v) => setField(app.id, { role: v || app.role })}
          className="font-display text-2xl italic text-ink/70 mt-1 block w-full"
          placeholder="Role"
        />
      </header>

      <section className="grid grid-cols-[120px_1fr] gap-y-4 gap-x-6 mb-12">
        <Label>Status</Label>
        <div>
          <select
            value={app.status}
            onChange={(e) =>
              updateStatus(app.id, e.target.value as ApplicationStatus)
            }
            className={`font-mono text-[11px] uppercase tracking-[0.2em] px-2.5 py-1.5 border appearance-none cursor-pointer ${
              STATUS_CLASS[app.status]
            }`}
          >
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        <Label>URL</Label>
        <InlineText
          value={app.url ?? ""}
          onCommit={(v) => setField(app.id, { url: v || undefined })}
          className="font-mono text-sm text-ink/80 w-full"
          placeholder="https://…"
        />

        <Label>CV</Label>
        <div className="flex items-center gap-3">
          <InlineText
            value={app.cvSlug ?? ""}
            onCommit={(v) => setField(app.id, { cvSlug: v || undefined })}
            className="font-mono text-sm text-ink/80 w-full max-w-xs"
            placeholder="cv slug (e.g. default)"
          />
          {app.cvSlug && (
            <Link
              href={`/cv/${app.cvSlug}`}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70 hover:text-ink shrink-0"
            >
              Open CV →
            </Link>
          )}
        </div>

        <Label>Created</Label>
        <div className="font-mono text-sm text-ink/60">
          {formatDateTime(app.dateCreated)}
        </div>

        <Label>Notes</Label>
        <InlineTextArea
          value={app.notes ?? ""}
          onCommit={(v) => setField(app.id, { notes: v || undefined })}
          placeholder="Notes, context, links…"
        />
      </section>

      <CoverLetterSection
        app={app}
        onSave={(cl) => setCoverLetter(app.id, cl)}
        onClear={() => setCoverLetter(app.id, undefined)}
      />

      {CLOSED_UNFAVOURABLE_STATUSES.includes(app.status) && (
        <RejectionLearningSection
          app={app}
          onSave={(signal) => setRejectionSignal(app.id, signal)}
          onClear={() => clearRejectionSignal(app.id)}
        />
      )}

      <section className="mb-12">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-4">
          Timeline
        </h2>
        {events.length === 0 ? (
          <p className="font-display italic text-ink/40">
            No events yet — change the status to record one.
          </p>
        ) : (
          <ul className="space-y-3 border-l border-ink/10 pl-5">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="relative">
                <span className="absolute -left-[25px] top-1.5 w-2 h-2 rounded-full bg-ink/30" />
                <EventRow event={e} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="border-t border-ink/10 pt-6 flex justify-between items-center">
        <Link
          href="/applications"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
        >
          ← All applications
        </Link>
        <button
          type="button"
          onClick={() => {
            if (
              typeof window !== "undefined" &&
              window.confirm(`Delete the ${app.company} application?`)
            ) {
              remove(app.id);
              router.push("/applications");
            }
          }}
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-accent"
        >
          Delete
        </button>
      </footer>
    </main>
  );
}

// ———————————————————————————————————————————————
// Inline-commit primitives
// ———————————————————————————————————————————————

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 pt-2">
      {children}
    </div>
  );
}

function InlineText({
  value,
  onCommit,
  className = "",
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      type="text"
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`bg-transparent border-b border-transparent hover:border-ink/20 focus:border-ink/60 focus:outline-none py-1 placeholder:text-ink/30 ${className}`}
    />
  );
}

function InlineTextArea({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <textarea
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      rows={4}
      className="w-full bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 text-sm leading-relaxed placeholder:text-ink/30 resize-y"
    />
  );
}

// ———————————————————————————————————————————————
// Cover letter
// ———————————————————————————————————————————————

const TONES: { value: CoverLetterTone; label: string; hint: string }[] = [
  { value: "neutral", label: "Neutral", hint: "Baseline" },
  { value: "warm", label: "Warm", hint: "Personal" },
  { value: "direct", label: "Direct", hint: "Declarative" },
  { value: "witty", label: "Witty", hint: "Light touch" },
];

function resolveBaseCV(cvSlug?: string) {
  if (cvSlug && cvs[cvSlug]) return cvs[cvSlug];
  return defaultCV;
}

function CoverLetterSection({
  app,
  onSave,
  onClear,
}: {
  app: Application;
  onSave: (cl: CoverLetter) => void;
  onClear: () => void;
}) {
  const existing = app.coverLetter;
  const [showForm, setShowForm] = useState(!existing);
  const [tone, setTone] = useState<CoverLetterTone>(existing?.tone ?? "direct");
  const [wordTarget, setWordTarget] = useState<number>(220);
  const [editBody, setEditBody] = useState<string>(existing?.body ?? "");
  const [copied, setCopied] = useState(false);
  const toneRef = useRef<CoverLetterTone>(tone);
  toneRef.current = tone;

  useEffect(() => {
    setEditBody(existing?.body ?? "");
  }, [existing?.body]);

  const { completion, complete, isLoading, stop, error } = useCompletion({
    api: "/api/cover-letter",
    streamProtocol: "text",
    onFinish: (_prompt, final) => {
      const body = (final ?? "").trim();
      if (!body) return;
      onSave({
        body,
        tone: toneRef.current,
        generatedAt: Date.now(),
      });
      setShowForm(false);
    },
  });

  const onGenerate = useCallback(() => {
    const baseCV = resolveBaseCV(app.cvSlug);
    void complete("", {
      body: {
        applicationId: app.id,
        parsedJob: app.jobData,
        baseCV,
        tone,
        wordTarget,
      },
    });
  }, [app.id, app.cvSlug, app.jobData, complete, tone, wordTarget]);

  const onCopy = useCallback(async () => {
    const text = existing?.body ?? editBody;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard may be unavailable (insecure context, etc.)
    }
  }, [existing?.body, editBody]);

  const onSaveEdits = useCallback(() => {
    const body = editBody.trim();
    if (!body) return;
    onSave({
      body,
      tone: existing?.tone ?? tone,
      generatedAt: Date.now(),
    });
  }, [editBody, existing?.tone, tone, onSave]);

  const streaming = isLoading && completion.length > 0;

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Cover letter
        </h2>
        {existing && !showForm && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onCopy}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  window.confirm("Discard this cover letter?")
                ) {
                  onClear();
                  setEditBody("");
                }
              }}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-accent"
            >
              Discard
            </button>
          </div>
        )}
      </div>

      {showForm && (
        <div className="border border-ink/10 p-5 mb-4">
          <div className="grid grid-cols-[120px_1fr] gap-y-5 gap-x-6 items-start">
            <Label>Tone</Label>
            <div
              role="radiogroup"
              aria-label="Cover letter tone"
              className="flex flex-wrap gap-2"
            >
              {TONES.map((t) => {
                const active = t.value === tone;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTone(t.value)}
                    className={`font-mono text-[11px] uppercase tracking-[0.2em] px-2.5 py-1.5 border transition-colors ${
                      active
                        ? "bg-ink text-paper border-ink"
                        : "bg-transparent text-ink/70 border-ink/15 hover:border-ink/40"
                    }`}
                  >
                    {t.label}
                    <span
                      className={`ml-2 normal-case tracking-normal text-[10px] ${
                        active ? "text-paper/70" : "text-ink/40"
                      }`}
                    >
                      {t.hint}
                    </span>
                  </button>
                );
              })}
            </div>

            <Label>Length</Label>
            <div>
              <input
                type="range"
                min={150}
                max={350}
                step={10}
                value={wordTarget}
                onChange={(e) => setWordTarget(Number(e.target.value))}
                className="w-full max-w-xs accent-ink"
                aria-label="Target word count"
              />
              <div className="font-mono text-[11px] text-ink/60 mt-1">
                ~{wordTarget} words
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-6">
            <button
              type="button"
              onClick={onGenerate}
              disabled={isLoading}
              className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
            >
              {isLoading ? "Generating…" : existing ? "Regenerate" : "Generate"}
            </button>
            {isLoading && (
              <button
                type="button"
                onClick={stop}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
              >
                Stop
              </button>
            )}
            {existing && !isLoading && (
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
                No parsed job — generating from CV only.
              </span>
            )}
          </div>

          {error && (
            <p className="mt-4 font-mono text-[11px] text-accent">
              {error.message}
            </p>
          )}

          {streaming && (
            <pre className="mt-6 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-ink/80 border-t border-ink/10 pt-4">
              {completion}
            </pre>
          )}
        </div>
      )}

      {existing && !showForm && (
        <div>
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            onBlur={onSaveEdits}
            rows={Math.min(
              24,
              Math.max(10, editBody.split("\n").length + 2),
            )}
            className="w-full bg-paper/40 border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap resize-y"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
              {existing.tone ? `${existing.tone} · ` : ""}
              generated {formatDateTime(existing.generatedAt)}
            </p>
            {editBody.trim() !== existing.body.trim() && (
              <button
                type="button"
                onClick={onSaveEdits}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70 hover:text-ink"
              >
                Save edits
              </button>
            )}
          </div>
        </div>
      )}

      {!existing && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 border border-ink/20 text-ink/70 hover:border-ink hover:text-ink"
        >
          Generate cover letter
        </button>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————
// Export all (zip)
// ———————————————————————————————————————————————

function ExportAllButton({ app }: { app: Application }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const onExport = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await exportApplicationBundle(app);
      const bits: string[] = [];
      if (res.included.coverLetter) bits.push("cover letter");
      if (res.included.cv) bits.push("CV");
      setStatus(bits.length ? `Exported ${bits.join(" + ")}` : "Exported readme");
    } catch {
      setStatus("Export failed");
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 2500);
    }
  }, [app]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onExport}
        disabled={busy}
        className="font-mono text-[11px] uppercase tracking-[0.2em] px-3 py-1.5 border border-ink/20 text-ink/70 hover:border-ink hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "Zipping…" : "Export all"}
      </button>
      {status && (
        <span className="font-mono text-[10px] tracking-[0.15em] text-ink/50">
          {status}
        </span>
      )}
    </div>
  );
}

// ———————————————————————————————————————————————
// Rejection learning
// ———————————————————————————————————————————————

function defaultKindForStatus(status: ApplicationStatus): RejectionReasonKind {
  switch (status) {
    case "ghosted-short":
      return "ghosted-short";
    case "ghosted-long":
      return "ghosted-long";
    case "withdrawn":
      return "self-withdrawn";
    default:
      return "auto-rejection";
  }
}

function RejectionLearningSection({
  app,
  onSave,
  onClear,
}: {
  app: Application;
  onSave: (signal: RejectionSignal) => void;
  onClear: () => void;
}) {
  const existing = app.rejection;
  const [showForm, setShowForm] = useState(!existing);
  const [kind, setKind] = useState<RejectionReasonKind>(
    existing?.kind ?? defaultKindForStatus(app.status),
  );
  const [rawText, setRawText] = useState(existing?.rawInputText ?? "");
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExtract = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rejection/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationId: app.id,
          application: app,
          rawText: rawText.trim() || undefined,
          kind,
        }),
      });
      const data = (await res.json()) as
        | {
            extractedSignals: RejectionExtractedSignals;
            aiSummary: string;
            lessonsForFuture: string[];
          }
        | { error: string };
      if (!res.ok || "error" in data) {
        const msg =
          "error" in data && data.error ? data.error : "Extraction failed.";
        setError(msg);
        return;
      }
      const signal: RejectionSignal = {
        kind,
        rawInputText: rawText.trim() || undefined,
        closedAt: existing?.closedAt ?? Date.now(),
        extractedSignals: data.extractedSignals,
        aiSummary: data.aiSummary,
        lessonsForFuture: data.lessonsForFuture,
      };
      onSave(signal);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [app, rawText, kind, existing?.closedAt, onSave]);

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Rejection learning
        </h2>
        {existing && !showForm && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
            >
              Re-extract
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  window.confirm("Clear this rejection analysis?")
                ) {
                  onClear();
                  setRawText("");
                  setShowForm(true);
                }
              }}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-accent"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {showForm && (
        <div className="border border-ink/10 p-5 mb-4">
          <div className="grid grid-cols-[120px_1fr] gap-y-5 gap-x-6 items-start">
            <Label>Kind</Label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as RejectionReasonKind)}
              className="font-mono text-[11px] uppercase tracking-[0.2em] px-2.5 py-1.5 border border-ink/15 bg-transparent appearance-none cursor-pointer w-fit"
            >
              {REJECTION_REASON_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REJECTION_REASON_LABEL[k]}
                </option>
              ))}
            </select>

            <Label>Message</Label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={6}
              placeholder="Paste the rejection email or note (optional) — context-only if left blank."
              className="w-full bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 text-sm leading-relaxed placeholder:text-ink/30 resize-y"
            />
          </div>

          <div className="flex items-center gap-4 mt-6">
            <button
              type="button"
              onClick={onExtract}
              disabled={busy}
              className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
            >
              {busy ? "Extracting…" : existing ? "Re-extract" : "Extract signal"}
            </button>
            {existing && !busy && (
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
              >
                Cancel
              </button>
            )}
          </div>

          {error && (
            <p className="mt-4 font-mono text-[11px] text-accent">{error}</p>
          )}
        </div>
      )}

      {existing && !showForm && (
        <div className="border-l-2 border-accent/40 pl-5 py-1">
          <p className="font-display text-lg italic text-ink/85 leading-snug">
            {existing.aiSummary}
          </p>

          <div className="mt-5 grid grid-cols-[130px_1fr] gap-y-2 gap-x-5">
            <Label>Kind</Label>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/80">
              {REJECTION_REASON_LABEL[existing.kind]}
            </div>

            <Label>Stage lost</Label>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/80">
              {existing.extractedSignals.stageLost}
            </div>

            <Label>Politeness</Label>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/80">
              {existing.extractedSignals.politeness}
            </div>

            {existing.extractedSignals.seniorityFeedback && (
              <>
                <Label>Seniority</Label>
                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/80">
                  {existing.extractedSignals.seniorityFeedback}
                </div>
              </>
            )}

            {existing.extractedSignals.salaryMismatch && (
              <>
                <Label>Salary</Label>
                <div className="font-mono text-[11px] text-ink/80">
                  mismatch
                  {existing.extractedSignals.compensationHint ? (
                    <span className="text-ink/50">
                      {" "}
                      · {existing.extractedSignals.compensationHint}
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </div>

          {existing.extractedSignals.citedReasons.length > 0 && (
            <div className="mt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
                Cited
              </p>
              <ul className="space-y-1.5">
                {existing.extractedSignals.citedReasons.map((r, i) => (
                  <li
                    key={`cited-${i}`}
                    className="text-sm text-ink/80 leading-snug"
                  >
                    &ldquo;{r}&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          )}

          {existing.extractedSignals.inferredReasons.length > 0 && (
            <div className="mt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
                Inferred
              </p>
              <ul className="space-y-1.5">
                {existing.extractedSignals.inferredReasons.map((r, i) => (
                  <li
                    key={`inf-${i}`}
                    className="text-sm text-ink/75 leading-snug"
                  >
                    — {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {existing.lessonsForFuture.length > 0 && (
            <div className="mt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
                Lessons for future
              </p>
              <ul className="space-y-2">
                {existing.lessonsForFuture.map((l, i) => (
                  <li
                    key={`lesson-${i}`}
                    className="border-l-2 border-accent/50 pl-3 text-sm text-ink/85 leading-snug"
                  >
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex items-center gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
              Recorded {formatDateTime(existing.closedAt)}
            </p>
            {existing.rawInputText ? (
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 hover:text-ink"
              >
                {showRaw ? "Hide email" : "Show email"}
              </button>
            ) : null}
          </div>

          {showRaw && existing.rawInputText && (
            <pre className="mt-3 whitespace-pre-wrap bg-ink/5 border border-ink/10 p-3 text-[12px] text-ink/70 font-mono leading-relaxed">
              {existing.rawInputText}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

function EventRow({ event }: { event: ApplicationEvent }) {
  const time = formatDateTime(event.at);
  if (event.kind === "status-change") {
    return (
      <div>
        <div className="font-mono text-[11px] text-ink/50">{time}</div>
        <div className="text-sm mt-0.5">
          Status{" "}
          <span className="font-mono text-[11px] text-ink/60">
            {event.from ? STATUS_LABEL[event.from] : "—"}
          </span>{" "}
          →{" "}
          <span className="font-mono text-[11px] text-ink">
            {event.to ? STATUS_LABEL[event.to] : "—"}
          </span>
          {event.note ? (
            <span className="text-ink/60"> · {event.note}</span>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-mono text-[11px] text-ink/50">
        {time} · {event.kind}
      </div>
      {event.note && <div className="text-sm mt-0.5">{event.note}</div>}
    </div>
  );
}
