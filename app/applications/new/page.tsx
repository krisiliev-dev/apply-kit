"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { nanoid } from "nanoid";
import { useApplications } from "@/lib/app/store";
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationStatus,
} from "@/lib/app/types";
import { STATUS_LABEL } from "@/lib/app/ui";

export default function NewApplicationPage() {
  const router = useRouter();
  const { load, upsert } = useApplications();

  // Hydrate so the new record lands on top of any existing persisted list.
  useEffect(() => {
    load();
  }, [load]);

  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("applied");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = company.trim().length > 0 && role.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);

    const app: Application = {
      id: nanoid(8),
      company: company.trim(),
      role: role.trim(),
      url: url.trim() || undefined,
      status,
      notes: notes.trim() || undefined,
      dateCreated: Date.now(),
      events: [],
    };
    upsert(app);
    router.push(`/applications/${app.id}`);
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-6 py-16">
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          <Link href="/applications" className="hover:text-ink">
            Applications
          </Link>{" "}
          / new
        </p>
        <h1 className="font-display text-5xl mt-3">
          Log an <em>application.</em>
        </h1>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Field label="Company" required>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            required
            autoFocus
            className="w-full bg-transparent border-b border-ink/20 focus:border-ink/60 focus:outline-none py-2 font-display text-2xl"
            placeholder="Acme Inc."
          />
        </Field>

        <Field label="Role" required>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            required
            className="w-full bg-transparent border-b border-ink/20 focus:border-ink/60 focus:outline-none py-2 text-lg"
            placeholder="Staff Engineer"
          />
        </Field>

        <Field label="URL">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full bg-transparent border-b border-ink/20 focus:border-ink/60 focus:outline-none py-2 font-mono text-sm"
            placeholder="https://…"
          />
        </Field>

        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
            className="bg-transparent border border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] cursor-pointer"
          >
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full bg-transparent border border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 text-sm leading-relaxed resize-y"
            placeholder="Referral, recruiter name, deadline…"
          />
        </Field>

        <div className="flex items-center justify-between pt-4 border-t border-ink/10">
          <Link
            href="/applications"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-paper bg-ink px-4 py-2.5 hover:bg-ink/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create application
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50">
        {label}
        {required && <span className="text-accent ml-1">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
