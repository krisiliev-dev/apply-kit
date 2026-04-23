"use client";

import { useStore } from "zustand";
import { useEditor } from "@/lib/doc/store";

// zundo exposes a temporal sub-store on our main store. This hook gives us
// reactive access to its past/future state so the Undo/Redo buttons can
// enable/disable correctly.
export function useTemporalEditor() {
  const pastStates = useStore(useEditor.temporal, (s) => s.pastStates);
  const futureStates = useStore(useEditor.temporal, (s) => s.futureStates);
  const undo = useEditor.temporal.getState().undo;
  const redo = useEditor.temporal.getState().redo;
  return {
    undo,
    redo,
    canUndo: pastStates.length > 0,
    canRedo: futureStates.length > 0,
  };
}
