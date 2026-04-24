"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdvisor } from "@/lib/advisor/store";
import { formatRelative } from "@/lib/advisor/ui";
import type { SkillGapAnalysis, SkillDemand } from "@/lib/advisor/types";
import { profile } from "@/content/profile";
import { cvList } from "@/content/cvs";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";
import { trackedFetch } from "@/lib/ai/tokenLedger";

// /advisor/skills — detailed. Shows the latest skill-gap analysis as a table
// with demand counts, adjacency notes, and concrete acquisition paths. Needs
// job postings to analyze — the user fetches them on /discover, then we send
// whatever's in the discovery queue to the endpoint as the "recentPostings"
// payload. If nothing's been fetched yet we still render a stub CTA.

type DiscoveryStateShape = {
  postings?: Record<string, { id: string; title: string; company: string; description?: string; requirements?: string[] }>;
};

function loadRecentPostingsFromStorage() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("cv-maker:discovery-state");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DiscoveryStateShape;
    const postings = Object.values(parsed.postings ?? {});
    return postings.slice(0, 80);
  } catch {
    return [];
  }
}

export default function SkillsPage() {
  const advisor = useAdvisor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCritical, setFilterCritical] = useState(false);

  useEffect(() => {
    advisor.load();
  }, [advisor]);

  const onGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const recentPostings = loadRecentPostingsFromStorage();
      const res = await trackedFetch("/api/advisor/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile, cvVariants: cvList, recentPostings }),
      });
      const data = (await res.json()) as { analysis?: SkillGapAnalysis; error?: string };
      if (!res.ok || !data.analysis) {
        setError(data.error ?? "Failed to generate skill gap analysis.");
        return;
      }
      advisor.setSkills(data.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [advisor]);

  const skills = advisor.skills;

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
      <Breadcrumbs current="Skills" />

      <h1 className="font-display text-5xl mt-3">
        Skills demanded, skills <em>owned.</em>
      </h1>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 mt-3">
        Aggregated across your recent discovery postings.
      </p>

      <div className="mt-8 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
        >
          {busy ? "Thinking…" : skills ? "Regenerate" : "Generate analysis"}
        </button>
        {skills ? (
          <p className="font-mono text-[11px] text-ink/50">
            Last generated {formatRelative(skills.generatedAt)} · {skills.analyzedPostingCount} postings analyzed
          </p>
        ) : null}
        {error ? <ApiKeyHint error={error} inline /> : null}
      </div>

      {skills ? (
        <div className="mt-12 space-y-12">
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <SectionHeading>Critical gaps</SectionHeading>
              <label className="font-mono text-[10px] uppercase tracking-wider text-ink/60 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filterCritical}
                  onChange={(e) => setFilterCritical(e.target.checked)}
                />
                show only critical
              </label>
            </div>
            <SkillsTable rows={skills.criticalGaps} empty="No critical gaps detected — the aggregate skill set looks covered." />
          </section>

          {!filterCritical && (
            <section>
              <SectionHeading>Nice-to-have gaps</SectionHeading>
              <SkillsTable rows={skills.niceToHaveGaps} empty="No nice-to-haves flagged." />
            </section>
          )}

          <section>
            <SectionHeading>Acquisition paths</SectionHeading>
            {skills.acquisitionPaths.length === 0 ? (
              <p className="font-display italic text-ink/50">No paths suggested.</p>
            ) : (
              <ul className="space-y-4">
                {skills.acquisitionPaths.map((p) => (
                  <li key={p.skill} className="border-l-2 border-ink/10 pl-4">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-display text-lg">{p.skill}</span>
                      <span className="font-mono text-[10px] text-ink/50">
                        ~{p.effortWeeks} weeks
                      </span>
                    </div>
                    <p className="text-sm text-ink/80 leading-relaxed mt-1">{p.path}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {skills.userHas.length > 0 && (
            <section>
              <SectionHeading>You already cover</SectionHeading>
              <div className="flex flex-wrap gap-2">
                {skills.userHas.map((s) => (
                  <span
                    key={s}
                    className="font-mono text-[10px] uppercase tracking-wider text-ink/60 border border-ink/15 px-2 py-1"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <p className="mt-12 font-display italic text-ink/50">
          Generate an analysis — it aggregates skills from the last 80 postings in
          your discovery queue and shows which ones you don&apos;t yet cover, with
          concrete acquisition paths per gap.
        </p>
      )}
    </main>
  );
}

function SkillsTable({ rows, empty }: { rows: SkillDemand[]; empty: string }) {
  if (rows.length === 0) return <p className="font-display italic text-ink/50">{empty}</p>;
  return (
    <div className="border border-ink/10">
      <div className="grid grid-cols-[2fr_auto_3fr_1fr] gap-4 px-4 py-2 border-b border-ink/10 font-mono text-[10px] uppercase tracking-wider text-ink/60">
        <span>Skill</span>
        <span>Demand</span>
        <span>Sample companies / adjacency</span>
        <span>Yours?</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.skill}
          className="grid grid-cols-[2fr_auto_3fr_1fr] gap-4 px-4 py-3 border-b border-ink/5 last:border-b-0 text-sm"
        >
          <span className="font-display">{r.skill}</span>
          <span className="font-mono text-[12px] tabular-nums">{r.demandCount}</span>
          <span className="text-ink/70">
            {r.sampleCompanies.slice(0, 5).join(", ")}
            {r.adjacencyNote ? (
              <span className="block text-[12px] italic text-ink/55 mt-0.5">{r.adjacencyNote}</span>
            ) : null}
          </span>
          <span className="font-mono text-[11px]">
            {r.userHasIt ? <span className="text-ink/80">yes</span> : <span className="text-accent">no</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-5">
      {children}
    </h2>
  );
}

function Breadcrumbs({ current }: { current: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
        <Link href="/advisor" className="hover:text-ink">
          Advisor
        </Link>{" "}
        / {current}
      </p>
      <nav className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/50 flex gap-4">
        <Link href="/" className="hover:text-ink">CV Workshop</Link>
        <Link href="/applications" className="hover:text-ink">Applications</Link>
      </nav>
    </div>
  );
}
