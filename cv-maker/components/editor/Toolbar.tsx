"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useEditor } from "@/lib/doc/store";
import { useTemporalEditor } from "./useTemporal";
import { defaultTheme } from "@/lib/doc/types";
import { downloadAtsText } from "@/lib/export/atsText";
import { listVariants } from "@/lib/jobs/registry";
import { cvs } from "@/content/cvs";

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [compareAvailable, setCompareAvailable] = useState(false);

  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const showGrid = useEditor((s) => s.showGrid);
  const showGuides = useEditor((s) => s.showGuides);
  const setShowGrid = useEditor((s) => s.setShowGrid);
  const setShowGuides = useEditor((s) => s.setShowGuides);
  const addNode = useEditor((s) => s.addNode);
  const targetRole = useEditor((s) => s.doc.targetRole);
  const setTargetRole = useEditor((s) => s.setTargetRole);

  const { undo, redo, canUndo, canRedo } = useTemporalEditor();

  // Compare link only shows when there are >= 2 known variants.
  useEffect(() => {
    const staticCount = Object.keys(cvs).length;
    const dynamicCount = listVariants().length;
    setCompareAvailable(staticCount + dynamicCount >= 2);
  }, []);

  // Close export menu on outside click.
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (!exportMenuRef.current) return;
      if (!exportMenuRef.current.contains(e.target as globalThis.Node)) {
        setExportOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [exportOpen]);

  const addText = () => {
    addNode({
      type: "text",
      name: "Text",
      x: 30,
      y: 30,
      w: 80,
      h: 10,
      content: "Double-click to edit",
      style: {
        fontToken: "sans",
        fontSize: 14,
        fontWeight: 400,
        color: defaultTheme.colors.ink,
      },
    });
  };

  const addLine = () => {
    addNode({
      type: "shape",
      shape: "line",
      name: "Line",
      x: 30,
      y: 30,
      w: 60,
      h: 0.4,
      stroke: defaultTheme.colors.ink,
      strokeWidth: 0.4,
    });
  };

  const addRect = () => {
    addNode({
      type: "shape",
      shape: "rect",
      name: "Rectangle",
      x: 30,
      y: 30,
      w: 40,
      h: 40,
      fill: defaultTheme.colors.accent,
    });
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      addNode({
        type: "image",
        name: file.name,
        x: 30,
        y: 30,
        w: 40,
        h: 40,
        src,
        objectFit: "cover",
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div
      className="editor-toolbar flex items-center gap-2 px-3 py-2 border-b"
      data-editor-chrome
      style={{
        background: "var(--color-editor-panel)",
        borderColor: "var(--color-editor-border)",
      }}
    >
      <Link
        href="/"
        aria-label="Back to variants"
        className="editor-btn editor-btn-ghost"
        title="Back to variants"
      >
        <span aria-hidden="true">←</span>
      </Link>

      <label htmlFor="toolbar-target-role" className="sr-only">
        Target role
      </label>
      <input
        id="toolbar-target-role"
        value={targetRole}
        onChange={(e) => setTargetRole(e.target.value)}
        className="editor-input"
        style={{ width: 180 }}
        placeholder="Target role"
      />

      <div className="h-5 w-px bg-[var(--color-editor-border)]" aria-hidden="true" />

      <button type="button" className="editor-btn" onClick={addText} title="Add text">
        + text
      </button>
      <button
        type="button"
        className="editor-btn"
        onClick={() => fileInputRef.current?.click()}
        title="Add image"
      >
        + image
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        aria-label="Upload image"
        className="hidden"
      />
      <button type="button" className="editor-btn" onClick={addLine} title="Add line">
        + line
      </button>
      <button type="button" className="editor-btn" onClick={addRect} title="Add rectangle">
        + rect
      </button>

      <div className="h-5 w-px bg-[var(--color-editor-border)]" aria-hidden="true" />

      <button
        type="button"
        className="editor-btn"
        onClick={() => undo()}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        aria-label="Undo"
        style={{ opacity: canUndo ? 1 : 0.4 }}
      >
        <span aria-hidden="true">↶</span>
      </button>
      <button
        type="button"
        className="editor-btn"
        onClick={() => redo()}
        disabled={!canRedo}
        title="Redo (⌘⇧Z)"
        aria-label="Redo"
        style={{ opacity: canRedo ? 1 : 0.4 }}
      >
        <span aria-hidden="true">↷</span>
      </button>

      <div className="h-5 w-px bg-[var(--color-editor-border)]" aria-hidden="true" />

      <button
        type="button"
        className="editor-btn"
        data-active={showGuides}
        aria-pressed={showGuides}
        onClick={() => setShowGuides(!showGuides)}
        title="Toggle snap guides"
      >
        guides
      </button>
      <button
        type="button"
        className="editor-btn"
        data-active={showGrid}
        aria-pressed={showGrid}
        onClick={() => setShowGrid(!showGrid)}
        title="Toggle design grid"
      >
        grid
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          className="editor-btn editor-btn-ghost"
          onClick={() => setZoom(zoom - 0.1)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <span aria-hidden="true">−</span>
        </button>
        <span className="editor-label w-12 text-center" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="editor-btn editor-btn-ghost"
          onClick={() => setZoom(zoom + 0.1)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          className="editor-btn editor-btn-ghost"
          onClick={() => setZoom(1)}
          title="Reset zoom"
          aria-label="Reset zoom"
        >
          1:1
        </button>
      </div>

      <div className="h-5 w-px bg-[var(--color-editor-border)]" />

      {compareAvailable && (
        <Link
          href="/cv/compare"
          className="editor-btn editor-btn-ghost"
          title="Compare variants side by side"
        >
          compare
        </Link>
      )}

      <div className="relative" ref={exportMenuRef}>
        <button
          type="button"
          className="editor-btn"
          onClick={() => setExportOpen((o) => !o)}
          title="Export this CV"
          aria-haspopup="menu"
          aria-expanded={exportOpen}
        >
          export ▾
        </button>
        {exportOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 py-1 min-w-[180px] z-10"
            style={{
              background: "var(--color-editor-panel)",
              border: "1px solid var(--color-editor-border)",
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-1.5 font-mono text-[11px] hover:bg-[rgba(255,255,255,0.06)]"
              onClick={() => {
                setExportOpen(false);
                window.print();
              }}
            >
              Print / PDF
            </button>
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-1.5 font-mono text-[11px] hover:bg-[rgba(255,255,255,0.06)]"
              onClick={() => {
                setExportOpen(false);
                downloadAtsText(useEditor.getState().doc);
              }}
            >
              Plain text (.txt)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
