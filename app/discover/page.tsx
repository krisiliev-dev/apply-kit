"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cvList } from "@/content/cvs";
import { defaultCV } from "@/content/cvs/default";
import { useDiscovery } from "@/lib/discovery/store";
import type {
  JobPosting,
  JobPostingSourceKind,
  ScoredPosting,
} from "@/lib/discovery/types";
import { saveToStorage } from "@/lib/doc/persist";
import { upsertApplication } from "@/lib/app/storage";
import type { Application, ApplyFitCheck, ParsedJob } from "@/lib/app/types";
import { makeVariantSlug, upsertVariant } from "@/lib/jobs/registry";
import { seedFromContent } from "@/lib/jobs/seedFromContent";
import { saveDraftEval, type DraftEvalResult } from "@/lib/evaluation/keywords";
import type { CVContent } from "@/lib/types";
import { FitCheckCard } from "@/components/applications/FitCheckCard";
import { profile as baseProfile } from "@/content/profile";
import { pullInbox, pendingCount } from "@/lib/pairing/client";
import { CapturedPill } from "@/components/pair/CapturedPill";
import { trackedFetch } from "@/lib/ai/tokenLedger";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";

// Discovery-side fit cache — keep results per posting id to avoid respending
// tokens on re-opens. SSR-safe.
const DISCOVERY_FIT_CACHE_KEY = "cv-maker:discovery-fit-cache";

type DiscoveryFitCache = Record<string, ApplyFitCheck>;

function loadFitCache(): DiscoveryFitCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DISCOVERY_FIT_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as DiscoveryFitCache;
  } catch {
    return {};
  }
}

function saveFitCache(cache: DiscoveryFitCache) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISCOVERY_FIT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

type Filter = "all" | "saved" | JobPostingSourceKind;
type Stage = "idle" | "parsing" | "drafting" | "error";

const SOURCE_LABEL: Record<JobPostingSourceKind, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  "hn-hiring": "HN Hiring",
  rss: "RSS",
  linkedin: "LinkedIn",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
};

