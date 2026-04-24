"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { cvs, cvList } from "@/content/cvs";
import { seedFromContent } from "@/lib/jobs/seedFromContent";
import { loadFromStorage } from "@/lib/doc/persist";
import { listVariants } from "@/lib/jobs/registry";
import { readHistory } from "@/lib/evaluation/history";
import { compareDocs, statsFor, type CompareItem, type CompareSummary, type DocStats } from "@/lib/doc/compare";
import type { CvDocument, Node, TextNode, TextStyle, Theme } from "@/lib/doc/types";

// ————————————————————————————————————————————————
// /cv/compare?a=<slug>&b=<slug>
//
// Read-only side-by-side renderer. PageView/NodeView from the editor couple
// to the zustand store (selection, edit state) and would pollute a shared
// session if we rendered two of them at once — so we have a tiny local
// `ReadOnlyPage` that just draws nodes.
// ————————————————————————————————————————————————

const DEFAULT_PREVIEW_ZOOM = 0.4;
const MIN_PREVIEW_ZOOM = 0.2;
const MAX_PREVIEW_ZOOM = 1;

function ComparePageInner() {
  const sp = useSearchParams();
  const router = useRouter();

  const a = sp.get("a") ?? "";
  const b = sp.get("b") ?? "";

  const [allSlugs, setAllSlugs] = useState<string[]>([]);

  useEffect(() => {
    const set = new Set<string>();
    for (const slug of Object.keys(cvs)) set.add(slug);
    for (const v of listVariants()) set.add(v.slug);
    if (typeof window !== "undefined") {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("cv-maker:doc:")) {
            set.add(key.slice("cv-maker:doc:".length));
          }
        }
      } catch {
        // ignore
      }
    }
    setAllSlugs(Array.from(set).sort());
  }, []);

  const update = (which: "a" | "b", slug: string) => {
    const params = new URLSearchParams(sp.toString());
    if (slug) params.set(which, slug);
    else params.delete(which);
    router.replace(`/cv/compare?${params.toString()}`);
  };

  if (!a || !b) {
    return (
      <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
        <header className="mb-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            <Link href="/" className="hover:text-ink">
              CV Workshop
            </Link>{" "}
            / Compare
          </p>
          <h1 className="font-display text-5xl mt-3">
            Two variants, <em>side by side.</em>
          </h1>
          <p className="mt-4 text-ink/70 max-w-prose">
            Pick variant A and variant B. You&rsquo;ll see each page at 40%, a
            quick stats block, and which nodes are unique to each or shared.
          </p>
        </header>

        <section className="grid grid-cols-2 gap-6 mb-10">
          <SlugPicker
            label="Variant A"
            value={a}
            slugs={allSlugs}
            onChange={(v) => update("a", v)}
          />
          <SlugPicker
            label="Variant B"
            value={b}
            slugs={allSlugs}
            onChange={(v) => update("b", v)}
          />
        </section>

        {allSlugs.length < 2 && (
          <div className="border border-dashed border-ink/20 p-8 text-center">
            <p className="font-display text-2xl text-ink/70">
              Not enough variants yet.
            </p>
            <p className="mt-3 text-ink/60 max-w-md mx-auto">
              Compare needs at least two CV variants. Populate the demo on the
              home page or draft one from a job posting.
            </p>
            <Link
              href="/"
              className="inline-block mt-5 font-mono text-[11px] uppercase tracking-[0.2em] border border-ink px-4 py-2 hover:bg-ink hover:text-paper transition-colors"
            >
              Back to home →
            </Link>
          </div>
        )}
      </main>
    );
  }

  return <CompareBoard aSlug={a} bSlug={b} allSlugs={allSlugs} onChange={update} />;
}

export default function ComparePage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <ComparePageInner />
    </Suspense>
  );
}

