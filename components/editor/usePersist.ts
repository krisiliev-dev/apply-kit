"use client";

import { useEffect, useRef } from "react";
import { useEditor } from "@/lib/doc/store";
import { loadFromStorage, saveToStorage } from "@/lib/doc/persist";
import { seedFor } from "@/lib/doc/seed";

// Loads the document for `slug` on mount (from localStorage or seed) and
// writes every change back to localStorage (debounced via microtask batching).

export function usePersist(slug: string) {
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const existing = loadFromStorage(slug);
    const doc = existing ?? seedFor(slug);
    useEditor.getState().loadDoc(doc);
    // Reset undo history so initial seed isn't in the past.
    useEditor.temporal.getState().clear();
  }, [slug]);

  useEffect(() => {
    // Subscribe to doc changes; save whenever `updatedAt` moves.
    let lastSaved = 0;
    const unsub = useEditor.subscribe((state) => {
      if (!loadedRef.current) return;
      if (state.doc.updatedAt === lastSaved) return;
      lastSaved = state.doc.updatedAt;
      saveToStorage(state.doc);
    });
    return unsub;
  }, []);
}
