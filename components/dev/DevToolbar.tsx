"use client";

import { useEffect, useState } from "react";

// Floating toolbar for working on CVs together.
// - Grid: toggle the design grid overlay so we can reference precise positions.
// - Print: opens the browser print dialog (export as PDF).
// Hidden when printing via the `no-print` class.

export function DevToolbar() {
  const [grid, setGrid] = useState(false);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("cv:toggle-grid", { detail: grid }));
  }, [grid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setGrid((g) => !g);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="no-print fixed bottom-4 right-4 z-[100] flex gap-2 font-mono text-[11px]">
      <button
        onClick={() => setGrid((g) => !g)}
        className="px-3 py-1.5 bg-ink text-paper rounded-full shadow-sm hover:opacity-90"
        title="Toggle design grid (⌘G)"
      >
        {grid ? "grid on" : "grid off"}
      </button>
      <button
        onClick={() => window.print()}
        className="px-3 py-1.5 bg-ink text-paper rounded-full shadow-sm hover:opacity-90"
        title="Print or save as PDF"
      >
        print / pdf
      </button>
    </div>
  );
}
