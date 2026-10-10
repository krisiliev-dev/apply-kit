"use client";

import { useState } from "react";
import { Toolbar } from "./Toolbar";
import { LayersPanel } from "./LayersPanel";
import { Canvas } from "./Canvas";
import { AlignBar } from "./AlignBar";
import { Inspector } from "./Inspector";
import { ChatPanel } from "./ChatPanel";
import { EvalPanel } from "./EvalPanel";
import { CommentsPanel } from "./CommentsPanel";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { usePersist } from "./usePersist";
import { unresolvedCommentCount, useEditor } from "@/lib/doc/store";

type RightTab = "inspector" | "chat" | "eval" | "comments";

// Editor root. Four-region layout:
//   ┌───────────────────────────────┐
//   │          Toolbar              │
//   ├───────┬───────────────┬───────┤
//   │Layers │   Canvas      │Right  │
//   └───────┴───────────────┴───────┘
// The right pane tabs between Inspector / Chat / Eval / Comments. Comments
// is the newest tab and shows a badge with the unresolved count so the user
// sees open threads without opening the tab.
export function Editor({ slug }: { slug: string }) {
  const [tab, setTab] = useState<RightTab>("inspector");
  const unresolved = useEditor((s) => unresolvedCommentCount(s.doc));

  const { externalDoc, applyExternal, dismissExternal } = usePersist(slug);
  useEditorShortcuts();

  return (
    <div className="editor-root flex flex-col">
      {externalDoc && (
        <ExternalUpdateBanner
          onReload={applyExternal}
          onDismiss={dismissExternal}
        />
      )}
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
            role="tablist"
            aria-label="Editor panels"
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
            <TabBtn active={tab === "comments"} onClick={() => setTab("comments")}>
              <span className="inline-flex items-center gap-1.5">
                Comments
                {unresolved > 0 && (
                  <span
                    aria-label={`${unresolved} unresolved`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 14,
                      height: 14,
                      padding: "0 3px",
                      borderRadius: 9999,
                      background: "#d64933",
                      color: "#fff",
                      fontSize: 9,
                      lineHeight: 1,
                    }}
                  >
                    {unresolved}
                  </span>
                )}
              </span>
            </TabBtn>
          </div>
          <div className="flex-1 min-h-0">
            {tab === "inspector" ? (
              <Inspector />
            ) : tab === "chat" ? (
              <ChatPanel />
            ) : tab === "eval" ? (
              <EvalPanel slug={slug} />
            ) : (
              <CommentsPanel />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Shown when the shared store has a newer version of this CV than what's in
// the editor — i.e. the agent (via MCP) or another tab changed it. We don't
// auto-replace mid-edit; the user chooses when to pull it in.
function ExternalUpdateBanner({
  onReload,
  onDismiss,
}: {
  onReload: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 px-4 py-2 text-[11px] font-mono"
      style={{ background: "var(--color-editor-select)", color: "#fff" }}
    >
      <span className="uppercase tracking-[0.15em]">
        This CV was updated by the agent.
      </span>
      <span className="flex items-center gap-3">
        <button
          type="button"
          onClick={onReload}
          className="underline underline-offset-2 hover:opacity-80"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </span>
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
      type="button"
      role="tab"
      aria-selected={active}
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
