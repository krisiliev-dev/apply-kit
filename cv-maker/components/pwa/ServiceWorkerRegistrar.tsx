"use client";

import { useEffect } from "react";

// Registers the pass-through service worker so the browser marks the app as
// installable. Mounted once from app/layout.tsx. Silent failures are fine —
// the app continues to work without a service worker; users just don't see
// the "Install app" button in their browser chrome.

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only register in production builds. During `next dev --turbopack` the
    // SW can interfere with HMR / route prefetching.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          // swallow — installability is a nice-to-have, not critical
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
