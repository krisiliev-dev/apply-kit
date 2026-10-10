"use client";

import { useEffect } from "react";
import { useSettings } from "@/lib/settings/store";

// Mounted once from app/layout.tsx. While auto-refresh is on, periodically
// runs all discovery sources (ATS/RSS/HN + dev.bg + aggregators) AND the
// email-alert ingestion — i.e. the legitimate, ToS-clean pulls — so the pool
// stays fresh hands-off while the app is open. Each tick re-reads the toggle
// so changing it elsewhere takes effect without re-mount. No-op on the server.
//
// For always-on refresh (even with the app closed), a system cron can hit the
// same two endpoints — see docs/email-alerts.md.
export function DiscoveryAutoRefresh() {
  const loaded = useSettings((s) => s.loaded);
  const load = useSettings((s) => s.load);
  const enabled = useSettings((s) => s.discovery.autoRefreshEnabled);
  const intervalMinutes = useSettings((s) => s.discovery.autoRefreshIntervalMinutes);
  const setDiscovery = useSettings((s) => s.setDiscovery);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!loaded || !enabled) return;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        // Crawl registered sources, then ingest job-alert emails. email-sync
        // returns 400 when Gmail isn't configured — harmless, swallowed.
        await fetch("/api/discover/run", { method: "POST" }).catch(() => {});
        await fetch("/api/discover/email-sync", { method: "POST" }).catch(() => {});
        if (!cancelled) setDiscovery({ lastRefreshAt: Date.now() });
      } catch (err) {
        console.warn("[auto-discover] tick failed:", err);
      }
    }

    // First run a little after mount, then on the configured cadence. Floor at
    // 30 min so we don't hammer the external source APIs.
    const initial = window.setTimeout(tick, 45_000);
    const minutes = Math.max(30, intervalMinutes);
    const every = window.setInterval(tick, minutes * 60_000);

    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(every);
    };
  }, [loaded, enabled, intervalMinutes, setDiscovery]);

  return null;
}
