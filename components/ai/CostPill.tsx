"use client";

import { useEffect, useState } from "react";
import {
  clearLedger,
  useTokenLedger,
} from "@/lib/ai/tokenLedger";
import { formatTokens, formatUsd } from "@/lib/ai/pricing";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type Settings,
} from "@/lib/settings/types";

// ————————————————————————————————————————————————
// Cost pill — rendered by the root layout. Subtle fixed-position element
// that only surfaces once the current session has an actual cost.
//
// Clicking it opens a modal with the last 20 entries plus a per-feature
// breakdown. We read the Settings object directly from localStorage (same
// key the durability agent's store uses) so there's no shared React state
// required between the two worktrees — the pill is a passive reader.
// ————————————————————————————————————————————————

export function CostPill() {
  const { entries, sessionCost, sessionInput, sessionOutput } = useTokenLedger();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Hydrate from localStorage + subscribe to cross-tab edits so the pill
    // tracks Settings UI changes without a page refresh.
    const read = () => {
      try {
        const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) {
          setSettings(DEFAULT_SETTINGS);
          return;
        }
        const parsed = JSON.parse(raw) as Settings;
        if (parsed?.ui && parsed?.models && parsed?.backup) {
          setSettings(parsed);
        }
      } catch {
        setSettings(DEFAULT_SETTINGS);
      }
    };
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_STORAGE_KEY) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!settings.ui.showCostPill) return null;
  if (sessionCost <= 0 && entries.length === 0) return null;

  const total = sessionInput + sessionOutput;
  const label = `${formatUsd(sessionCost)} · ${formatTokens(total)}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Session AI cost: ${label}. Click for breakdown.`}
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 40,
          padding: "4px 10px",
          borderRadius: 999,
          fontSize: 11,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          background: "rgba(17, 24, 39, 0.82)",
          color: "#e5e7eb",
          border: "1px solid rgba(255,255,255,0.08)",
          cursor: "pointer",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        {label}
      </button>
      {open ? (
        <CostBreakdown
          entries={entries}
          onClose={() => setOpen(false)}
          onClear={() => {
            clearLedger();
            setOpen(false);
          }}
          sessionCost={sessionCost}
          sessionInput={sessionInput}
          sessionOutput={sessionOutput}
        />
      ) : null}
    </>
  );
}

type BreakdownProps = {
  entries: ReturnType<typeof useTokenLedger>["entries"];
  sessionCost: number;
  sessionInput: number;
  sessionOutput: number;
  onClose: () => void;
  onClear: () => void;
};

function CostBreakdown({
  entries,
  sessionCost,
  sessionInput,
  sessionOutput,
  onClose,
  onClear,
}: BreakdownProps) {
  const recent = entries.slice(-20).reverse();
  const byFeature = new Map<
    string,
    { count: number; input: number; output: number; cost: number }
  >();
  for (const e of entries) {
    const key = `${e.feature} · ${e.provider}:${e.model}`;
    const row = byFeature.get(key) ?? {
      count: 0,
      input: 0,
      output: 0,
      cost: 0,
    };
    row.count += 1;
    row.input += e.inputTokens;
    row.output += e.outputTokens;
    row.cost += e.costUsd;
    byFeature.set(key, row);
  }
  const featureRows = [...byFeature.entries()].sort(
    (a, b) => b[1].cost - a[1].cost,
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-end",
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(480px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          background: "#0b0f19",
          color: "#e5e7eb",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 16,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
          fontSize: 13,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <strong style={{ fontSize: 14 }}>Session AI cost</strong>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              color: "#9ca3af",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <StatBlock label="Cost" value={formatUsd(sessionCost)} />
          <StatBlock label="Input" value={formatTokens(sessionInput)} />
          <StatBlock label="Output" value={formatTokens(sessionOutput)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
            BY FEATURE
          </div>
          {featureRows.length === 0 ? (
            <div style={{ color: "#6b7280" }}>No feature usage yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "#9ca3af", fontSize: 11 }}>
                  <th style={{ textAlign: "left", padding: "2px 4px" }}>
                    Feature · Model
                  </th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>×</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {featureRows.map(([key, row]) => (
                  <tr key={key} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "4px", color: "#d1d5db" }}>{key}</td>
                    <td style={{ padding: "4px", textAlign: "right", color: "#9ca3af" }}>
                      {row.count}
                    </td>
                    <td
                      style={{
                        padding: "4px",
                        textAlign: "right",
                        fontFamily: "ui-monospace, monospace",
                      }}
                    >
                      {formatUsd(row.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
            LAST {recent.length} CALLS
          </div>
          {recent.length === 0 ? (
            <div style={{ color: "#6b7280" }}>No calls yet.</div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                fontSize: 12,
              }}
            >
              {recent.map((e, i) => (
                <li
                  key={`${e.at}-${i}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "4px 0",
                    borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <span style={{ color: "#d1d5db" }}>
                    {e.feature} <span style={{ color: "#6b7280" }}>·</span>{" "}
                    {e.provider}:{e.model}
                  </span>
                  <span
                    style={{
                      color: "#9ca3af",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {formatTokens(e.totalTokens)} · {formatUsd(e.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={onClear}
            style={{
              background: "transparent",
              color: "#f87171",
              border: "1px solid rgba(248,113,113,0.35)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Clear ledger
          </button>
          <span style={{ color: "#6b7280", fontSize: 11, alignSelf: "center" }}>
            Ledger caps at 500 entries.
          </span>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 8,
      }}
    >
      <div style={{ color: "#9ca3af", fontSize: 10 }}>{label}</div>
      <div
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 14,
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}
