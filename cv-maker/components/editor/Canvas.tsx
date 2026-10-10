"use client";

import { useEffect, useRef } from "react";
import { useEditor } from "@/lib/doc/store";
import { PageView } from "./PageView";

// Scrollable, zoomable canvas viewport.
// - Pinch/wheel with ⌘ or Ctrl zooms (web-standard gesture).
// - Click on empty canvas area deselects.
export function Canvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const deselect = useEditor((s) => s.deselect);

  const page = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];

  // Wheel + modifier → zoom. Uses passive: false so we can preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.005;
        setZoom(useEditor.getState().zoom * (1 + delta));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  return (
    <div
      ref={containerRef}
      className="editor-canvas relative h-full w-full overflow-auto"
      style={{
        background: "var(--color-editor-bg)",
        padding: "48px 48px",
      }}
      onMouseDown={(e) => {
        // Clicks on the canvas background (not on a page/node) deselect.
        if (e.target === containerRef.current) deselect();
      }}
    >
      <div
        className="mx-auto"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top center",
          width: "fit-content",
          transition: "transform 120ms ease-out",
        }}
      >
        <PageView page={page} theme={doc.theme} />
      </div>
    </div>
  );
}
