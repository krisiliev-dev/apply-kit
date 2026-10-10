"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { pendingCount } from "@/lib/pairing/client";

// Small pill showing "N jobs captured — review →". Polls
// /api/pair/pending-count every 20s while the tab is visible, so any page
// that mounts this component surfaces extension captures without the user
// having /discover open.
//
// Design notes:
//   * Polling is intentionally visibility-gated so we don't hammer the dev
//     server from a background tab.
//   * The pill hides entirely when there's nothing to show — it must not
//     add visual clutter when quiet.

const POLL_INTERVAL_MS = 20_000;

export function CapturedPill({
  className,
  href = "/discover",
}: {
  className?: string;
  href?: string;
}) {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const n = await pendingCount();
        if (!cancelled) setCount(n);
      } catch {
        // transient — leave previous value
      }
    }

    function start() {
      stop();
      void tick();
      timerRef.current = setInterval(() => void tick(), POLL_INTERVAL_MS);
    }
    function stop() {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);

  if (count <= 0) return null;

  return (
    <Link
      href={href}
      className={
        className ??
        "font-mono text-[11px] uppercase tracking-[0.2em] border border-accent/40 text-accent px-3 py-1 hover:bg-accent hover:text-paper transition-colors"
      }
    >
      {count} captured · review →
    </Link>
  );
}
