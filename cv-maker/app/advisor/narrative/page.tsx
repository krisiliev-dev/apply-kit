"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdvisor } from "@/lib/advisor/store";
import { formatRelative } from "@/lib/advisor/ui";
import type { CareerNarrative, NarrativeFraming } from "@/lib/advisor/types";
import { getBaseProfile } from "@/lib/profile/base";
import { cvList } from "@/content/cvs";
import { useApplications } from "@/lib/app/store";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";
import { trackedFetch } from "@/lib/ai/tokenLedger";

// /advisor/narrative — detailed.
// Shows currentStoryDetected, then each framing as a card with evidence +
// risks. "Use as profile summary" button copies the framing text to the
// clipboard (the editor doc store is off-limits to this feature).

export default function NarrativePage() {
  const advisor = useAdvisor();
  const apps = useApplications();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    advisor.load();
    apps.load();
  }, [advisor, apps]);

  const onGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await trackedFetch("/api/advisor/narrative", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: getBaseProfile(),
          cvVariants: cvList,
          recentApplications: apps.applications
            .slice()
            .sort((a, b) => b.dateCreated - a.dateCreated)
            .slice(0, 40),
        }),
      });
      const data = (await res.json()) as {
        narrative?: CareerNarrative;
        error?: string;
      };
      if (!res.ok || !data.narrative) {
        setError(data.error ?? "Failed to generate narrative.");
        return;
      }
      advisor.setNarrative(data.narrative);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [apps.applications, advisor]);

  const onCopy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore — not all environments expose clipboard
    }
  }, []);

  const narrative = advisor.narrative;

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
      <Breadcrumbs current="Narrative" />

      <h1 className="font-display text-5xl mt-3">
        The story your CV is <em>telling.</em>
      </h1>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 mt-3">
        Often unintentionally — here's the read, plus alternatives.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
        >
          {busy
            ? "Thinking…"
            : narrative
            ? "Regenerate"
            : "Generate narrative"}
        </button>
        {narrative ? (
          <p className="font-mono text-[11px] text-ink/50">
            Last generated {formatRelative(narrative.generatedAt)}.
          </p>
        ) : null}
        {error ? <ApiKeyHint error={error} inline /> : null}
      </div>

      {narrative ? (
        <div className="mt-12 space-y-12">
          <section>
            <SectionHeading>Current story detected</SectionHeading>
            <div className="border-l-2 border-accent/50 pl-5">
              <p className="font-display text-xl italic text-ink/85 leading-relaxed">
                {narrative.currentStoryDetected}
              </p>
            </div>
          </section>

          {narrative.framings.length === 0 ? (
            <section>
              <SectionHeading>Alternative framings</SectionHeading>
              <p className="font-display italic text-ink/50">
                No alternatives proposed yet. Add more CV content or apply to
                a few roles and regenerate.
              </p>
            </section>
          ) : (
            <section>
              <SectionHeading>Alternative framings</SectionHeading>
              <div className="space-y-6">
                {narrative.framings.map((f) => (
                  <FramingCard
                    key={f.id}
                    framing={f}
                    copied={copiedId === f.id}
                    onCopy={() => onCopy(f.id, f.summary)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <p className="mt-12 font-display italic text-ink/50">
          Generate a narrative read — it will analyze your profile, CV variants,
          and recent applications to infer the story you're telling and propose
          2–3 alternatives you could credibly lean into.
        </p>
      )}
    </main>
  );
}

function FramingCard({
  framing,
  copied,
  onCopy,
}: {
  framing: NarrativeFraming;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <article className="border border-ink/10 p-6">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h3 className="font-display text-2xl">{framing.title}</h3>
        <button
          type="button"
          onClick={onCopy}
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink border border-ink/15 px-2 py-1"
        >
          {copied ? "Copied" : "Use as profile summary"}
        </button>
      </div>
      <p className="text-ink/85 leading-relaxed mb-5">{framing.summary}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
            Evidence from history
          </p>
          <ul className="space-y-1.5 text-sm text-ink/80">
            {framing.evidenceFromHistory.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-ink/35">—</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
            Risks
          </p>
          <ul className="space-y-1.5 text-sm text-ink/80">
            {framing.risks.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent/70">!</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
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
      <nav aria-label="Primary" className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 flex gap-4">
        <Link href="/" className="hover:text-ink">
          CV Workshop
        </Link>
        <Link href="/applications" className="hover:text-ink">
          Applications
        </Link>
      </nav>
    </div>
  );
}
