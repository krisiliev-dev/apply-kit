import type { HealthSummary } from "@apply-kit/core";
import { useEffect, useState } from "react";
import { fetchSources } from "./api.ts";
import { FeedPage } from "./feed/FeedPage.tsx";
import { healthPill } from "./health.tsx";
import { SourcesPage } from "./sources/SourcesPage.tsx";
import { JobPage } from "./job/JobPage.tsx";

const nav = [
  { href: "/", label: "Feed" },
  { href: "/applications", label: "Applications" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

export function App() {
  const path = window.location.pathname;
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [cls, text] = health ? healthPill(health) : ["", "Checking…"];
  const settings = path.startsWith("/settings");

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell">
        <header className="topbar">
          <a className="brand" href="/">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 20 9 7l4 7 3-4 6 10z" fill="var(--action)" /><circle cx="17.5" cy="5.5" r="2" fill="var(--bloom)" /></svg>
            apply-kit
          </a>
          <nav className="nav" aria-label="Main">
            {nav.map((n) => (
              <a key={n.href} href={n.href} aria-current={n.href === path || (n.href === "/settings" && settings) || (n.href === "/" && path.startsWith("/jobs/")) ? "page" : undefined}>{n.label}</a>
            ))}
          </nav>
          <span className="grow" />
          <a className={`health ${cls}`} href="/settings/sources" aria-live="polite">
            <i aria-hidden="true" />
            <span>{text}</span>
            <span className="sr-only"> · open source health</span>
          </a>
        </header>
        <main className="main" id="main" tabIndex={-1}>
          {path === "/" ? <FeedPage onHealth={setHealth} />
            : path.startsWith("/jobs/") ? <JobPage id={decodeURIComponent(path.slice("/jobs/".length))} onHealth={setHealth} />
            : path === "/settings/sources" || path === "/settings/sources/add" || path === "/settings/sources/coverage" || path === "/settings" ? <SourcesPage onHealth={setHealth} />
            : <NotBuilt onHealth={setHealth} />}
        </main>
      </div>
    </>
  );
}

function NotBuilt({ onHealth }: { onHealth: (h: HealthSummary) => void }) {
  // The top bar shows source health on every screen.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);
  return (
    <div className="empty">
      <h1>This screen isn't built yet</h1>
      <p>It arrives with a later part of the rebuild. The Feed is ready.</p>
      <a className="btn" href="/">Back to the Feed</a>
    </div>
  );
}
