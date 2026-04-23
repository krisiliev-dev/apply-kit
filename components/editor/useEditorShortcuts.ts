"use client";

import { useEffect } from "react";
import { useEditor } from "@/lib/doc/store";

// Keyboard shortcuts for the editor.
// Guarded so they don't fire while the user is typing into text fields.

const isTypingTarget = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
};

export function useEditorShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const store = useEditor.getState();
      const { selectedIds } = store;
      const mod = e.metaKey || e.ctrlKey;

      // Undo / Redo
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useEditor.temporal.getState().redo();
        else useEditor.temporal.getState().undo();
        return;
      }

      // Duplicate
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        store.duplicateNodes();
        return;
      }

      // Delete
      if ((e.key === "Backspace" || e.key === "Delete") && selectedIds.length > 0) {
        e.preventDefault();
        store.deleteNodes();
        return;
      }

      // Deselect
      if (e.key === "Escape") {
        store.deselect();
        return;
      }

      // Arrow nudge
      if (e.key.startsWith("Arrow") && selectedIds.length > 0) {
        const step = e.shiftKey ? 10 : 1; // mm
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowLeft") dx = -step;
        if (e.key === "ArrowRight") dx = step;
        if (e.key === "ArrowUp") dy = -step;
        if (e.key === "ArrowDown") dy = step;
        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          store.nudgeNodes(dx, dy);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
