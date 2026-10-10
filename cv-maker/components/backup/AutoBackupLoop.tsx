"use client";

import { useEffect } from "react";
import { useSettings } from "@/lib/settings/store";
import {
  checkBackupStatus,
  runAutoBackup,
} from "@/lib/settings/autoBackup";

// Mounted once from app/layout.tsx. Owns a single setInterval that fires per
// the configured interval; each tick re-checks `backup.autoBackupEnabled` so
// toggling the setting elsewhere takes effect without re-mounting.
//
// Runs nothing on the server (the effect is client-only by React contract).
// If FSA isn't supported or no folder is chosen, ticks are silent no-ops.

export function AutoBackupLoop() {
  const loaded = useSettings((s) => s.loaded);
  const load = useSettings((s) => s.load);
  const autoBackupEnabled = useSettings((s) => s.backup.autoBackupEnabled);
  const intervalMinutes = useSettings((s) => s.backup.autoBackupIntervalMinutes);
  const setBackup = useSettings((s) => s.setBackup);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!loaded) return;
    if (!autoBackupEnabled) return;

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        const status = await checkBackupStatus();
        if (status.kind !== "ready") return;
        const ts = await runAutoBackup();
        if (ts && !cancelled) {
          setBackup({ lastBackupAt: ts });
        }
      } catch (err) {
        console.warn("[auto-backup] tick failed:", err);
      }
    }

    // Fire once shortly after mount — gives a fresh backup when the user
    // opens the app after time away — then on the configured cadence.
    const initial = window.setTimeout(tick, 30_000);
    const minutes = Math.max(5, intervalMinutes);
    const every = window.setInterval(tick, minutes * 60_000);

    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(every);
    };
  }, [loaded, autoBackupEnabled, intervalMinutes, setBackup]);

  return null;
}
