"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useAdvisor } from "@/lib/advisor/store";
import { formatRelative } from "@/lib/advisor/ui";
import type { PacingSnapshot } from "@/lib/advisor/types";
import { useApplications } from "@/lib/app/store";
import { computePacing } from "@/lib/advisor/pacing";

// /advisor — index. Four cards (narrative / skills / ceiling / decisions) +
// inline pacing banner computed live from application history. This page
// never auto-generates: it only reads the latest persisted artifacts so
// load is fast. Each card's "generate / regenerate" button lives on the
// detail page.

export default function AdvisorIndexPage() {
  const advisor = useAdvisor();
  const apps = useApplications();

  useEffect(() => {
    advisor.load();
    apps.load();
  }, [advisor, apps]);

  const livePacing = useMemo<PacingSnapshot | null>(() => {
    if (!apps.loaded) return null;
    return computePacing({ applications: apps.applications });
  }, [apps.applications, apps.loaded]);

  // Persist the live pacing snapshot so /applications can pick up the same
  // guidance text without recomputing. Cheap write; only when changed.
  useEffect(() => {
    if (!livePacing) return;
    const prev = advisor.pacing;
    if (
      prev &&
      prev.last7Days === livePacing.last7Days &&
      prev.last30Days === livePacing.last30Days &&
      prev.sprintDetected === livePacing.sprintDetected &&
      prev.guidance === livePacing.guidance
    ) {
      return;
    }
    advisor.setPacing(livePacing);
  }, [livePacing, advisor]);

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
      <header className="mb-10">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            Advisor
          </p>
          <nav aria-label="Primary" className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 flex gap-4">
            <Link href="/" className="hover:text-ink">
              CV Workshop
            </Link>
            <Link href="/applications" className="hover:text-ink">
              Applications
            </Link>
            <Link href="/applications/review" className="hover:text-ink">
              Review
            </Link>
          </nav>
        </div>
        <h1 className="font-display text-5xl mt-3">
          The longer <em>arc.</em>
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 mt-3">
          Not single-application tools — trajectory tools.
        </p>
      </header>

      {livePacing && livePacing.sprintDetected ? (
        <PacingBanner snapshot={livePacing} />
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-8">
        <AdvisorCard
          href="/advisor/narrative"
          label="Narrative"
          title="Career narrative"
          blurb="The story your CV is telling — often unintentionally — plus alternatives you could credibly lean into."
          preview={advisor.narrative?.currentStoryDetected}
          generatedAt={advisor.narrative?.generatedAt}
        />
        <AdvisorCard
          href="/advisor/skills"
          label="Skills"
          title="Skill gap"
          blurb="Skills demanded across your target roles vs. what's in your profile, with concrete acquisition paths."
          preview={
            advisor.skills
              ? `${advisor.skills.criticalGaps.length} critical gap${
                  advisor.skills.criticalGaps.length === 1 ? "" : "s"
                }, ${advisor.skills.analyzedPostingCount} postings analyzed.`
              : undefined
          }
          generatedAt={advisor.skills?.generatedAt}
        />
        <AdvisorCard
          href="/advisor/ceiling"
          label="Ceiling"
          title="Strategic ceiling"
          blurb="Target roles clustered into stretch / in-range / below — with a ready-to-stretch verdict."
          preview={
            advisor.ceiling
              ? `${advisor.ceiling.classifications.length} role${
                  advisor.ceiling.classifications.length === 1 ? "" : "s"
                } classified · ${
                  advisor.ceiling.readyForStretch
                    ? "ready to stretch"
                    : "not yet ready to stretch"
                }`
              : undefined
          }
          generatedAt={advisor.ceiling?.generatedAt}
        />
        <AdvisorCard
          href="/advisor/decisions"
          label="Decisions"
          title="Decision support"
          blurb="Three focused helpers — offer evaluation, stay vs. go, pivot — returning an honest written analysis."
          preview={
            advisor.decisions.length > 0
              ? `${advisor.decisions.length} analysis${
                  advisor.decisions.length === 1 ? "" : "es"
                } on file. Latest: ${advisor.decisions[0].recommendation}`
              : undefined
          }
          generatedAt={advisor.decisions[0]?.generatedAt}
        />
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-4">
          Pacing
        </h2>
        {livePacing ? (
          <div className="border border-ink/10 p-5">
            <PacingBlock snapshot={livePacing} />
          </div>
        ) : (
          <p className="font-display italic text-ink/50">Loading…</p>
        )}
      </section>
    </main>
  );
}

// ———————————————————————————————————————————————
// Card
// ———————————————————————————————————————————————

function AdvisorCard({
  href,
  label,
  title,
  blurb,
  preview,
  generatedAt,
}: {
  href: string;
  label: string;
  title: string;
  blurb: string;
  preview?: string;
  generatedAt?: number;
}) {
  return (
    <Link
      href={href}
      className="group border border-ink/10 p-5 flex flex-col gap-3 hover:border-ink/30 transition-colors"
    >
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50">
          {label}
        </p>
        <p className="font-mono text-[10px] text-ink/40">
          {generatedAt ? formatRelative(generatedAt) : "never generated"}
        </p>
      </div>
      <h3 className="font-display text-3xl leading-none">{title}</h3>
      <p className="text-sm text-ink/70 leading-snug">{blurb}</p>
      {preview ? (
        <p className="text-[13px] italic text-ink/60 border-l-2 border-ink/10 pl-3 line-clamp-3">
          {preview}
        </p>
      ) : (
        <p className="text-[13px] italic text-ink/35 border-l-2 border-ink/5 pl-3">
          Not generated yet.
        </p>
      )}
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60 mt-auto group-hover:text-ink">
        Open →
      </p>
    </Link>
  );
}

// ———————————————————————————————————————————————
// Pacing
// ———————————————————————————————————————————————

function PacingBanner({ snapshot }: { snapshot: PacingSnapshot }) {
  return (
    <div className="border-l-2 border-accent/60 bg-accent/[0.04] px-5 py-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent mb-1">
        Sprint detected
      </p>
      <p className="text-sm text-ink/85 leading-snug">{snapshot.guidance}</p>
    </div>
  );
}

function PacingBlock({ snapshot }: { snapshot: PacingSnapshot }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-6 mb-4">
        <PacingStat label="Last 7 days" value={String(snapshot.last7Days)} />
        <PacingStat label="Last 30 days" value={String(snapshot.last30Days)} />
        <PacingStat
          label="Sustainable / week"
          value={String(snapshot.sustainablePerWeek)}
        />
      </div>
      <p className="text-sm text-ink/80 leading-snug">{snapshot.guidance}</p>
    </div>
  );
}

function PacingStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-1">
        {label}
      </p>
      <p className="font-display text-3xl">{value}</p>
    </div>
  );
}
