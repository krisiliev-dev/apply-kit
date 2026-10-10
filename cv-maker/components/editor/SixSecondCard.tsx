"use client";

import { useState } from "react";
import type { SixSecondReport } from "@/lib/evaluation/types";

// Collapsed card showing the key findings of the 6-second skim. Mirrors the
// visual idiom of the rest of EvalPanel (mono dim labels, tight rows).
export function SixSecondCard({ report }: { report: SixSecondReport }) {
  const [open, setOpen] = useState(true);

  if (report.unavailable) {
    return (
      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          6-second skim
        </h3>
        <p className="font-mono text-[11px] text-[var(--color-editor-text-dim)] leading-snug">
          {report.unavailableReason ?? "unavailable"}
        </p>
      </section>
    );
  }

  const color =
    report.scannabilityScore >= 80
      ? "#4ec16d"
      : report.scannabilityScore >= 60
        ? "#d6a63d"
        : "#d64933";

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-editor-text-dim)]">
          6-second skim
        </h3>
        <button
          type="button"
          className="font-mono text-[10px] text-[var(--color-editor-text-dim)] hover:text-[var(--color-editor-text)]"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "collapse" : "expand"}
        </button>
      </div>

      <div className="mt-1 flex items-baseline gap-3">
        <span
          className="font-display text-2xl tabular-nums"
          style={{ color }}
        >
          {report.scannabilityScore}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-editor-text-dim)]">
          scannability
        </span>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          <Row label="Read as" value={report.nameRead ?? "—"} />
          <Row label="Role" value={report.currentRoleRead ?? "—"} />
          <Row
            label="Seniority"
            value={report.seniorityImpression ?? "unclear"}
          />
          <Row label="Signal" value={report.strongestSignal} />
          <Row label="Sticks" value={report.oneThingRemembered} />

          {report.misreadings.length > 0 && (
            <div className="pt-1 border-t" style={{ borderColor: "var(--color-editor-border)" }}>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-editor-text-dim)]">
                Misreadings
              </div>
              <ul className="mt-1 space-y-1">
                {report.misreadings.map((m, i) => (
                  <li
                    key={i}
                    className="font-mono text-[11px] leading-snug text-[var(--color-editor-text)]"
                  >
                    <span className="mr-1" style={{ color: "#d64933" }}>
                      ⚠
                    </span>
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.warnings.length > 0 && (
            <div className="pt-1 border-t" style={{ borderColor: "var(--color-editor-border)" }}>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-editor-text-dim)]">
                Fix
              </div>
              <ul className="mt-1 space-y-1">
                {report.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="font-mono text-[11px] leading-snug text-[var(--color-editor-text)]"
                  >
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="font-mono text-[11px] leading-snug">
      <span className="text-[var(--color-editor-text-dim)] uppercase tracking-[0.15em] mr-2 text-[10px]">
        {label}
      </span>
      <span className="text-[var(--color-editor-text)]">{value}</span>
    </div>
  );
}
