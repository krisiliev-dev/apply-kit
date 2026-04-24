"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdvisor } from "@/lib/advisor/store";
import { formatRelative } from "@/lib/advisor/ui";
import type { RoleTier, StrategicProfile } from "@/lib/advisor/types";
import { profile } from "@/content/profile";
import { cvList } from "@/content/cvs";
import { useApplications } from "@/lib/app/store";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";
import { trackedFetch } from "@/lib/ai/tokenLedger";

// /advisor/ceiling — detailed. Classifications grouped by tier with a subtle
// color tint per tier. readyForStretch flag shown prominently. Roles come
// from recent applications + any saved discovery postings so the user
// doesn't have to paste a list.

type DiscoveryStateShape = {
  postings?: Record<string, { title: string; company: string; url?: string }>;
  saved?: Record<string, number>;
};

function loadRecentRoleTitles(apps: { role: string; company: string; url?: string }[]) {
  const fromApps = apps.slice(0, 30).map((a) => ({
    title: a.role,
    company: a.company,
    sourceUrl: a.url,
  }));

  if (typeof window === "undefined") return fromApps;
  try {
    const raw = localStorage.getItem("cv-maker:discovery-state");
    if (!raw) return fromApps;
    const parsed = JSON.parse(raw) as DiscoveryStateShape;
    const savedIds = Object.keys(parsed.saved ?? {});
    const fromDiscovery = savedIds
      .map((id) => parsed.postings?.[id])
      .filter(Boolean)
      .slice(0, 30)
      .map((p) => ({ title: p!.title, company: p!.company, sourceUrl: p!.url }));
    return [...fromApps, ...fromDiscovery];
  } catch {
    return fromApps;
  }
}

const TIER_ORDER: RoleTier[] = ["stretch", "in-range", "below", "aspirational"];
const TIER_LABEL: Record<RoleTier, string> = {
  "stretch": "Stretch",
  "in-range": "In range",
  "below": "Below level",
  "aspirational": "Aspirational",
};
const TIER_TINT: Record<RoleTier, string> = {
  "stretch": "border-l-accent/70",
  "in-range": "border-l-ink/40",
  "below": "border-l-ink/15",
  "aspirational": "border-l-ink/25 border-dashed",
};

export default function CeilingPage() {
  const advisor = useAdvisor();
  const apps = useApplications();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    advisor.load();
    apps.load();
  }, [advisor, apps]);

  const onGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const roles = loadRecentRoleTitles(
        apps.applications
          .slice()
          .sort((a, b) => b.dateCreated - a.dateCreated)
          .map((a) => ({ role: a.role, company: a.company, url: a.url })),
      );
      const res = await trackedFetch("/api/advisor/ceiling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile, cvVariants: cvList, roles }),
      });
      const data = (await res.json()) as { profile?: StrategicProfile; error?: string };
      if (!res.ok || !data.profile) {
        setError(data.error ?? "Failed to generate strategic profile.");
        return;
      }
      advisor.setCeiling(data.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [advisor, apps.applications]);

  const ceiling = advisor.ceiling;

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
      <Breadcrumbs current="Ceiling" />

      <h1 className="font-display text-5xl mt-3">
        Stretch, in-range, <em>or below.</em>
      </h1>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 mt-3">
        Cluster recent roles vs. your current profile.
      </p>

      <div className="mt-8 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
        >
          {busy ? "Thinking…" : ceiling ? "Regenerate" : "Generate"}
        </button>
        {ceiling ? (
          <p className="font-mono text-[11px] text-ink/50">
            Last generated {formatRelative(ceiling.generatedAt)} · {ceiling.classifications.length} role
            {ceiling.classifications.length === 1 ? "" : "s"} classified
          </p>
        ) : null}
        {error ? <ApiKeyHint error={error} inline /> : null}
      </div>

      {ceiling ? (
        <div className="mt-12 space-y-12">
          <section className="border-l-2 border-accent/60 pl-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60 mb-2">
              Verdict
            </p>
            <p className="font-display text-2xl italic leading-relaxed">
              {ceiling.readyForStretch ? "Ready for stretch roles." : "Not yet ready for stretch."}
            </p>
          </section>

          {ceiling.inRangeSignals.length > 0 && (
            <section>
              <SectionHeading>In-range signals</SectionHeading>
              <ul className="space-y-1.5 text-sm text-ink/80">
                {ceiling.inRangeSignals.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-ink/35">—</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {ceiling.stretchGapsToClose.length > 0 && (
            <section>
              <SectionHeading>Gaps to close for stretch</SectionHeading>
              <ul className="space-y-1.5 text-sm text-ink/80">
                {ceiling.stretchGapsToClose.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-accent/70">!</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <SectionHeading>Classifications</SectionHeading>
            {TIER_ORDER.map((tier) => {
              const rows = ceiling.classifications.filter((c) => c.tier === tier);
              if (rows.length === 0) return null;
              return (
                <div key={tier} className="mb-8">
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60 mb-3">
                    {TIER_LABEL[tier]} · {rows.length}
                  </p>
                  <ul className="space-y-4">
                    {rows.map((c, i) => (
                      <li key={`${tier}-${i}`} className={`pl-4 border-l-2 ${TIER_TINT[tier]}`}>
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="font-display text-lg">
                            {c.title}
                            {c.company ? <span className="text-ink/50"> · {c.company}</span> : null}
                          </span>
                          {c.sourceUrl ? (
                            <a
                              href={c.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-[10px] uppercase tracking-wider text-ink/50 hover:text-ink"
                            >
                              source ↗
                            </a>
                          ) : null}
                        </div>
                        <p className="text-sm text-ink/75 mt-1 leading-relaxed">{c.reasoning}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        </div>
      ) : (
        <p className="mt-12 font-display italic text-ink/50">
          Generate a strategic profile — it clusters your recent application
          targets (plus saved discovery postings) into stretch / in-range /
          below / aspirational and tells you honestly whether you&apos;re ready
          to stretch yet.
        </p>
      )}
    </main>
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
        <Link href="/advisor" className="hover:text-ink">Advisor</Link> / {current}
      </p>
      <nav className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/50 flex gap-4">
        <Link href="/" className="hover:text-ink">CV Workshop</Link>
        <Link href="/applications" className="hover:text-ink">Applications</Link>
      </nav>
    </div>
  );
}
