"use client";

import { useState } from "react";
import { Toolbar } from "./Toolbar";
import { LayersPanel } from "./LayersPanel";
import { Canvas } from "./Canvas";
import { AlignBar } from "./AlignBar";
import { Inspector } from "./Inspector";
import { ChatPanel } from "./ChatPanel";
import { EvalPanel } from "./EvalPanel";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { usePersist } from "./usePersist";

type RightTab = "inspector" | "chat" | "eval";

// Editor root. Four-region layout:
//   ┌───────────────────────────────┐
//   │          Toolbar              │
//   ├───────┬───────────────┬───────┤
//   │Layers │   Canvas      │Right  │
//   └───────┴───────────────┴───────┘
// The right pane tabs between "Inspector" (properties) and "Chat" (AI).
export function Editor({ slug }: { slug: string }) {
  const [tab, setTab] = useState<RightTab>("inspector");

  usePersist(slug);
  useEditorShortcuts();

  return (
    <div className="editor-root flex flex-col">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <LayersPanel />
        <div className="flex-1 min-w-0 min-h-0 relative">
          <Canvas />
          <AlignBar />
        </div>
        <div
          className="editor-panel flex flex-col border-l"
          data-editor-chrome
          style={{ width: 340, borderColor: "var(--color-editor-border)" }}
        >
          <div
            className="flex border-b"
            style={{ borderColor: "var(--color-editor-border)" }}
          >
            <TabBtn active={tab === "inspector"} onClick={() => setTab("inspector")}>
              Inspector
            </TabBtn>
            <TabBtn active={tab === "chat"} onClick={() => setTab("chat")}>
              Chat
            </TabBtn>
            <TabBtn active={tab === "eval"} onClick={() => setTab("eval")}>
              Eval
            </TabBtn>
          </div>
          <div className="flex-1 min-h-0">
            {tab === "inspector" ? (
              <Inspector />
            ) : tab === "chat" ? (
              <ChatPanel />
            ) : (
              <EvalPanel slug={slug} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-2 font-mono text-[11px] uppercase tracking-[0.15em]"
      style={{
        color: active ? "var(--color-editor-text)" : "var(--color-editor-text-dim)",
        background: active ? "rgba(255,255,255,0.04)" : "transparent",
        borderBottom: active ? "2px solid var(--color-editor-select)" : "2px solid transparent",
      }}
    >
      {children}
    </button>
  );
}
