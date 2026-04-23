"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useApplications } from "@/lib/app/store";
import type {
  Application,
  PreScreen,
  PreScreenQuestion,
  PreScreenTone,
} from "@/lib/app/types";
import { cvs } from "@/content/cvs";
import { defaultCV } from "@/content/cvs/default";
import { formatDateTime } from "@/lib/app/ui";

// Pre-screen answer drafter.
// - User pastes the application's short-answer prompts.
// - We parse them into `{ prompt, wordLimit? }[]` with light heuristics.
// - `Draft all` streams plain text from /api/pre-screen/draft with a
//   machine-readable `--- QUESTION <n> ---` delimiter. We split the stream and
//   feed each answer into the matching card as it arrives.
// - Final answers persist under `application.preScreen`.

const TONE_OPTIONS: { value: PreScreenTone; label: string; hint: string }[] = [
  { value: "direct", label: "Direct", hint: "Declarative" },
  { value: "warm", label: "Warm", hint: "Personal" },
  { value: "witty", label: "Witty", hint: "Light touch" },
  { value: "neutral", label: "Neutral", hint: "Baseline" },
];

const DELIMITER_RE = /^---\s*QUESTION\s*(\d+)\s*---\s*$/i;

function resolveBaseCV(cvSlug?: string) {
  if (cvSlug && cvs[cvSlug]) return cvs[cvSlug];
  return defaultCV;
}

// ———————————————————————————————————————————————
// Paste parser
// ———————————————————————————————————————————————

// Parse a pasted block into prompts. Heuristics:
// - Split on blank lines.
// - Each non-empty chunk's first non-blank line is the prompt; subsequent
//   indented (>= 1 leading space/tab) lines are treated as continuation, but
//   we keep them on the prompt for context.
// - If a line contains "(XX words)" or "XX word limit" or "max XX words", we
//   pull out the number as the wordLimit.
// - If the user pastes a single flat block with no blank lines, we fall back
//   to splitting on numbered list prefixes ("1.", "2)", etc.).
export function parsePromptBlock(
  raw: string,
): { prompt: string; wordLimit?: number }[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const wordLimitRe =
    /\(?\s*(?:max(?:imum)?\s+)?(\d{2,4})\s*(?:-|\s)?word(?:s)?(?:\s+(?:limit|max(?:imum)?|or\s+less))?\s*\)?/i;

  const extractLimit = (line: string): number | undefined => {
    const m = line.match(wordLimitRe);
    if (!m) return undefined;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return undefined;
    if (n < 20 || n > 2000) return undefined;
    return n;
  };

  // Split on blank lines first.
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  let chunks: string[];
  if (blocks.length > 1) {
    chunks = blocks;
  } else {
    // Fallback: split on leading numbered / Q-prefix / bullet lines.
    const parts = text.split(/\n(?=\s*(?:\d+[.)]|Q\d*[:.]|[-*•])\s+)/g);
    chunks = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  }

  return chunks
    .map((chunk) => {
      // Strip a leading list prefix ("1.", "2)", "Q:", bullet "-", "*").
      const cleaned = chunk
        .replace(/^\s*(?:\d+[.)]|Q\d*[:.]|[-*•])\s+/, "")
        .trim();
      const wordLimit = extractLimit(cleaned);
      // If the wordLimit marker is parenthetical at the end, strip it from the
      // displayed prompt — otherwise leave the full chunk.
      const prompt = cleaned
        .replace(/\s*\(\s*[^()]*\b\d{2,4}\b[^()]*word[^()]*\)\s*$/i, "")
        .trim();
      return { prompt, wordLimit };
    })
    .filter((p) => p.prompt.length > 0);
}

// ———————————————————————————————————————————————
// Streaming delimiter splitter
// ———————————————————————————————————————————————

type DraftAcc = Record<number, string>;

