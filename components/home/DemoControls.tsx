"use client";

import { useCallback, useEffect, useState } from "react";
import { cvList } from "@/content/cvs";
import { saveToStorage } from "@/lib/doc/persist";
import { seedFromContent } from "@/lib/jobs/seedFromContent";
import { saveAllToStorage } from "@/lib/app/persist";
import { APPLICATIONS_STORAGE_KEY } from "@/lib/app/types";
import { buildDemoApplications } from "@/lib/app/demoSeed";

// Home-screen utilities: populates or clears the demo. Kept as a small client
// island so the home page itself can stay server-rendered.
//
// "Populated" = localStorage holds either the applications bucket or any
// per-slug CV document saved under `cv-maker:doc:*`.

const CV_DOC_KEY_PREFIX = "cv-maker:doc:";
const HINT_DISMISSED_KEY = "cv-maker:home-hint-dismissed";

type Mode = "loading" | "empty" | "populated";

function detectMode(): Mode {
  if (typeof window === "undefined") return "loading";
  try {
    if (localStorage.getItem(APPLICATIONS_STORAGE_KEY)) return "populated";
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CV_DOC_KEY_PREFIX)) return "populated";
    }
    return "empty";
  } catch {
    return "empty";
  }
}

function clearAllDemoKeys() {
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("cv-maker:")) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function populate() {
  // 1. Seed a CvDocument per variant so /cv/<slug> opens with the typed
  //    content pre-rendered to nodes (instead of the slug-blank seed path).
  for (const cv of cvList) {
    const doc = seedFromContent(cv.slug, cv);
    saveToStorage(doc);
  }
  // 2. Seed the applications tracker.
  saveAllToStorage(buildDemoApplications());
}

// ——— Shared state hook ———

function useDemoState() {
  const [mode, setMode] = useState<Mode>("loading");
  const [hintDismissed, setHintDismissed] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(detectMode());
    try {
      setHintDismissed(
        localStorage.getItem(HINT_DISMISSED_KEY) === "1",
      );
    } catch {
      setHintDismissed(false);
    }
  }, []);

  const dismissHint = useCallback(() => {
    setHintDismissed(true);
    try {
      localStorage.setItem(HINT_DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  const onPopulate = useCallback(() => {
    setBusy(true);
    try {
      populate();
      dismissHint();
    } finally {
      window.location.reload();
    }
  }, [dismissHint]);

  const onClear = useCallback(() => {
    const ok = window.confirm(
      "Clear the demo? This wipes every cv-maker:* entry in localStorage, including any edits you've made.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      clearAllDemoKeys();
    } finally {
      window.location.reload();
    }
  }, []);

  return { mode, hintDismissed, busy, dismissHint, onPopulate, onClear };
}

// ——— Hint (rendered above the variants list on first run) ———

export function DemoHint() {
  const { mode, hintDismissed, onPopulate, dismissHint } = useDemoState();

  if (mode !== "empty" || hintDismissed) return null;

  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink/60 mb-3">
      New here? Tap{" "}
      <button
        type="button"
        onClick={onPopulate}
        className="underline decoration-ink/30 underline-offset-4 hover:text-ink font-semibold"
      >
        Populate demo
      </button>{" "}
      to see what a filled workshop looks like.
      <button
        type="button"
        onClick={dismissHint}
        className="ml-3 text-ink/40 hover:text-ink/70 underline decoration-ink/20 underline-offset-4"
        aria-label="Dismiss hint"
      >
        dismiss
      </button>
    </p>
  );
}

// ——— Controls (rendered in footer) ———

export function DemoControls() {
  const { mode, busy, onPopulate, onClear } = useDemoState();

  if (mode === "loading") {
    return <div className="h-6" aria-hidden />;
  }

  return (
    <div className="flex items-center gap-3">
      {mode === "empty" ? (
        <button
          type="button"
          onClick={onPopulate}
          disabled={busy}
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70 border border-ink/20 px-3 py-2 hover:text-ink hover:border-ink/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Populating…" : "Populate demo"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 border border-ink/15 px-3 py-2 hover:text-ink/80 hover:border-ink/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Clearing…" : "Clear demo"}
        </button>
      )}
      <span className="font-mono text-[10px] text-ink/40">
        {mode === "empty"
          ? "seeds 3 CV variants + 8 sample applications"
          : "wipes every cv-maker:* localStorage key"}
      </span>
    </div>
  );
}