export default function DiscoverPage() {
  const router = useRouter();
  const loaded = useDiscovery((s) => s.loaded);
  const load = useDiscovery((s) => s.load);
  const prefs = useDiscovery((s) => s.prefs);
  const state = useDiscovery((s) => s.state);
  const ingest = useDiscovery((s) => s.ingest);
  const rescore = useDiscovery((s) => s.rescore);
  const dismiss = useDiscovery((s) => s.dismiss);
  const save = useDiscovery((s) => s.save);
  const markFetched = useDiscovery((s) => s.markFetched);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);
  const [draftStage, setDraftStage] = useState<Stage>("idle");
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [fitModalFor, setFitModalFor] = useState<ScoredPosting | null>(null);
  const [fitCache, setFitCache] = useState<DiscoveryFitCache>({});

  useEffect(() => {
    setFitCache(loadFitCache());
  }, []);

  const saveFitResult = useCallback((postingId: string, fit: ApplyFitCheck) => {
    setFitCache((prev) => {
      const next = { ...prev, [postingId]: fit };
      saveFitCache(next);
      return next;
    });
  }, []);

  const parseForFit = useCallback(
    async (p: ScoredPosting): Promise<ParsedJob | null> => {
      const body =
        p.description && p.description.length > 60
          ? { text: p.description, url: p.url }
          : { url: p.url };
      try {
        const res = await trackedFetch("/api/jobs/parse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return null;
        return data.job as ParsedJob;
      } catch {
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loaded) rescore(cvList);
    // Run once per reload to adopt the latest CV content for scoring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Pair-inbox pull. On mount, and when the captured-pill is clicked, drain
  // the server-side pair inbox (paired extensions) + the legacy buffer
  // (unpaired extensions) and merge into the local DiscoveryState. This
  // replaces the old mount-time buffer flush.
  const drainPairInbox = useCallback(async () => {
    if (!loaded) return;
    try {
      const postings = await pullInbox();
      if (postings.length > 0) {
        ingest(postings, cvList);
        setFetchInfo(
          `Pulled ${postings.length} capture${postings.length === 1 ? "" : "s"} from the extension.`,
        );
      }
    } catch {
      // transient — the pill will retry
    }
  }, [loaded, ingest]);

  useEffect(() => {
    if (loaded) void drainPairInbox();
  }, [loaded, drainPairInbox]);

  // Hash-triggered pull: the CapturedPill in the header navigates to
  // "#pull"; treat that as a manual drain request.
  useEffect(() => {
    function onHash() {
      if (typeof window !== "undefined" && window.location.hash === "#pull") {
        void drainPairInbox();
        // Clear the hash so repeat clicks still fire.
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [drainPairInbox]);

  // Opportunistic background refresh: if the count goes positive while the
  // user is sitting on /discover, pull automatically so captures appear
  // without a manual click.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const n = await pendingCount();
        if (!cancelled && n > 0) await drainPairInbox();
      } catch {
        // ignore
      }
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loaded, drainPairInbox]);

  const postings = useMemo(() => {
    if (!loaded) return [];
    const all = Object.values(state.postings).filter((p) => !p.hardReject);
    let list = all;
    if (filter === "saved") {
      list = list.filter((p) => state.saved[p.id]);
    } else if (filter !== "all") {
      list = list.filter((p) => p.source.kind === filter);
    } else {
      list = list.filter((p) => !state.dismissed[p.id]);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.company.toLowerCase().includes(q) ||
          (p.location ?? "").toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => b.score - a.score);
  }, [loaded, state.postings, state.saved, state.dismissed, filter, search]);

  const availableSourceKinds = useMemo(() => {
    const set = new Set<JobPostingSourceKind>();
    for (const p of Object.values(state.postings)) set.add(p.source.kind);
    return set;
  }, [state.postings]);

  const watchlistConfigured =
    prefs.watchlist.greenhouse.length +
      prefs.watchlist.lever.length +
      prefs.watchlist.ashby.length +
      prefs.rssFeeds.length +
      (prefs.trackHnHiring ? 1 : 0) >
    0;

  async function handleRefresh() {
    setRefreshing(true);
    setFetchError(null);
    setFetchInfo(null);
    try {
      const res = await trackedFetch("/api/discover/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefs }),
      });
      const data = (await res.json()) as {
        postings?: JobPosting[];
        errors?: Array<{ sourceKey: string; message: string }>;
        cacheHits?: string[];
        sourceKeys?: string[];
        error?: string;
      };
      if (!res.ok || data.error) {
        setFetchError(data.error ?? `Fetch failed (${res.status})`);
        return;
      }
      const postings = data.postings ?? [];
      ingest(postings, cvList);
      for (const key of data.sourceKeys ?? []) markFetched(key);
      const freshCount = postings.length;
      const errCount = data.errors?.length ?? 0;
      const hitCount = data.cacheHits?.length ?? 0;
      setFetchInfo(
        `Loaded ${freshCount} posting${freshCount === 1 ? "" : "s"}` +
          (hitCount > 0 ? ` · ${hitCount} cached` : "") +
          (errCount > 0 ? ` · ${errCount} source error${errCount === 1 ? "" : "s"}` : ""),
      );
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Network error during fetch.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDraft(p: ScoredPosting) {
    if (draftStage !== "idle") return;
    setDraftingId(p.id);
    setDraftStage("parsing");
    try {
      const parsed = await parseToJob(p);
      if (!parsed) {
        setDraftStage("error");
        setFetchError(
          "Could not parse this posting — open it and paste the description manually.",
        );
        setDraftingId(null);
        setDraftStage("idle");
        return;
      }
      setDraftStage("drafting");
      const res = await trackedFetch("/api/jobs/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job: parsed, baseCv: defaultCV }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDraftStage("error");
        setFetchError(data?.error ?? "Failed to draft tailored CV.");
        setDraftingId(null);
        setDraftStage("idle");
        return;
      }
      const tailored = data.cv as CVContent & { tailoringNotes?: string[] };
      const draftEval = data.eval as DraftEvalResult | undefined;

      const slug = makeVariantSlug(parsed.company, parsed.title);
      const variantContent: CVContent = {
        slug,
        targetRole: tailored.targetRole,
        profile: tailored.profile,
        experiences: tailored.experiences,
        education: tailored.education,
        skills: tailored.skills,
        interests: tailored.interests,
      };
      const doc = seedFromContent(slug, variantContent);
      saveToStorage(doc);
      upsertVariant({
        slug,
        targetRole: variantContent.targetRole,
        company: parsed.company,
        createdAt: Date.now(),
        source: "job",
      });

      const appId = nanoid(10);
      const application: Application = {
        id: appId,
        company: parsed.company,
        role: parsed.title,
        url: parsed.sourceUrl,
        jobDescriptionRaw: p.description,
        jobData: parsed,
        cvSlug: slug,
        dateCreated: Date.now(),
        status: "draft",
        events: [
          {
            at: Date.now(),
            kind: "draft-created",
            note: tailored.tailoringNotes?.join(" · "),
          },
        ],
      };
      upsertApplication(application);
      if (draftEval) saveDraftEval(appId, draftEval);

      save(p.id); // mark the posting as saved so we don't redraft on accident
      router.push(`/cv/${slug}?appId=${appId}`);
    } catch (err) {
      setDraftStage("error");
      setFetchError(
        err instanceof Error ? err.message : "Failed to draft tailored CV.",
      );
      setDraftingId(null);
      setDraftStage("idle");
    }
  }

  async function parseToJob(p: ScoredPosting): Promise<ParsedJob | null> {
    // Prefer the posting's description (already plain). Fall back to URL,
    // which makes /api/jobs/parse fetch the page itself.
    const body =
      p.description && p.description.length > 60
        ? { text: p.description, url: p.url }
        : { url: p.url };
    try {
      const res = await trackedFetch("/api/jobs/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return null;
      return data.job as ParsedJob;
    } catch {
      return null;
    }
  }

  const dismissedCount = Object.keys(state.dismissed ?? {}).length;
  const savedCount = Object.keys(state.saved ?? {}).length;

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <header className="mb-10">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            Discover
          </p>
          <div className="flex items-center gap-3">
            {/* On /discover the pill routes clicks to a local pull rather
                than navigating, so the user stays on the page. */}
            <CapturedPill href="#pull" />
            <nav className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/50 flex gap-4">
              <Link href="/" className="hover:text-ink">
                Home
              </Link>
              <Link href="/applications" className="hover:text-ink">
                Applications
              </Link>
              <Link href="/jobs" className="hover:text-ink">
                Jobs
              </Link>
              <Link href="/pair" className="hover:text-ink">
                Pair
              </Link>
              <Link href="/discover/preferences" className="hover:text-ink">
                Preferences
              </Link>
            </nav>
          </div>
        </div>
        <h1 className="font-display text-5xl mt-2">
          Roles worth <em>your time.</em>
        </h1>
        <p className="mt-4 text-ink/70 max-w-prose">
          Ranked against your CVs. Greenhouse, Lever, Ashby, HN &ldquo;Who is
          hiring&rdquo;, RSS, and anything the extension captures. No paid
          aggregators. No scraping.
        </p>
      </header>

      <section className="mb-8">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || !watchlistConfigured}
            className="border border-ink bg-ink text-paper px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] hover:bg-transparent hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {refreshing ? "Refreshing…" : "Refresh all sources"}
          </button>
          {!watchlistConfigured && (
            <Link
              href="/discover/preferences"
              className="font-mono text-xs text-ink/60 underline underline-offset-4 hover:text-ink"
            >
              set up your watchlist →
            </Link>
          )}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search title / company / location"
            className="ml-auto border border-ink/20 bg-paper px-3 py-2 font-mono text-xs text-ink placeholder:text-ink/40 focus:outline-none focus:border-ink w-64"
          />
        </div>
        {fetchInfo && (
          <p className="font-mono text-[11px] text-ink/60 mt-3">{fetchInfo}</p>
        )}
        {fetchError && (
          <div className="mt-3">
            <ApiKeyHint error={fetchError} inline />
          </div>
        )}
      </section>

      <section className="mb-6 flex flex-wrap items-center gap-2">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All · {postings.length}
        </FilterChip>
        <FilterChip
          active={filter === "saved"}
          onClick={() => setFilter("saved")}
        >
          Saved · {savedCount}
        </FilterChip>
        {(
          [
            "greenhouse",
            "lever",
            "ashby",
            "hn-hiring",
            "rss",
            "linkedin",
            "indeed",
            "glassdoor",
          ] as JobPostingSourceKind[]
        ).map((k) => {
          if (!availableSourceKinds.has(k)) return null;
          return (
            <FilterChip
              key={k}
              active={filter === k}
              onClick={() => setFilter(k)}
            >
              {SOURCE_LABEL[k]}
            </FilterChip>
          );
        })}
        {dismissedCount > 0 && (
          <span className="font-mono text-[10px] text-ink/40 ml-auto">
            {dismissedCount} dismissed
          </span>
        )}
      </section>

      {loaded && postings.length === 0 ? (
        <EmptyState watchlistConfigured={watchlistConfigured} />
      ) : (
        <ul className="divide-y divide-ink/10 border-y border-ink/10">
          {postings.map((p) => (
            <li key={p.id}>
              <PostingRow
                posting={p}
                saved={Boolean(state.saved[p.id])}
                drafting={draftingId === p.id}
                busy={draftStage !== "idle"}
                hasFit={Boolean(fitCache[p.id])}
                onDraft={() => handleDraft(p)}
                onSave={() => save(p.id)}
                onDismiss={() => dismiss(p.id)}
                onCheckFit={() => setFitModalFor(p)}
              />
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-16 font-mono text-[11px] text-ink/50 space-y-1">
        <p>
          <Link href="/" className="underline underline-offset-4">
            ← back to CVs
          </Link>
        </p>
      </footer>

      {fitModalFor && (
        <FitCheckModal
          posting={fitModalFor}
          cached={fitCache[fitModalFor.id]}
          parseJob={parseForFit}
          onResult={(fit) => saveFitResult(fitModalFor.id, fit)}
          onClose={() => setFitModalFor(null)}
        />
      )}
    </main>
  );
}

// ———————————————————————————————————————————————
// Fit-check modal
// ———————————————————————————————————————————————

function FitCheckModal({
  posting,
  cached,
  parseJob,
  onResult,
  onClose,
}: {
  posting: ScoredPosting;
  cached?: ApplyFitCheck;
  parseJob: (p: ScoredPosting) => Promise<ParsedJob | null>;
  onResult: (fit: ApplyFitCheck) => void;
  onClose: () => void;
}) {
  const [parsed, setParsed] = useState<ParsedJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    (async () => {
      const job = await parseJob(posting);
      if (cancelled) return;
      if (!job) {
        setError("Could not parse this posting.");
        setBusy(false);
        return;
      }
      setParsed(job);
      setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [posting, parseJob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-ink/40 z-50 flex items-start justify-center overflow-y-auto p-6"
      onClick={onClose}
    >
      <div
        className="bg-paper max-w-2xl w-full border border-ink/20 p-6 my-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-4 gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 truncate">
              {posting.company}
            </p>
            <h3 className="font-display text-2xl truncate">{posting.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 hover:text-ink shrink-0"
          >
            Close
          </button>
        </div>
        {busy && !parsed && (
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">
            Parsing posting…
          </p>
        )}
        {error && <p className="font-mono text-[11px] text-accent">{error}</p>}
        {parsed && (
          <FitCheckCard
            inputs={{
              parsedJob: parsed,
              baseCV: defaultCV,
              profile: baseProfile,
            }}
            cached={cached}
            onResult={onResult}
          />
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] border rounded-full transition-colors ${
        active
          ? "bg-ink text-paper border-ink"
          : "border-ink/20 text-ink/60 hover:text-ink hover:border-ink/40"
      }`}
    >
      {children}
    </button>
  );
}

function PostingRow({
  posting,
  saved,
  drafting,
  busy,
  hasFit,
  onDraft,
  onSave,
  onDismiss,
  onCheckFit,
}: {
  posting: ScoredPosting;
  saved: boolean;
  drafting: boolean;
  busy: boolean;
  hasFit: boolean;
  onDraft: () => void;
  onSave: () => void;
  onDismiss: () => void;
  onCheckFit: () => void;
}) {
  const score100 = Math.round(posting.score * 100);
  const why = posting.why.join(" · ");
  return (
    <div className="py-5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <a
              href={posting.url}
              target="_blank"
              rel="noreferrer"
              className="font-display text-2xl hover:opacity-70 truncate"
            >
              {posting.title}
            </a>
            <SourceBadge kind={posting.source.kind} />
          </div>
          <p className="mt-1 font-mono text-xs text-ink/70">
            <span className="text-ink">{posting.company}</span>
            {posting.location && <span> · {posting.location}</span>}
            {posting.salary && <span> · {posting.salary}</span>}
            {posting.postedAt && (
              <span> · {relativeTime(posting.postedAt)}</span>
            )}
          </p>
          <p
            className="mt-2 font-mono text-[11px] text-ink/60 line-clamp-2"
            title={why}
          >
            {why}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div
            className="font-display text-3xl leading-none text-ink/80"
            title={`score ${score100}/100`}
          >
            {score100}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40 mt-1">
            match
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onDraft}
          disabled={busy}
          className="border border-ink bg-ink text-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-transparent hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {drafting ? "Drafting…" : "Draft application"}
        </button>
        <button
          type="button"
          onClick={onCheckFit}
          disabled={busy}
          className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            hasFit
              ? "bg-accent/10 text-accent border-accent/30"
              : "border-ink/30 text-ink/70 hover:border-ink hover:text-ink"
          }`}
        >
          {hasFit ? "Fit ✓" : "Check fit"}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
            saved
              ? "bg-paper text-ink border-ink"
              : "border-ink/30 text-ink/70 hover:border-ink hover:text-ink"
          }`}
        >
          {saved ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="border border-ink/20 text-ink/50 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] hover:text-ink hover:border-ink/40 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function SourceBadge({ kind }: { kind: JobPostingSourceKind }) {
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink/60 border border-ink/20 rounded px-1.5 py-0.5">
      {SOURCE_LABEL[kind]}
    </span>
  );
}

function EmptyState({ watchlistConfigured }: { watchlistConfigured: boolean }) {
  return (
    <div className="border border-dashed border-ink/20 rounded-lg p-10 text-center">
      <p className="font-display text-2xl text-ink/70">Nothing here yet.</p>
      <p className="mt-3 text-ink/60 max-w-md mx-auto">
        {watchlistConfigured
          ? "Hit refresh to pull fresh postings from your watchlist."
          : "Add a few company slugs and RSS feeds to your preferences, then come back to refresh."}
      </p>
      <div className="mt-5">
        <Link
          href="/discover/preferences"
          className="font-mono text-xs uppercase tracking-[0.2em] border border-ink px-4 py-2 hover:bg-ink hover:text-paper transition-colors"
        >
          Configure preferences →
        </Link>
      </div>
    </div>
  );
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const day = 1000 * 60 * 60 * 24;
  if (diff < day) return "today";
  const days = Math.floor(diff / day);
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}
