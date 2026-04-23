"use client";

import { useRef } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { useEditor } from "@/lib/doc/store";
import { useTemporalEditor } from "./useTemporal";
import { defaultTheme } from "@/lib/doc/types";

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      <Link href="/" className="editor-btn editor-btn-ghost" title="Back to variants">
        ←
      </Link>

      <input
        value={targetRole}
        onChange={(e) => setTargetRole(e.target.value)}
        className="editor-input"
        style={{ width: 180 }}
        placeholder="Target role"
      />

      <div className="h-5 w-px bg-[var(--color-editor-border)]" />

      <button className="editor-btn" onClick={addText} title="Add text">
        + text
      </button>
      <button
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
        className="hidden"
      />
      <button className="editor-btn" onClick={addLine} title="Add line">
        + line
      </button>
      <button className="editor-btn" onClick={addRect} title="Add rectangle">
        + rect
      </button>

      <div className="h-5 w-px bg-[var(--color-editor-border)]" />

      <button
        className="editor-btn"
        onClick={() => undo()}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        style={{ opacity: canUndo ? 1 : 0.4 }}
      >
        ↶
      </button>
      <button
        className="editor-btn"
        onClick={() => redo()}
        disabled={!canRedo}
        title="Redo (⌘⇧Z)"
        style={{ opacity: canRedo ? 1 : 0.4 }}
      >
        ↷
      </button>

      <div className="h-5 w-px bg-[var(--color-editor-border)]" />

      <button
        className="editor-btn"
        data-active={showGuides}
        onClick={() => setShowGuides(!showGuides)}
        title="Toggle snap guides"
      >
        guides
      </button>
      <button
        className="editor-btn"
        data-active={showGrid}
        onClick={() => setShowGrid(!showGrid)}
        title="Toggle design grid"
      >
        grid
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <button
          className="editor-btn editor-btn-ghost"
          onClick={() => setZoom(zoom - 0.1)}
          title="Zoom out"
        >
          −
        </button>
        <span className="editor-label w-12 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="editor-btn editor-btn-ghost"
          onClick={() => setZoom(zoom + 0.1)}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="editor-btn editor-btn-ghost"
          onClick={() => setZoom(1)}
          title="Reset zoom"
        >
          1:1
        </button>
      </div>

      <div className="h-5 w-px bg-[var(--color-editor-border)]" />

      <button
        className="editor-btn"
        onClick={() => window.print()}
        title="Print or save as PDF"
      >
        print / pdf
      </button>
    </div>
  );
}
