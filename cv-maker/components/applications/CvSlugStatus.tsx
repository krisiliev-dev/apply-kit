"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadFromStorage } from "@/lib/doc/persist";
import { cvs } from "@/content/cvs";

// Explains when a referenced CV slug has no saved document yet:
// - `saved`   → the editor has persisted it to localStorage; no hint needed
// - `typed`   → a registered typed seed exists but no localStorage doc yet;
//                hint the user to open it to materialise
// - `unknown` → the slug points nowhere; prompt "seed it now?" which opens
//                the editor (creates a blank page there)
//
// Reusable across:
//   /applications/[id]        — next to the "Open CV" link
//   /jobs/[appId]             — before the Draft/Open CV button
//   /applications/review      — variant-performance rows
export function CvSlugStatus({ slug }: { slug: string | undefined }) {
  const [state, setState] = useState<"loading" | "saved" | "typed" | "unknown">(
    "loading",
  );

  useEffect(() => {
    if (!slug) {
      setState("loading");
      return;
    }
    const saved = loadFromStorage(slug);
    if (saved) {
      setState("saved");
      return;
    }
    if (cvs[slug]) {
      setState("typed");
      return;
    }
    setState("unknown");
  }, [slug]);

  if (!slug) return null;
  if (state === "saved") return null;

  if (state === "typed") {
    return (
      <p className="font-mono text-[10px] text-ink/50">
        Typed seed available — click &ldquo;Open CV&rdquo; to materialise it in
        the editor.
      </p>
    );
  }

  if (state === "unknown") {
    return (
      <p className="font-mono text-[10px] text-ink/50">
        This variant was never opened.{" "}
        <Link
          href={`/cv/${slug}`}
          className="underline decoration-ink/30 underline-offset-4 hover:text-ink"
        >
          Seed it now?
        </Link>
      </p>
    );
  }

  return null;
}
