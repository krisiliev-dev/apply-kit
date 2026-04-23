"use client";

import { useEffect, useState } from "react";

// A4 page wrapper. Every CV composition drops its custom layout inside this.
// Handles print sizing and the dev grid overlay (toggled from DevToolbar).
export function CvPage({ children }: { children: React.ReactNode }) {
  const [gridOn, setGridOn] = useState(false);

  useEffect(() => {
    const handler = (e: CustomEvent<boolean>) => setGridOn(e.detail);
    window.addEventListener("cv:toggle-grid", handler as EventListener);
    return () =>
      window.removeEventListener("cv:toggle-grid", handler as EventListener);
  }, []);

  return (
    <div className="cv-page" data-grid={gridOn ? "true" : "false"}>
      {children}
    </div>
  );
}
