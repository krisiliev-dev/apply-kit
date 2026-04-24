"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Application, ApplyFitCheck } from "@/lib/app/types";
import { getApplication, patchApplication } from "@/lib/app/storage";
import { profile as baseProfile } from "@/content/profile";
import type { AtsJobSchema } from "@/lib/jobs/ats";
import { detectAts } from "@/lib/jobs/ats";
import { loadDraftEval, type DraftEvalResult } from "@/lib/evaluation/keywords";
import { FitCheckCard } from "@/components/applications/FitCheckCard";
import { CvSlugStatus } from "@/components/applications/CvSlugStatus";
import { defaultCV } from "@/content/cvs/default";
import { cvs } from "@/content/cvs";

type AtsState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ready"; schema: AtsJobSchema }
  | { kind: "error"; message: string };

export function JobDetailView({ appId }: { appId: string }) {
  const [app, setApp] = useState<Application | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [ats, setAts] = useState<AtsState>({ kind: "none" });
  const [draftEval, setDraftEval] = useState<DraftEvalResult | null>(null);

  useEffect(() => {
    const found = getApplication(appId);
    setApp(found ?? null);
    setDraftEval(loadDraftEval(appId));
    setLoaded(true);
  }, [appId]);

  const atsPointer = useMemo(() => {
    if (!app?.url) return null;
    return detectAts(app.url);
  }, [app?.url]);

  useEffect(() => {
    if (!app?.url || !atsPointer) return;
    let cancelled = false;
    setAts({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/jobs/ats-schema?url=${encodeURIComponent(app.url!)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setAts({
            kind: "error",
            message: data?.error ?? "Failed to load ATS schema.",
          });
          return;
        }
        setAts({ kind: "ready", schema: data.schema as AtsJobSchema });
      } catch (err) {
        if (cancelled) return;
        setAts({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app?.url, atsPointer]);

  if (!loaded) {
    return (
      <main className="min-h-screen max-w-4xl mx-auto px-6 py-16 font-mono text-xs text-ink/60">
        Loading…
      </main>
    );
  }

  if (!app) {
    return (
      <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
        <p className="font-display text-3xl">Application not found.</p>
        <p className="mt-4 font-mono text-xs text-ink/60">
          It may have been cleared from this browser&apos;s storage.{" "}
          <Link href="/jobs" className="underline underline-offset-4">
            Start a new one
          </Link>
          .
        </p>
      </main>
    );
  }

  function setStatus(status: Application["status"]) {
    if (!app) return;
    const updated = patchApplication(app.id, {
      status,
      events: [
        ...(app.events ?? []),
        {
          at: Date.now(),
          kind: "status-change",
          from: app.status,
          to: status,
        },
      ],
    });
    if (updated) setApp(updated);
  }

  const job = app.jobData;

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          {app.company}
        </p>
        <h1 className="font-display text-5xl mt-2">{app.role}</h1>
        {app.url && (
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block font-mono text-xs text-ink/60 underline underline-offset-4 hover:text-ink"
          >
            {safeHostname(app.url)} ↗
          </a>
        )}
      </header>

      <section className="mb-10 flex items-center gap-2 flex-wrap">
        {(
          [
            "draft",
            "applied",
            "screen",
            "interview",
            "offer",
            "rejected",
            "withdrawn",
          ] as const
        ).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            data-active={app.status === s}
            className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] border border-ink/20 text-ink/60 data-[active=true]:bg-ink data-[active=true]:text-paper data-[active=true]:border-ink"
          >
            {s}
          </button>
        ))}
      </section>

      {job && (
        <section className="mb-12">
          <FitCheckCard
            inputs={{
              parsedJob: job,
              baseCV:
                (app.cvSlug && cvs[app.cvSlug]) || defaultCV,
              profile: baseProfile,
            }}
            cached={app.applyFit}
            onResult={(fit: ApplyFitCheck) => {
              const updated = patchApplication(app.id, { applyFit: fit });
              if (updated) setApp(updated);
            }}
          />
        </section>
      )}

      <section className="grid md:grid-cols-2 gap-8 mb-12">
        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-3">
            Tailored CV
          </h2>
          {app.cvSlug ? (
            <div className="border border-ink/10 p-4 space-y-2">
              <p className="font-mono text-xs text-ink/60">
                /cv/{app.cvSlug}
              </p>
              <CvSlugStatus slug={app.cvSlug} />
              <Link
                href={`/cv/${app.cvSlug}`}
                className="inline-block border border-ink bg-ink text-paper px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] hover:bg-transparent hover:text-ink transition-colors"
              >
                Open in editor
              </Link>
            </div>
          ) : (
            <p className="font-mono text-xs text-ink/50">No CV drafted yet.</p>
          )}
        </div>

        {job && (
          <div>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-3">
              Parsed job
            </h2>
            <dl className="space-y-2 font-mono text-xs">
              {job.location && <Row label="Location">{job.location}</Row>}
              {job.salary && <Row label="Salary">{job.salary}</Row>}
              {job.keywords.length > 0 && (
                <Row label="Keywords">{job.keywords.join(" · ")}</Row>
              )}
            </dl>
          </div>
        )}
      </section>

      {draftEval && (
        <DraftEvalPanel result={draftEval} />
      )}

      {job && (
        <section className="grid md:grid-cols-2 gap-8 mb-12">
          <Bullets title="Requirements" items={job.requirements} />
          <Bullets title="Responsibilities" items={job.responsibilities} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-3">
          Application form
        </h2>
        {ats.kind === "none" && (
          <p className="font-mono text-xs text-ink/50">
            No supported ATS detected in the job URL. Prefill is available for
            Greenhouse, Lever, Ashby, Workday, SmartRecruiters, and Teamtailor.
          </p>
        )}
        {ats.kind === "loading" && (
          <p className="font-mono text-xs text-ink/60">
            Loading application schema…
          </p>
        )}
        {ats.kind === "error" && (
          <p className="font-mono text-xs text-accent">{ats.message}</p>
        )}
        {ats.kind === "ready" && (
          <PrefilledForm schema={ats.schema} app={app} />
        )}
      </section>

      <footer className="mt-16 font-mono text-[11px] text-ink/50 space-y-1">
        <p>
          <Link href="/jobs" className="underline underline-offset-4">
            ← all applications
          </Link>
        </p>
      </footer>
    </main>
  );
}

function safeHostname(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-ink/50 uppercase tracking-[0.1em]">
        {label}
      </dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function DraftEvalPanel({ result }: { result: DraftEvalResult }) {
  const pct = Math.round(result.score * 100);
  const coverage = Math.round(result.keywordCoverage * 100);
  const hasWarnings = result.warnings.length > 0;
  return (
    <section className="mb-12 border border-ink/10 p-4">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Draft quality
        </h2>
        <div className="flex items-center gap-4 font-mono text-[11px] text-ink/60">
          <span>
            Score <span className="text-ink">{pct}%</span>
          </span>
          <span>
            Keywords <span className="text-ink">{coverage}%</span>
          </span>
          <span>
            Flags{" "}
            <span className={hasWarnings ? "text-accent" : "text-ink"}>
              {result.warnings.length}
            </span>
          </span>
        </div>
      </div>
      {hasWarnings ? (
        <ul className="space-y-1 font-mono text-[11px]">
          {result.warnings.map((w, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent shrink-0">!</span>
              <span className="text-ink/80">
                <span className="uppercase tracking-[0.15em] text-ink/50 mr-2">
                  {w.kind.replace(/-/g, " ")}
                </span>
                {w.message}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-mono text-[11px] text-ink/60">
          No flags — truthful, on-length, and keyword-aligned.
        </p>
      )}
    </section>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-2">
        {title}
      </h3>
      <ul className="space-y-1 text-sm leading-relaxed">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-ink/40">·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ———————————————————————————————————————————————
// Prefilled form
//
// We NEVER submit. The panel surfaces field-by-field values the user copies
// into the real ATS form, then a final "Open application form" button opens
// the posting's apply URL in a new tab.
// ———————————————————————————————————————————————

function PrefilledForm({
  schema,
  app,
}: {
  schema: AtsJobSchema;
  app: Application;
}) {
  const defaults = useMemo(() => buildDefaults(schema, app), [schema, app]);
  const [values, setValues] = useState<Record<string, string>>(defaults);

  useEffect(() => {
    setValues(defaults);
  }, [defaults]);

  return (
    <div className="border border-ink/10 p-4">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="font-mono text-xs text-ink/60">
            {schema.provider} · {schema.title}
          </p>
          <p className="font-mono text-[10px] text-ink/40 mt-1">
            Values are prefilled locally. Nothing is submitted.
          </p>
        </div>
        {schema.applyUrl && (
          <a
            href={schema.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="border border-ink bg-ink text-paper px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] hover:bg-transparent hover:text-ink transition-colors"
          >
            Open application form ↗
          </a>
        )}
      </div>

      {schema.isStub && (
        <div className="mb-4 border border-ink/20 bg-ink/[0.03] px-3 py-2 font-mono text-[11px] text-ink/70">
          <span className="uppercase tracking-[0.18em] text-ink/50">
            {schema.stubLabel ?? "Standard fields"}
          </span>
          <span className="block mt-1 text-ink/60">
            Standard fields only — this ATS doesn&apos;t expose form defs
            publicly. Copy these values into the real form.
          </span>
        </div>
      )}

      {schema.fields.length === 0 && (
        <p className="font-mono text-xs text-ink/50">
          This posting didn&apos;t expose field definitions.
        </p>
      )}

      <div className="space-y-4">
        {schema.fields.map((f) => (
          <div key={f.name}>
            <div className="flex items-baseline justify-between">
              <label className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60">
                {f.label}{" "}
                {f.required && <span className="text-accent">*</span>}
              </label>
              <CopyButton value={values[f.name] ?? ""} />
            </div>
            {f.help && (
              <p className="font-mono text-[10px] text-ink/40 mt-1">{f.help}</p>
            )}
            {f.type === "textarea" ? (
              <textarea
                value={values[f.name] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.name]: e.target.value }))
                }
                rows={4}
                className="mt-2 w-full border border-ink/20 bg-paper px-3 py-2 text-sm focus:outline-none focus:border-ink font-sans"
              />
            ) : f.type === "select" ? (
              <select
                value={values[f.name] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.name]: e.target.value }))
                }
                className="mt-2 w-full border border-ink/20 bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:border-ink"
              >
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "file" ? (
              <p className="mt-2 font-mono text-xs text-ink/50">
                File upload — attach in the real form. Export your CV as PDF
                from the editor first.
              </p>
            ) : (
              <input
                type={
                  f.type === "email"
                    ? "email"
                    : f.type === "url"
                      ? "url"
                      : "text"
                }
                value={values[f.name] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.name]: e.target.value }))
                }
                className="mt-2 w-full border border-ink/20 bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:border-ink"
              />
            )}
          </div>
        ))}
      </div>

      <p className="mt-6 font-mono text-[10px] text-ink/40">
        {/* TODO: actual submission + ATS OAuth — out of scope. */}
        The &quot;apply&quot; button opens the real form in a new tab.
        Submission stays in your hands.
      </p>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink/50 hover:text-ink"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function buildDefaults(
  schema: AtsJobSchema,
  app: Application,
): Record<string, string> {
  const firstName = baseProfile.name.split(" ")[0] ?? "";
  const lastName = baseProfile.name.split(" ").slice(1).join(" ");
  const linkedin =
    baseProfile.links?.find((l) => /linkedin/i.test(l.label))?.href ?? "";
  const github =
    baseProfile.links?.find((l) => /github/i.test(l.label))?.href ?? "";
  const website =
    baseProfile.links?.find((l) => /site|portfolio|web/i.test(l.label))?.href ??
    "";

  const out: Record<string, string> = {};

  for (const f of schema.fields) {
    const n = f.name.toLowerCase();
    if (
      n.includes("first_name") ||
      n === "first_name" ||
      n.endsWith("[first]")
    ) {
      out[f.name] = firstName;
    } else if (n.includes("last_name") || n.endsWith("[last]")) {
      out[f.name] = lastName;
    } else if (
      n === "name" ||
      n.includes("full_name") ||
      n.includes("fullname")
    ) {
      out[f.name] = baseProfile.name;
    } else if (f.type === "email" || n.includes("email")) {
      out[f.name] = baseProfile.email;
    } else if (n.includes("phone")) {
      out[f.name] = baseProfile.phone ?? "";
    } else if (n.includes("linkedin")) {
      out[f.name] = linkedin;
    } else if (n.includes("github")) {
      out[f.name] = github;
    } else if (n.includes("website") || n.includes("portfolio")) {
      out[f.name] = website;
    } else if (n.includes("location") || n.includes("city")) {
      out[f.name] = baseProfile.location ?? "";
    } else if (n.includes("cover") || n.includes("why")) {
      out[f.name] = coverLetterSeed(app);
    } else {
      out[f.name] = "";
    }
  }

  return out;
}

function coverLetterSeed(app: Application): string {
  const job = app.jobData;
  if (!job) return "";
  const firstBit = job.requirements.slice(0, 2).join(" and ");
  return `Hi ${app.company} team,\n\nI'm ${baseProfile.name}, a ${baseProfile.title}. I read the ${app.role} posting and wanted to reach out because ${firstBit ? firstBit.toLowerCase() + " is exactly the kind of work I've been doing" : "this role lines up with what I do"}.\n\n[Add a concrete story here — one thing you shipped that maps to this role.]\n\nYou can see my CV attached.\n\n— ${baseProfile.name}`;
}
