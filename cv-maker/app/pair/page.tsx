"use client";

import Link from "next/link";
import { AppNav } from "@/components/nav/AppNav";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  beginPairing,
  listDevices,
  pollPairStatus,
  revokeDevice,
  type PairBeginResponse,
} from "@/lib/pairing/client";
import type { DeviceSummary } from "@/lib/pairing/types";

// /pair — web-app UI for pairing the Chrome extension.
//
// Flow:
//   1. "Start pairing" → POST /api/pair/begin → show code + QR.
//   2. Poll /api/pair/begin/status every 2s.
//   3. On `bound`, flash success, refresh the device list, idle.
//   4. If the user leaves idle for >10m, the code expires; they can mint
//      another one.

type PairState =
  | { kind: "idle" }
  | {
      kind: "active";
      code: string;
      expiresAt: number;
      qr: string;
    }
  | { kind: "bound"; deviceId: string }
  | { kind: "expired" }
  | { kind: "error"; message: string };

export default function PairPage() {
  const [state, setState] = useState<PairState>({ kind: "idle" });
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const d = await listDevices();
      setDevices(d);
    } catch {
      // keep previous list on transient error
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback(
    (code: string, expiresAt: number) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        if (Date.now() > expiresAt) {
          stopPolling();
          setState({ kind: "expired" });
          return;
        }
        try {
          const status = await pollPairStatus(code);
          if (status.status === "bound") {
            stopPolling();
            setState({
              kind: "bound",
              deviceId: status.boundDeviceId ?? "unknown",
            });
            void refreshDevices();
          } else if (status.status === "expired") {
            stopPolling();
            setState({ kind: "expired" });
          }
        } catch {
          // transient — keep polling
        }
      }, 2000);
    },
    [refreshDevices, stopPolling],
  );

  const handleStart = useCallback(async () => {
    try {
      const res: PairBeginResponse = await beginPairing();
      // Encode a pair:// URL-ish payload so a QR scan from the extension
      // popup (if we ever support it) can one-shot. For now it's the code
      // alongside the origin so the human can read both.
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const qrText = `${origin}|${res.code}`;
      const qr = await QRCode.toDataURL(qrText, { margin: 1, scale: 6 });
      setState({
        kind: "active",
        code: res.code,
        expiresAt: res.expiresAt,
        qr,
      });
      startPolling(res.code, res.expiresAt);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [startPolling]);

  const handleRevoke = useCallback(
    async (deviceId: string) => {
      const confirmed = window.confirm(
        "Revoke this device? The extension will stop syncing until re-paired.",
      );
      if (!confirmed) return;
      try {
        await revokeDevice(deviceId);
        await refreshDevices();
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : "Failed to revoke device.",
        );
      }
    },
    [refreshDevices],
  );

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <AppNav />
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Pair extension
        </p>
        <h1 className="font-display text-5xl mt-2 tracking-tight">
          Pair a <em>device.</em>
        </h1>
        <p className="mt-4 text-ink/70 max-w-prose">
          The Chrome extension captures job postings on LinkedIn, Indeed, and
          Glassdoor. Pair it once to sync captures in the background — no tab
          needs to be open.
        </p>
      </header>

      <section className="mb-12">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-4">
          Pair a new device
        </h2>

        {state.kind === "idle" && (
          <div className="border border-ink/20 p-6">
            <p className="text-ink/70 max-w-prose mb-4">
              Click start, then open the extension popup → <em>Pair</em> tab,
              paste the code and this web-app URL.
            </p>
            <button
              type="button"
              onClick={() => void handleStart()}
              className="border border-ink bg-ink text-paper px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] hover:bg-transparent hover:text-ink transition-colors"
            >
              Start pairing
            </button>
          </div>
        )}

        {state.kind === "active" && (
          <ActivePairing
            code={state.code}
            expiresAt={state.expiresAt}
            qr={state.qr}
            origin={origin}
            onCancel={() => {
              stopPolling();
              setState({ kind: "idle" });
            }}
          />
        )}

        {state.kind === "bound" && (
          <div className="border border-ink/40 bg-ink/5 p-6">
            <p className="font-display text-2xl">Paired.</p>
            <p className="mt-2 text-ink/70">
              Device{" "}
              <span className="font-mono text-xs">
                …{state.deviceId.slice(-6)}
              </span>{" "}
              is now syncing captures in the background.
            </p>
            <button
              type="button"
              onClick={() => setState({ kind: "idle" })}
              className="mt-4 font-mono text-xs uppercase tracking-[0.2em] border border-ink px-3 py-1 hover:bg-ink hover:text-paper transition-colors"
            >
              Pair another
            </button>
          </div>
        )}

        {state.kind === "expired" && (
          <div className="border border-ink/20 p-6">
            <p className="font-display text-2xl">Code expired.</p>
            <p className="mt-2 text-ink/70">
              Codes are valid for 10 minutes. Generate a new one.
            </p>
            <button
              type="button"
              onClick={() => void handleStart()}
              className="mt-4 border border-ink bg-ink text-paper px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] hover:bg-transparent hover:text-ink transition-colors"
            >
              Generate new code
            </button>
          </div>
        )}

        {state.kind === "error" && (
          <div className="border border-accent/40 bg-accent/5 p-6">
            <p className="font-mono text-[11px] text-accent">
              Error: {state.message}
            </p>
            <button
              type="button"
              onClick={() => setState({ kind: "idle" })}
              className="mt-4 font-mono text-xs uppercase tracking-[0.2em] border border-ink px-3 py-1"
            >
              Dismiss
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-4">
          Paired devices
        </h2>
        {devicesLoading ? (
          <p className="font-mono text-[11px] text-ink/40">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="font-mono text-[11px] text-ink/40">
            No devices paired yet.
          </p>
        ) : (
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {devices.map((d) => (
              <li
                key={d.deviceId}
                className="py-4 flex items-baseline justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xl">{d.deviceLabel}</div>
                  <div className="font-mono text-[11px] text-ink/50 mt-1">
                    …{d.deviceId.slice(-6)} · paired{" "}
                    {relative(d.pairedAt)} · last seen{" "}
                    {relative(d.lastSeenAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(d.deviceId)}
                  className="border border-ink/30 text-ink/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] hover:text-ink hover:border-ink transition-colors shrink-0"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-16 font-mono text-[11px] text-ink/50">
        <p>
          <Link href="/discover" className="underline underline-offset-4">
            → captured postings live in Discover
          </Link>
        </p>
      </footer>
    </main>
  );
}

function ActivePairing({
  code,
  expiresAt,
  qr,
  origin,
  onCancel,
}: {
  code: string;
  expiresAt: number;
  qr: string;
  origin: string;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mm = Math.floor(remaining / 60)
    .toString()
    .padStart(1, "0");
  const ss = (remaining % 60).toString().padStart(2, "0");

  return (
    <div className="border border-ink/30 p-6">
      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/50">
            Pair code · expires in {mm}:{ss}
          </p>
          <p className="mt-2 font-display text-3xl tracking-wider break-all select-all">
            {code}
          </p>

          <div className="mt-6 space-y-2 text-sm text-ink/70">
            <p>
              <span className="font-mono text-[11px] text-ink/50">1 →</span>{" "}
              Open the extension popup.
            </p>
            <p>
              <span className="font-mono text-[11px] text-ink/50">2 →</span>{" "}
              Switch to the <em>Pair</em> tab.
            </p>
            <p>
              <span className="font-mono text-[11px] text-ink/50">3 →</span>{" "}
              Paste the web-app URL:{" "}
              <code className="font-mono text-xs bg-ink/5 px-1 py-0.5 rounded">
                {origin}
              </code>
            </p>
            <p>
              <span className="font-mono text-[11px] text-ink/50">4 →</span>{" "}
              Paste the pair code above and click <em>Pair</em>.
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
          >
            Cancel
          </button>
        </div>

        <div className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt="QR code with pairing payload"
            width={168}
            height={168}
            className="border border-ink/10"
          />
          <p className="font-mono text-[10px] text-ink/40 mt-2 text-center">
            QR · optional
          </p>
        </div>
      </div>
    </div>
  );
}

function relative(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
