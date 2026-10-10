import { useState, type ReactElement } from "react";
import { QAPanel } from "./panels/QAPanel";
import { DiscoveryPanel } from "./panels/DiscoveryPanel";
import { PairPanel } from "./panels/PairPanel";

// The popup is three small panels toggled by a tab bar. All panels talk to
// the background worker via sendToBackground — no shared state is necessary.

type Tab = "qa" | "discovery" | "pair";

export function App(): ReactElement {
  const [tab, setTab] = useState<Tab>("qa");

  return (
    <div className="p-3 flex flex-col gap-3">
      <header className="flex items-end justify-between pb-2 border-b border-[var(--color-ink)]">
        <div>
          <div className="cvaf-label">CV Autofill</div>
          <h1 className="cvaf-h text-2xl leading-none">
            {tab === "qa"
              ? "Your Q&A memory"
              : tab === "discovery"
                ? "Discovery queue"
                : "Pair with web app"}
          </h1>
        </div>
        <nav className="flex gap-1" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "qa"}
            className={`cvaf-btn ${tab === "qa" ? "accent" : ""}`}
            onClick={() => setTab("qa")}
          >
            Q&amp;A
          </button>
          <button
            role="tab"
            aria-selected={tab === "discovery"}
            className={`cvaf-btn ${tab === "discovery" ? "accent" : ""}`}
            onClick={() => setTab("discovery")}
          >
            Discovery
          </button>
          <button
            role="tab"
            aria-selected={tab === "pair"}
            className={`cvaf-btn ${tab === "pair" ? "accent" : ""}`}
            onClick={() => setTab("pair")}
          >
            Pair
          </button>
        </nav>
      </header>

      {tab === "qa" ? (
        <QAPanel />
      ) : tab === "discovery" ? (
        <DiscoveryPanel />
      ) : (
        <PairPanel />
      )}
    </div>
  );
}
