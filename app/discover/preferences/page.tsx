"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDiscovery } from "@/lib/discovery/store";
import type { DiscoveryPreferences } from "@/lib/discovery/types";

// CRUD for the discovery preferences bucket. Kept intentionally plain — a
// stack of list editors, each one "type a value, press add, click × to
// remove". Everything writes straight to localStorage via the store.

export default function PreferencesPage() {
  const loaded = useDiscovery((s) => s.loaded);
  const load = useDiscovery((s) => s.load);
  const prefs = useDiscovery((s) => s.prefs);
  const setPrefs = useDiscovery((s) => s.setPrefs);
  const [draft, setDraft] = useState<DiscoveryPreferences | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loaded) setDraft(prefs);
  }, [loaded, prefs]);

  if (!draft) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
        <p className="font-mono text-xs text-ink/60">Loading…</p>
      </main>
    );
  }

  function commit(patch: Partial<DiscoveryPreferences>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    setPrefs(patch);
  }

  function commitWatchlist(
    kind: "greenhouse" | "lever" | "ashby",
    items: string[],
  ) {
    if (!draft) return;
    const watchlist = { ...draft.watchlist, [kind]: items };
    const next = { ...draft, watchlist };
    setDraft(next);
    setPrefs({ watchlist });
  }

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <header className="mb-10">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            Discover · Preferences
          </p>
          <nav aria-label="Primary" className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 flex gap-4">
            <Link href="/discover" className="hover:text-ink">
              ← Discover
            </Link>
          </nav>
        </div>
        <h1 className="font-display text-5xl mt-2">
          Who&apos;s on your <em>watchlist?</em>
        </h1>
        <p className="mt-4 text-ink/70 max-w-prose">
          Add company slugs for the ATS boards you already know. Drop in RSS
          feeds for anything that exposes one. Everything saves locally.
        </p>
      </header>

      <Section
        title="Greenhouse boards"
        hint="Company slug as it appears in boards.greenhouse.io/<slug>. Example: vercel, airbnb."
      >
        <TokenList
          items={draft.watchlist.greenhouse}
          placeholder="add greenhouse slug"
          onChange={(items) => commitWatchlist("greenhouse", items)}
        />
      </Section>

      <Section
        title="Lever boards"
        hint="Company slug from jobs.lever.co/<slug>. Example: stripe, scale."
      >
        <TokenList
          items={draft.watchlist.lever}
          placeholder="add lever slug"
          onChange={(items) => commitWatchlist("lever", items)}
        />
      </Section>

      <Section
        title="Ashby boards"
        hint="Company slug from jobs.ashbyhq.com/<slug>. Example: linear, ramp."
      >
        <TokenList
          items={draft.watchlist.ashby}
          placeholder="add ashby slug"
          onChange={(items) => commitWatchlist("ashby", items)}
        />
      </Section>

      <Section
        title="RSS feeds"
        hint="Full URL of an Atom/RSS feed from a careers page."
      >
        <TokenList
          items={draft.rssFeeds}
          placeholder="https://example.com/careers.rss"
          onChange={(items) => commit({ rssFeeds: items })}
          validate={(v) => /^https?:\/\//.test(v)}
        />
      </Section>

      <Section
        title="Hacker News &ldquo;Who is hiring&rdquo;"
        hint="Pulls the current monthly thread on refresh."
      >
        <label className="inline-flex items-center gap-2 font-mono text-sm">
          <input
            type="checkbox"
            checked={draft.trackHnHiring}
            onChange={(e) => commit({ trackHnHiring: e.target.checked })}
            className="size-4 accent-ink"
          />
          Include the latest HN hiring thread
        </label>
      </Section>

      <Section
        title="Work authorization"
        hint="Region codes you can work in — US, UK, EU, PT, DE, etc. Leave empty to accept anywhere."
      >
        <TokenList
          items={draft.workAuth}
          placeholder="US"
          onChange={(items) =>
            commit({ workAuth: items.map((s) => s.toUpperCase()) })
          }
        />
      </Section>

      <Section
        title="Preferred locations"
        hint="Soft preference for location keywords (no hard filter)."
      >
        <TokenList
          items={draft.preferredLocations}
          placeholder="Lisbon"
          onChange={(items) => commit({ preferredLocations: items })}
        />
      </Section>

      <Section
        title="Remote-only"
        hint="Hard-rejects postings without a remote location."
      >
        <label className="inline-flex items-center gap-2 font-mono text-sm">
          <input
            type="checkbox"
            checked={Boolean(draft.remoteOnly)}
            onChange={(e) => commit({ remoteOnly: e.target.checked })}
            className="size-4 accent-ink"
          />
          Only show remote roles
        </label>
      </Section>

      <Section
        title="Salary floor"
        hint="Hard-rejects postings that disclose a salary below this (USD-equivalent, annual)."
      >
        <input
          type="number"
          min={0}
          step={1000}
          value={draft.salaryFloor ?? ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            commit({ salaryFloor: v === "" ? undefined : Number(v) });
          }}
          placeholder="e.g. 80000"
          className="border border-ink/20 bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:border-ink w-40"
        />
      </Section>

      <Section
        title="Title denylist"
        hint="Postings whose title contains any of these keywords are hard-rejected."
      >
        <TokenList
          items={draft.titleDenylist}
          placeholder="manager"
          onChange={(items) => commit({ titleDenylist: items })}
        />
      </Section>

      <footer className="mt-16 font-mono text-[11px] text-ink/50 space-y-1">
        <p>Saved automatically.</p>
        <p>
          <Link href="/discover" className="underline underline-offset-4">
            ← back to Discover
          </Link>
        </p>
      </footer>
    </main>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-1">
        {title}
      </h2>
      {hint && <p className="text-sm text-ink/60 mb-3">{hint}</p>}
      {children}
    </section>
  );
}

function TokenList({
  items,
  placeholder,
  onChange,
  validate,
}: {
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
  validate?: (v: string) => boolean;
}) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function add() {
    const v = value.trim();
    if (!v) return;
    if (validate && !validate(v)) {
      setErr("invalid format");
      return;
    }
    if (items.includes(v)) {
      setErr("already added");
      return;
    }
    onChange([...items, v]);
    setValue("");
    setErr(null);
  }

  function remove(v: string) {
    onChange(items.filter((i) => i !== v));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.length === 0 && (
          <span className="font-mono text-xs text-ink/40">— none —</span>
        )}
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-2 border border-ink/20 rounded-full px-3 py-1 font-mono text-xs text-ink/80"
          >
            {item}
            <button
              type="button"
              onClick={() => remove(item)}
              aria-label={`remove ${item}`}
              className="text-ink/40 hover:text-accent transition-colors"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="flex-1 border border-ink/20 bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:border-ink"
        />
        <button
          type="button"
          onClick={add}
          className="border border-ink px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] hover:bg-ink hover:text-paper transition-colors"
        >
          Add
        </button>
      </div>
      {err && <p className="font-mono text-[11px] text-accent mt-2">{err}</p>}
    </div>
  );
}