// Given the entire stream so far, return a map of 1-based question index to
// the answer body accumulated for it. Robust to partial lines / mid-delimiter
// streaming.
function splitStream(acc: string): DraftAcc {
  const lines = acc.split("\n");
  const out: DraftAcc = {};
  let current: number | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current !== null) {
      out[current] = buffer.join("\n").trimStart();
    }
  };

  for (const line of lines) {
    const m = line.match(DELIMITER_RE);
    if (m) {
      flush();
      current = Number(m[1]);
      buffer = [];
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();

  // Trim trailing whitespace on each entry.
  for (const key of Object.keys(out)) {
    const k = Number(key);
    out[k] = out[k].replace(/\s+$/g, "");
  }
  return out;
}

function wordCount(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ———————————————————————————————————————————————
// Main component
// ———————————————————————————————————————————————

export function PreScreenSection({ app }: { app: Application }) {
  const { setPreScreen, updatePreScreenQuestion } = useApplications();

  const existing = app.preScreen;
  const [paste, setPaste] = useState("");
  const [tone, setTone] = useState<PreScreenTone>("direct");
  const [parsed, setParsed] = useState<
    { prompt: string; wordLimit?: number }[]
  >([]);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamBuf, setStreamBuf] = useState("");
  const [regenIdx, setRegenIdx] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const parsedCount = parsed.length;

  // If there's an existing preScreen, show it instead of the parse form by default.
  const showParser = !existing || paste.length > 0;

  const onParse = useCallback(() => {
    const next = parsePromptBlock(paste);
    setParsed(next);
  }, [paste]);

  const runStream = useCallback(
    async (args: {
      questions: { prompt: string; wordLimit?: number }[];
      onDelta: (buf: string) => void;
    }) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const baseCV = resolveBaseCV(app.cvSlug);

      const res = await fetch("/api/pre-screen/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationId: app.id,
          questions: args.questions,
          baseCV,
          parsedJob: app.jobData,
          tone,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const msg = `Draft failed (${res.status})`;
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        args.onDelta(acc);
      }
      acc += decoder.decode();
      args.onDelta(acc);
      return acc;
    },
    [app.cvSlug, app.id, app.jobData, tone],
  );

  const onDraftAll = useCallback(async () => {
    if (!parsedCount) return;
    setStreaming(true);
    setStreamError(null);
    setStreamBuf("");
    setRegenIdx(null);

    // Seed the preScreen record with empty drafts.
    const questions: PreScreenQuestion[] = parsed.map((p) => ({
      id: nanoid(8),
      prompt: p.prompt,
      wordLimit: p.wordLimit,
      tone,
      draft: "",
      generatedAt: Date.now(),
    }));
    setPreScreen(app.id, { generatedAt: Date.now(), questions });

    try {
      const full = await runStream({
        questions: parsed,
        onDelta: (buf) => {
          setStreamBuf(buf);
          const split = splitStream(buf);
          // Apply partial drafts to each question card as they stream.
          questions.forEach((q, i) => {
            const answer = split[i + 1];
            if (typeof answer === "string") {
              q.draft = answer;
            }
          });
          // Persist snapshot so UI stays in sync. Copy to new objects.
          setPreScreen(app.id, {
            generatedAt: questions[0]?.generatedAt ?? Date.now(),
            questions: questions.map((q) => ({ ...q })),
          });
        },
      });
      // Final split, commit finalAnswer too (user can still edit).
      const split = splitStream(full);
      const final: PreScreenQuestion[] = questions.map((q, i) => {
        const answer = split[i + 1] ?? q.draft ?? "";
        return { ...q, draft: answer, finalAnswer: answer };
      });
      setPreScreen(app.id, {
        generatedAt: Date.now(),
        questions: final,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setStreamError("Generation stopped.");
      } else {
        setStreamError(
          e instanceof Error ? e.message : "Draft failed.",
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [app.id, parsed, parsedCount, runStream, setPreScreen, tone]);

  const onStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onDiscard = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.confirm("Discard the pre-screen answers?")) {
      setPreScreen(app.id, undefined);
      setPaste("");
      setParsed([]);
    }
  }, [app.id, setPreScreen]);

  const onRegenOne = useCallback(
    async (q: PreScreenQuestion, idx: number) => {
      setRegenIdx(idx);
      setStreamError(null);
      try {
        const full = await runStream({
          questions: [{ prompt: q.prompt, wordLimit: q.wordLimit }],
          onDelta: (buf) => {
            const split = splitStream(buf);
            const answer = split[1] ?? "";
            updatePreScreenQuestion(app.id, q.id, {
              draft: answer,
              generatedAt: Date.now(),
              tone,
            });
          },
        });
        const split = splitStream(full);
        const answer = split[1] ?? "";
        updatePreScreenQuestion(app.id, q.id, {
          draft: answer,
          finalAnswer: answer,
          generatedAt: Date.now(),
          tone,
        });
      } catch (e) {
        setStreamError(
          e instanceof Error ? e.message : "Regenerate failed.",
        );
      } finally {
        setRegenIdx(null);
      }
    },
    [app.id, runStream, tone, updatePreScreenQuestion],
  );

  // Live parsed preview while typing — lightweight.
  const livePreview = useMemo(() => parsePromptBlock(paste), [paste]);

  // When the user clicks Parse explicitly, we use `parsed`. But if parsed is
  // empty and paste has text, offer the live preview too.
  const effectiveParsed = parsed.length > 0 ? parsed : livePreview;

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Pre-screen answers
        </h2>
        {existing && (
          <div className="flex items-center gap-4">
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

      {showParser && (
        <div className="border border-ink/10 p-5 mb-4">
          <div className="grid grid-cols-[120px_1fr] gap-y-5 gap-x-6 items-start">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 pt-2">
              Prompts
            </div>
            <div>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={6}
                placeholder={
                  "Paste the application's short-answer prompts here — one per line or one per paragraph.\n\ne.g.\n1. Why do you want to work here? (200 words)\n2. Describe a time you failed.\n3. Why this role?"
                }
                className="w-full bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 text-sm leading-relaxed placeholder:text-ink/30 resize-y"
              />
              <div className="flex items-center justify-between mt-1">
                <p className="font-mono text-[10px] tracking-[0.15em] text-ink/40">
                  {effectiveParsed.length} prompt
                  {effectiveParsed.length === 1 ? "" : "s"} detected.
                </p>
                <button
                  type="button"
                  onClick={onParse}
                  className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
                >
                  Re-parse
                </button>
              </div>
            </div>

            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 pt-2">
              Tone
            </div>
            <div
              role="radiogroup"
              aria-label="Pre-screen answer tone"
              className="flex flex-wrap gap-2"
            >
              {TONE_OPTIONS.map((t) => {
                const active = tone === t.value;
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
          </div>

          {effectiveParsed.length > 0 && (
            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
                Parsed
              </div>
              <ParsedPromptList
                items={effectiveParsed}
                onChange={setParsed}
                readOnly={streaming}
              />
            </div>
          )}

          <div className="flex items-center gap-4 mt-6">
            <button
              type="button"
              onClick={onDraftAll}
              disabled={streaming || effectiveParsed.length === 0}
              className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
            >
              {streaming ? "Drafting…" : "Draft all"}
            </button>
            {streaming && (
              <button
                type="button"
                onClick={onStop}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
              >
                Stop
              </button>
            )}
            {!app.jobData && (
              <span className="font-mono text-[11px] text-ink/40">
                No parsed job — drafting from CV only.
              </span>
            )}
            {!app.cvSlug && (
              <span className="font-mono text-[11px] text-ink/40">
                No CV linked — falling back to the default CV.
              </span>
            )}
          </div>

          {streamError && (
            <p className="mt-4 font-mono text-[11px] text-accent">
              {streamError}
            </p>
          )}

          {streamBuf && streaming && (
            <pre className="mt-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink/50 border-t border-ink/10 pt-3 max-h-32 overflow-auto">
              {streamBuf.slice(-800)}
            </pre>
          )}
        </div>
      )}

      {existing && existing.questions.length > 0 && (
        <div className="space-y-4">
          {existing.questions.map((q, idx) => (
            <PreScreenCard
              key={q.id}
              q={q}
              busy={regenIdx === idx || (streaming && !!q.draft)}
              onRegenerate={() => onRegenOne(q, idx)}
              onPatch={(patch) => updatePreScreenQuestion(app.id, q.id, patch)}
            />
          ))}
          <div className="flex items-center justify-between pt-2 border-t border-ink/10">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
              {existing.questions.length} answer
              {existing.questions.length === 1 ? "" : "s"} · generated{" "}
              {formatDateTime(existing.generatedAt)}
            </span>
            <button
              type="button"
              onClick={() => {
                // Regenerate all — reuses current questions.
                const q = existing.questions.map((x) => ({
                  prompt: x.prompt,
                  wordLimit: x.wordLimit,
                }));
                setParsed(q);
                // Defer so state settles before draft.
                setTimeout(onDraftAll, 0);
              }}
              disabled={streaming}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink disabled:opacity-40"
            >
              Regenerate all
            </button>
          </div>
        </div>
      )}

      {!existing && !showParser && (
        <button
          type="button"
          onClick={() => setPaste(" ")}
          className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 border border-ink/20 text-ink/70 hover:border-ink hover:text-ink"
        >
          Add pre-screen prompts
        </button>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————
// Parsed-prompt editor
// ———————————————————————————————————————————————

function ParsedPromptList({
  items,
  onChange,
  readOnly,
}: {
  items: { prompt: string; wordLimit?: number }[];
  onChange: (v: { prompt: string; wordLimit?: number }[]) => void;
  readOnly?: boolean;
}) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/40 pt-2 w-6 shrink-0">
            {i + 1}.
          </span>
          <input
            type="text"
            value={it.prompt}
            disabled={readOnly}
            onChange={(e) => {
              const next = items.slice();
              next[i] = { ...next[i], prompt: e.target.value };
              onChange(next);
            }}
            className="flex-1 bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            value={it.wordLimit ?? ""}
            disabled={readOnly}
            placeholder="limit"
            min={20}
            max={2000}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const n = raw ? Number(raw) : undefined;
              const next = items.slice();
              next[i] = {
                ...next[i],
                wordLimit: n && Number.isFinite(n) ? n : undefined,
              };
              onChange(next);
            }}
            className="w-20 bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-2 py-1.5 text-sm font-mono text-right"
          />
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-accent px-2 py-1.5 disabled:opacity-40"
          >
            ×
          </button>
        </li>
      ))}
      {!readOnly && (
        <li>
          <button
            type="button"
            onClick={() =>
              onChange([...items, { prompt: "", wordLimit: undefined }])
            }
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
          >
            + Add a prompt
          </button>
        </li>
      )}
    </ul>
  );
}

// ———————————————————————————————————————————————
// Answer card
// ———————————————————————————————————————————————

function PreScreenCard({
  q,
  busy,
  onRegenerate,
  onPatch,
}: {
  q: PreScreenQuestion;
  busy: boolean;
  onRegenerate: () => void;
  onPatch: (patch: Partial<Omit<PreScreenQuestion, "id">>) => void;
}) {
  const [local, setLocal] = useState(q.finalAnswer ?? q.draft ?? "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Keep the local answer in sync with the upstream final / draft content.
    // If the user has been editing and the upstream changes (e.g. regenerate),
    // we honor the upstream value.
    setLocal(q.finalAnswer ?? q.draft ?? "");
  }, [q.finalAnswer, q.draft]);

  const limit = q.wordLimit;
  const wc = wordCount(local);
  const overLimit = typeof limit === "number" && wc > limit;

  const onSave = useCallback(() => {
    const v = local.trim();
    if ((q.finalAnswer ?? "") === v) return;
    onPatch({ finalAnswer: v });
  }, [local, onPatch, q.finalAnswer]);

  const onCopy = useCallback(async () => {
    if (!local.trim()) return;
    try {
      await navigator.clipboard.writeText(local);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [local]);

  return (
    <article className="border border-ink/10">
      <header className="px-5 pt-4 pb-3 flex items-start justify-between gap-4 border-b border-ink/10">
        <h3 className="font-display text-[17px] leading-snug text-ink/90 flex-1">
          {q.prompt}
        </h3>
        <div className="flex items-center gap-3 shrink-0">
          {typeof limit === "number" && (
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.2em] px-1.5 py-0.5 border ${
                overLimit
                  ? "border-accent/40 text-accent bg-accent/5"
                  : "border-ink/15 text-ink/60"
              }`}
            >
              {limit} word limit
            </span>
          )}
          {q.tone && (
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
              {q.tone}
            </span>
          )}
        </div>
      </header>

      <div className="px-5 py-4">
        <textarea
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={onSave}
          rows={Math.min(14, Math.max(6, local.split("\n").length + 2))}
          disabled={busy}
          className="w-full bg-paper/40 border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre-wrap resize-y disabled:opacity-60"
        />
        <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
          <div className="flex items-center gap-4">
            <span
              className={`font-mono text-[11px] ${
                overLimit ? "text-accent" : "text-ink/50"
              }`}
            >
              {wc} word{wc === 1 ? "" : "s"}
              {typeof limit === "number" ? ` / ${limit}` : ""}
            </span>
            {q.generatedAt && (
              <span className="font-mono text-[10px] tracking-[0.15em] text-ink/40">
                generated {formatDateTime(q.generatedAt)}
              </span>
            )}
          </div>
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
              onClick={onRegenerate}
              disabled={busy}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink disabled:opacity-40"
            >
              Regenerate
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