function SlugPicker({
  label,
  value,
  slugs,
  onChange,
}: {
  label: string;
  value: string;
  slugs: string[];
  onChange: (slug: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 block mb-2">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-ink/20 bg-paper px-3 py-2 font-mono text-sm text-ink focus:outline-none focus:border-ink"
      >
        <option value="">— pick a variant —</option>
        {slugs.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompareBoard({
  aSlug,
  bSlug,
  allSlugs,
  onChange,
}: {
  aSlug: string;
  bSlug: string;
  allSlugs: string[];
  onChange: (which: "a" | "b", slug: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [docA, setDocA] = useState<CvDocument | null>(null);
  const [docB, setDocB] = useState<CvDocument | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_PREVIEW_ZOOM);

  // Resolve each slug the same way the editor does on first load:
  // localStorage first, then typed seed, finally blank.
  useEffect(() => {
    setDocA(resolveDoc(aSlug));
    setDocB(resolveDoc(bSlug));
    setLoaded(true);
  }, [aSlug, bSlug]);

  const summary = useMemo<CompareSummary | null>(() => {
    if (!docA || !docB) return null;
    return compareDocs(docA, docB);
  }, [docA, docB]);

  const statsA = docA ? statsFor(docA) : null;
  const statsB = docB ? statsFor(docB) : null;

  return (
    <main className="min-h-screen max-w-[1400px] mx-auto px-6 py-12">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          <Link href="/" className="hover:text-ink">
            CV Workshop
          </Link>{" "}
          / Compare
        </p>
        <nav className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/50 flex gap-4">
          <Link href="/" className="hover:text-ink">
            Home
          </Link>
          <Link href="/applications" className="hover:text-ink">
            Applications
          </Link>
        </nav>
      </header>

      <section className="grid grid-cols-[1fr_auto_1fr] gap-6 mb-6 items-end">
        <div>
          <SlugPicker
            label="Variant A"
            value={aSlug}
            slugs={allSlugs}
            onChange={(v) => onChange("a", v)}
          />
        </div>
        <div className="pb-1 font-mono text-[10px] uppercase tracking-[0.25em] text-ink/40">
          vs.
        </div>
        <div>
          <SlugPicker
            label="Variant B"
            value={bSlug}
            slugs={allSlugs}
            onChange={(v) => onChange("b", v)}
          />
        </div>
      </section>

      <section className="flex items-center gap-4 mb-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50">
          Zoom
        </span>
        <input
          type="range"
          min={MIN_PREVIEW_ZOOM * 100}
          max={MAX_PREVIEW_ZOOM * 100}
          step={5}
          value={Math.round(zoom * 100)}
          onChange={(e) => setZoom(Number(e.target.value) / 100)}
          className="flex-1 max-w-xs"
          aria-label="Preview zoom"
        />
        <span className="font-mono text-[11px] tabular-nums text-ink/70 w-10">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom(DEFAULT_PREVIEW_ZOOM)}
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 hover:text-ink"
        >
          reset
        </button>
      </section>

      <section className="grid grid-cols-[1fr_280px_1fr] gap-6 items-start">
        <PreviewColumn slug={aSlug} doc={docA} stats={statsA} loaded={loaded} zoom={zoom} />

        <div className="min-w-0">
          {summary ? (
            <DiffColumn summary={summary} />
          ) : (
            <p className="font-mono text-xs text-ink/50">
              Loading diff…
            </p>
          )}
        </div>

        <PreviewColumn slug={bSlug} doc={docB} stats={statsB} loaded={loaded} zoom={zoom} />
      </section>

      <footer className="mt-16 font-mono text-[11px] text-ink/50">
        <Link href="/" className="underline underline-offset-4">
          ← back to home
        </Link>
      </footer>
    </main>
  );
}

function resolveDoc(slug: string): CvDocument | null {
  if (!slug) return null;
  // Client-only: safe because CompareBoard runs this inside useEffect.
  const saved = loadFromStorage(slug);
  if (saved) return saved;
  const typed = cvs[slug];
  if (typed) return seedFromContent(slug, typed);
  return null;
}

function PreviewColumn({
  slug,
  doc,
  stats,
  loaded,
  zoom,
}: {
  slug: string;
  doc: CvDocument | null;
  stats: DocStats | null;
  loaded: boolean;
  zoom: number;
}) {
  // Latest score for this slug from history.
  const [lastScore, setLastScore] = useState<number | null>(null);
  useEffect(() => {
    if (!slug) return setLastScore(null);
    const hist = readHistory(slug);
    setLastScore(hist.length > 0 ? hist[hist.length - 1].overall : null);
  }, [slug]);

  if (!loaded) {
    return <div className="font-mono text-xs text-ink/50">Loading…</div>;
  }

  if (!doc) {
    return (
      <div className="border border-dashed border-ink/20 p-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60">
          {slug || "(no variant)"}
        </p>
        <p className="mt-3 text-ink/60 text-sm">
          This variant hasn&rsquo;t been opened yet — nothing to preview.
        </p>
        {slug && (
          <Link
            href={`/cv/${slug}`}
            className="inline-block mt-4 font-mono text-[10px] uppercase tracking-[0.2em] border border-ink/30 px-3 py-1.5 hover:border-ink hover:text-ink"
          >
            Seed it in the editor →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 truncate">
          {slug}
        </p>
        <Link
          href={`/cv/${slug}`}
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50 hover:text-ink"
        >
          Edit →
        </Link>
      </div>
      <div
        className="border border-ink/10 mx-auto overflow-auto"
        style={{ background: doc.theme.colors.paper, maxHeight: "80vh" }}
      >
        <ReadOnlyPage doc={doc} zoom={zoom} />
      </div>
      {stats && (
        <dl className="mt-3 grid grid-cols-3 gap-3 font-mono text-[10px] uppercase tracking-[0.15em] text-ink/60">
          <Stat label="Nodes" value={stats.totalNodes} />
          <Stat label="Words" value={stats.wordCount} />
          <Stat label="Score" value={lastScore !== null ? `${lastScore}/100` : "—"} />
        </dl>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-ink/50">{label}</dt>
      <dd className="text-ink text-sm font-display mt-0.5">{value}</dd>
    </div>
  );
}

function DiffColumn({ summary }: { summary: CompareSummary }) {
  return (
    <div className="sticky top-6">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 mb-3">
        Diff summary
      </h2>
      <dl className="grid grid-cols-3 gap-2 mb-6 font-mono text-[10px] uppercase tracking-[0.15em] text-ink/60">
        <Stat label="Only A" value={summary.counts.onlyA} />
        <Stat label="Shared" value={summary.counts.shared} />
        <Stat label="Only B" value={summary.counts.onlyB} />
      </dl>

      <DiffGroup title="Only in A" items={summary.onlyInA} accent="#d64933" />
      <DiffGroup title="Only in B" items={summary.onlyInB} accent="#2e8b57" />
      <DiffGroup title="Shared" items={summary.shared} accent="#777" />
    </div>
  );
}

function DiffGroup({
  title,
  items,
  accent,
}: {
  title: string;
  items: CompareItem[];
  accent: string;
}) {
  // Group by label for a compact overview.
  const groups = new Map<string, CompareItem[]>();
  for (const it of items) {
    if (!groups.has(it.label)) groups.set(it.label, []);
    groups.get(it.label)!.push(it);
  }

  return (
    <details className="mb-3 border-t border-ink/10 pt-2" open={items.length > 0 && items.length <= 12}>
      <summary
        className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.15em] flex items-baseline justify-between"
        style={{ color: accent }}
      >
        <span>{title}</span>
        <span className="text-ink/50">{items.length}</span>
      </summary>
      {items.length === 0 ? (
        <p className="mt-2 font-mono text-[10px] text-ink/40">None.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {Array.from(groups.entries()).map(([label, list]) => (
            <li key={label}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
                {label} · {list.length}
              </p>
              <ul className="mt-1 space-y-0.5">
                {list.slice(0, 8).map((it) => (
                  <li
                    key={it.key}
                    className="text-[11px] text-ink/75 pl-3 border-l border-ink/10 truncate"
                    title={it.preview}
                  >
                    {it.preview || "—"}
                  </li>
                ))}
                {list.length > 8 && (
                  <li className="text-[10px] text-ink/40 pl-3">
                    +{list.length - 8} more
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

// ————————————————————————————————————————————————
// Read-only page renderer (no store coupling)
// ————————————————————————————————————————————————

function ReadOnlyPage({ doc, zoom }: { doc: CvDocument; zoom: number }) {
  const page = doc.pages[0];
  if (!page) return null;
  return (
    <div
      style={{
        width: `${page.width * zoom}mm`,
        height: `${page.height * zoom}mm`,
        position: "relative",
        overflow: "hidden",
        transform: `scale(${zoom})`,
        transformOrigin: "top left",
        // Shrink the outer box back so layout doesn't leak.
        marginBottom: `-${page.height * (1 - zoom)}mm`,
        marginRight: `-${page.width * (1 - zoom)}mm`,
      }}
    >
      <div
        style={{
          width: `${page.width}mm`,
          height: `${page.height}mm`,
          position: "relative",
          background: page.background ?? doc.theme.colors.paper,
          color: doc.theme.colors.ink,
        }}
      >
        {[...page.nodes]
          .sort((a, b) => a.z - b.z)
          .map((n) => (
            <ReadOnlyNode key={n.id} node={n} theme={doc.theme} />
          ))}
      </div>
    </div>
  );
}

function resolveFont(style: TextStyle, theme: Theme): string {
  if (style.fontFamily) return style.fontFamily;
  const token = style.fontToken ?? "sans";
  return theme.fonts[token];
}

function ReadOnlyNode({ node, theme }: { node: Node; theme: Theme }) {
  if (node.hidden) return null;
  const box: CSSProperties = {
    position: "absolute",
    left: `${node.x}mm`,
    top: `${node.y}mm`,
    width: `${node.w}mm`,
    height: `${node.h}mm`,
    zIndex: node.z,
    opacity: node.opacity,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: "center center",
  };

  if (node.type === "text") {
    return (
      <div
        style={{
          ...box,
          fontFamily: resolveFont((node as TextNode).style, theme),
          fontSize: `${(node as TextNode).style.fontSize}px`,
          fontWeight: (node as TextNode).style.fontWeight,
          fontStyle: (node as TextNode).style.italic ? "italic" : "normal",
          color: (node as TextNode).style.color,
          lineHeight: (node as TextNode).style.lineHeight,
          letterSpacing:
            (node as TextNode).style.letterSpacing !== undefined
              ? `${(node as TextNode).style.letterSpacing}em`
              : undefined,
          textTransform: (node as TextNode).style.textTransform,
          textAlign: (node as TextNode).style.textAlign,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {(node as TextNode).content}
      </div>
    );
  }

  if (node.type === "image") {
    return node.src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={node.src}
        alt={node.alt ?? ""}
        draggable={false}
        style={{
          ...box,
          objectFit: node.objectFit ?? "cover",
          borderRadius: node.borderRadius ? `${node.borderRadius}px` : undefined,
        }}
      />
    ) : (
      <div style={{ ...box, background: "#eee" }} />
    );
  }

  if (node.type === "shape") {
    if (node.shape === "line") {
      return <div style={{ ...box, background: node.stroke ?? "#111" }} />;
    }
    return (
      <div
        style={{
          ...box,
          background: node.fill,
          border: node.stroke
            ? `${node.strokeWidth ?? 1}px solid ${node.stroke}`
            : undefined,
        }}
      />
    );
  }

  return null;
}
