import type { FeedResult } from "@apply-kit/core";
import { useState } from "react";
import { FeedPage } from "./feed/FeedPage.tsx";

const nav = [
  { href: "/", label: "Feed" },
  { href: "/applications", label: "Applications" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

const healthText: Record<FeedResult["health"]["state"], [cls: string, text: string]> = {
  "no-sources": ["warn", "No sources yet"],
  working: ["", "All sources working"],
};

export function App() {
  const path = window.location.pathname;
  const [health, setHealth] = useState<FeedResult["health"] | null>(null);
  const [cls, text] = health ? healthText[health.state] : ["", "Checking…"];

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
              <a key={n.href} href={n.href} aria-current={n.href === path ? "page" : undefined}>{n.label}</a>
            ))}
          </nav>
          <span className="grow" />
          <a className={`health ${cls}`} href="/settings/sources" aria-live="polite">
            <i aria-hidden="true" />
            <span>{text}</span>
          </a>
        </header>
        <main className="main" id="main" tabIndex={-1}>
          {path === "/" ? <FeedPage onHealth={setHealth} /> : <NotBuilt />}
        </main>
      </div>
    </>
  );
}

function NotBuilt() {
  return (
    <div className="empty">
      <h1>This screen isn't built yet</h1>
      <p>It arrives with a later part of the rebuild. The Feed is ready.</p>
      <a className="btn" href="/">Back to the Feed</a>
    </div>
  );
}
