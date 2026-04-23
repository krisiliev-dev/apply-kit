"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useApplications } from "@/lib/app/store";
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
  type ApplicationEvent,
} from "@/lib/app/types";
import { STATUS_CLASS, STATUS_LABEL, formatDateTime } from "@/lib/app/ui";

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";

  const { applications, loaded, load, setField, updateStatus, remove } =
    useApplications();

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
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          <Link href="/applications" className="hover:text-ink">
            Applications
          </Link>{" "}
          / {app.id}
        </p>

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
