"use client";

import { useEditor } from "@/lib/doc/store";
import type { AlignKind } from "@/lib/doc/store";

// Contextual bar that appears above the selection when one or more nodes
// are selected. Single selection aligns against the page; 2+ against the
// selection's bounding box. Distribute needs 3+.

const BUTTONS: { kind: AlignKind; label: string; title: string }[] = [
  { kind: "left", label: "⇤", title: "Align left" },
  { kind: "center-h", label: "↔", title: "Align center (horizontal)" },
  { kind: "right", label: "⇥", title: "Align right" },
  { kind: "top", label: "⇞", title: "Align top" },
  { kind: "middle-v", label: "↕", title: "Align middle (vertical)" },
  { kind: "bottom", label: "⇟", title: "Align bottom" },
];

export function AlignBar() {
  const count = useEditor((s) => s.selectedIds.length);
  const align = useEditor((s) => s.alignNodes);
  const distribute = useEditor((s) => s.distributeNodes);

  if (count === 0) return null;

  return (
    <div
      className="no-print absolute top-3 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-1 px-2 py-1.5 rounded-full"
      data-editor-chrome
      style={{
        background: "var(--color-editor-panel)",
        border: "1px solid var(--color-editor-border)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
    >
      <span
        className="editor-label px-2"
        style={{ color: "var(--color-editor-text-dim)" }}
      >
        {count === 1 ? "align to page" : `${count} selected`}
      </span>
      {BUTTONS.map((b) => (
        <button
          key={b.kind}
          type="button"
          className="editor-btn"
          onClick={() => align(b.kind)}
          title={b.title}
          aria-label={b.title}
        >
          <span aria-hidden="true">{b.label}</span>
        </button>
      ))}
      {count >= 3 && (
        <>
          <div
            className="h-5 w-px mx-1"
            style={{ background: "var(--color-editor-border)" }}
            aria-hidden="true"
          />
          <button
            type="button"
            className="editor-btn"
            onClick={() => distribute("h")}
            title="Distribute horizontally"
            aria-label="Distribute horizontally"
          >
            <span aria-hidden="true">⇔</span> dist
          </button>
          <button
            type="button"
            className="editor-btn"
            onClick={() => distribute("v")}
            title="Distribute vertically"
            aria-label="Distribute vertically"
          >
            <span aria-hidden="true">⇕</span> dist
          </button>
        </>
      )}
    </div>
  );
}
