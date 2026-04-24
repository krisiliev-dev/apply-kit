"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import type {
  Application,
  FollowUp,
  FollowUpKind,
  FollowUpStatus,
} from "@/lib/app/types";
import {
  useFollowUps,
  selectForApplication,
} from "@/lib/app/followupStore";
import { FOLLOWUP_KIND_LABEL } from "@/lib/app/followupCadence";
import { formatDateTime } from "@/lib/app/ui";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";
import { trackedFetch } from "@/lib/ai/tokenLedger";

// FollowUpsSection — appears on the application detail page.
// Lists every follow-up for this application (pending, snoozed, sent, skipped).
// Per row: kind · scheduled date · status · generate draft · snooze / mark sent / skip.
// Editable textarea on any drafted body (saved on blur).

const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_OPTIONS: FollowUpKind[] = [
  "post-apply",
  "post-screen",
  "post-interview",
  "post-offer",
  "custom",
];

const STATUS_LABEL: Record<FollowUpStatus, string> = {
  pending: "Pending",
  sent: "Sent",
  skipped: "Skipped",
  snoozed: "Snoozed",
};

const STATUS_CLASS: Record<FollowUpStatus, string> = {
  pending: "bg-accent/10 text-accent border-accent/30",
  sent: "bg-ink text-paper border-ink",
  skipped: "bg-ink/5 text-ink/40 border-ink/10 line-through",
  snoozed: "bg-ink/5 text-ink/60 border-ink/15 italic",
};

export function FollowUpsSection({ app }: { app: Application }) {
  const load = useFollowUps((s) => s.load);
  const refresh = useFollowUps((s) => s.refresh);
  const items = useFollowUps(selectForApplication(app.id));
  const add = useFollowUps((s) => s.add);
  const update = useFollowUps((s) => s.update);
  const remove = useFollowUps((s) => s.remove);

  useEffect(() => {
    load();
  }, [load]);

  // Cross-tab sync — autoStageFollowUpsForStatus fires this event after it
  // writes directly to localStorage.
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("cv-maker:followups-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("cv-maker:followups-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, [refresh]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.scheduledFor - b.scheduledFor),
    [items],
  );

  const onAddCustom = useCallback(() => {
    const fu: FollowUp = {
      id: nanoid(10),
      applicationId: app.id,
      kind: "custom",
      scheduledFor: Date.now() + 3 * DAY_MS,
      status: "pending",
    };
    add(fu);
  }, [app.id, add]);

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Follow-ups
        </h2>
        <button
          type="button"
          onClick={onAddCustom}
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
        >
          + Custom nudge
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="font-display italic text-ink/50">
          No follow-ups queued. They auto-stage when status changes — or add
          one manually above.
        </p>
      ) : (
        <ul className="space-y-4">
          {sorted.map((fu) => (
            <FollowUpRow
              key={fu.id}
              fu={fu}
              app={app}
              onUpdate={(patch) => update(fu.id, patch)}
              onRemove={() => remove(fu.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————
// Row
// ———————————————————————————————————————————————

function FollowUpRow({
  fu,
  app,
  onUpdate,
  onRemove,
}: {
  fu: FollowUp;
  app: Application;
  onUpdate: (patch: Partial<Omit<FollowUp, "id">>) => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamed, setStreamed] = useState<string>("");
  const [draft, setDraft] = useState<string>(fu.emailDraft ?? "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDraft(fu.emailDraft ?? "");
  }, [fu.emailDraft]);

  const scheduled = new Date(fu.scheduledFor);
  const now = Date.now();
  const dueSoon = fu.status === "pending" && fu.scheduledFor < now + 2 * DAY_MS;
  const overdue = fu.status === "pending" && fu.scheduledFor < now;

  const onGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStreamed("");
    try {
      const res = await trackedFetch("/api/follow-up/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationId: app.id,
          application: app,
          kind: fu.kind,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? `Draft failed (${res.status}).`);
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreamed(acc);
      }
      const body = acc.trim();
      if (body) {
        onUpdate({ emailDraft: body, generatedAt: Date.now() });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [app, fu.kind, onUpdate]);

  const onCopy = useCallback(async () => {
    const text = draft || streamed;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [draft, streamed]);

  const onDraftBlur = useCallback(() => {
    if (draft !== (fu.emailDraft ?? "")) {
      onUpdate({ emailDraft: draft });
    }
  }, [draft, fu.emailDraft, onUpdate]);

  return (
    <li className="border border-ink/10 p-4">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/80">
          {FOLLOWUP_KIND_LABEL[fu.kind]}
        </span>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 border ${STATUS_CLASS[fu.status]}`}
        >
          {STATUS_LABEL[fu.status]}
        </span>
        <span
          className={`font-mono text-[11px] ${overdue ? "text-accent" : dueSoon ? "text-accent/80" : "text-ink/60"}`}
        >
          {overdue ? "Overdue · " : dueSoon ? "Due soon · " : ""}
          {scheduled.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <input
          type="date"
          value={toDateInputValue(fu.scheduledFor)}
          onChange={(e) =>
            onUpdate({
              scheduledFor: new Date(e.target.value).getTime() || fu.scheduledFor,
            })
          }
          className="font-mono text-[11px] bg-transparent border border-ink/10 focus:border-ink/60 focus:outline-none px-2 py-0.5"
        />
        <div className="ml-auto flex items-center gap-3">
          {fu.status === "pending" && (
            <>
              <button
                type="button"
                onClick={() =>
                  onUpdate({
                    status: "snoozed",
                    scheduledFor: Date.now() + 3 * DAY_MS,
                  })
                }
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
              >
                Snooze 3d
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdate({ status: "sent", sentAt: Date.now() })
                }
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
              >
                Mark sent
              </button>
              <button
                type="button"
                onClick={() => onUpdate({ status: "skipped" })}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-accent"
              >
                Skip
              </button>
            </>
          )}
          {fu.status === "snoozed" && (
            <button
              type="button"
              onClick={() => onUpdate({ status: "pending" })}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
            >
              Unsnooze
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                window.confirm("Delete this follow-up?")
              ) {
                onRemove();
              }
            }}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-accent"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-3">
        {fu.emailDraft ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={onDraftBlur}
              rows={Math.min(18, Math.max(4, draft.split("\n").length + 1))}
              className="w-full bg-paper/40 border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre-wrap resize-y"
            />
            <div className="flex items-center gap-4 mt-2">
              <button
                type="button"
                onClick={onCopy}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70 hover:text-ink"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={onGenerate}
                disabled={busy}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink disabled:opacity-40"
              >
                {busy ? "Drafting…" : "Regenerate"}
              </button>
              {fu.generatedAt && (
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40 ml-auto">
                  Drafted {formatDateTime(fu.generatedAt)}
                </span>
              )}
            </div>
          </>
        ) : (
          <div>
            {streamed && (
              <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink/80 bg-paper/40 border border-ink/10 p-3 mb-3">
                {streamed}
              </pre>
            )}
            <button
              type="button"
              onClick={onGenerate}
              disabled={busy}
              className="font-mono text-[11px] uppercase tracking-[0.2em] px-3 py-1.5 border border-ink/20 text-ink/70 hover:border-ink hover:text-ink disabled:opacity-40"
            >
              {busy ? "Drafting…" : "Generate draft"}
            </button>
          </div>
        )}
        {error && (
          <div className="mt-2">
            <ApiKeyHint error={error} inline />
          </div>
        )}
      </div>
    </li>
  );
}

function toDateInputValue(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Export the options for consumers that want to render a "new custom
// follow-up" control inline (unused here — kept for future callers).
export { KIND_OPTIONS };
