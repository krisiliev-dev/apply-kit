"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApplications } from "@/lib/app/store";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/app/types";
import { STATUS_CLASS, STATUS_LABEL, formatDate } from "@/lib/app/ui";
import { downloadApplicationsCsv } from "@/lib/app/csv";

type FilterStatus = ApplicationStatus | "all";

const FILTERS: FilterStatus[] = ["all", ...APPLICATION_STATUSES];

export default function ApplicationsPage() {
  const { applications, loaded, load, updateStatus } = useApplications();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applications
      .filter((a) => (filter === "all" ? true : a.status === filter))
      .filter((a) =>
        q.length === 0
          ? true
          : a.company.toLowerCase().includes(q) ||
            a.role.toLowerCase().includes(q),
      )
      .slice()
      .sort((a, b) => b.dateCreated - a.dateCreated);
  }, [applications, filter, query]);

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
      <header className="mb-10">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            Applications
          </p>
          <nav className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/50 flex gap-4">
            <Link href="/" className="hover:text-ink">
              CV Workshop
            </Link>
            <Link href="/jobs" className="hover:text-ink">
              Jobs
            </Link>
            <Link href="/applications/review" className="hover:text-ink">
              Review
            </Link>
          </nav>
        </div>
        <div className="flex items-end justify-between gap-4 mt-2">
          <h1 className="font-display text-5xl">
            Where did you <em>apply?</em>
          </h1>
          <div className="flex gap-2 pb-2">
            <button
              type="button"
              onClick={() => downloadApplicationsCsv(applications)}
              disabled={applications.length === 0}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70 border border-ink/15 px-3 py-2 hover:text-ink hover:border-ink/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Download CSV
            </button>
            <Link
              href="/applications/new"
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-paper bg-ink px-3 py-2 hover:bg-ink/80"
            >
              + New application
            </Link>
          </div>
        </div>
      </header>

      <section className="mb-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = filter === f;
          const count =
            f === "all"
              ? applications.length
              : applications.filter((a) => a.status === f).length;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`font-mono text-[10px] uppercase tracking-[0.2em] px-2.5 py-1.5 border transition-colors ${
                active
                  ? "bg-ink text-paper border-ink"
                  : "bg-transparent text-ink/60 border-ink/15 hover:text-ink hover:border-ink/40"
              }`}
            >
              {f === "all" ? "All" : STATUS_LABEL[f]}
              <span className="ml-1.5 opacity-60">{count}</span>
            </button>
          );
        })}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company or role"
          className="ml-auto font-mono text-[11px] uppercase tracking-[0.15em] bg-transparent border-b border-ink/15 focus:border-ink/60 focus:outline-none px-1 py-1.5 placeholder:text-ink/30 min-w-[220px]"
        />
      </section>

      <section>
        {loaded && visible.length === 0 ? (
          <div className="border-y border-ink/10 py-16 text-center">
            <p className="font-display text-2xl italic text-ink/50">
              {applications.length === 0
                ? "No applications yet."
                : "Nothing matches."}
            </p>
            {applications.length === 0 && (
              <Link
                href="/applications/new"
                className="inline-block mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70 hover:text-ink underline decoration-ink/20 underline-offset-4"
              >
                Log your first one
              </Link>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {visible.map((a) => (
              <li key={a.id} className="group">
                <div className="flex items-center gap-4 py-4">
                  <Link
                    href={`/applications/${a.id}`}
                    className="flex-1 min-w-0 flex items-baseline gap-4 hover:opacity-70"
                  >
                    <span className="font-display text-2xl truncate">
                      {a.company}
                    </span>
                    <span className="text-ink/70 truncate">{a.role}</span>
                  </Link>

                  <select
                    value={a.status}
                    onChange={(e) =>
                      updateStatus(a.id, e.target.value as ApplicationStatus)
                    }
                    aria-label={`Status for ${a.company}`}
                    className={`font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-1 border appearance-none cursor-pointer ${
                      STATUS_CLASS[a.status]
                    }`}
                  >
                    {APPLICATION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>

                  <span className="font-mono text-[11px] text-ink/50 w-24 text-right shrink-0">
                    {formatDate(a.dateCreated)}
                  </span>

                  {a.cvSlug ? (
                    <Link
                      href={`/cv/${a.cvSlug}`}
                      className="font-mono text-[11px] text-ink/60 hover:text-ink underline decoration-ink/20 underline-offset-4 w-28 text-right truncate shrink-0"
                      title={`Open /cv/${a.cvSlug}`}
                    >
                      /cv/{a.cvSlug}
                    </Link>
                  ) : (
                    <span className="font-mono text-[11px] text-ink/30 w-28 text-right shrink-0">
                      —
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
