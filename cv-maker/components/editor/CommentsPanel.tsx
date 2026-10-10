"use client";

import { useMemo, useState } from "react";
import { useEditor } from "@/lib/doc/store";
import type { DocComment, Node } from "@/lib/doc/types";

// ————————————————————————————————————————————
// Right-pane "Comments" tab. A flat, chronological list of every comment in
// the document, grouped by the node it anchors to. Clicking a group header
// (or any comment row) selects the anchor node and emits a custom event so
// the CommentLayer knows to open its thread.
// ————————————————————————————————————————————

type Filter = "unresolved" | "all" | "resolved";

export function CommentsPanel() {
  const comments = useEditor((s) => s.doc.comments) ?? [];
  const nodes = useEditor((s) => s.doc.pages[0]?.nodes ?? []);
  const select = useEditor((s) => s.select);
  const [filter, setFilter] = useState<Filter>("unresolved");

  const nodeById = useMemo(() => {
    const m = new Map<string, Node>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const filtered = comments.filter((c) => {
    if (filter === "all") return true;
    if (filter === "unresolved") return !c.resolvedAt;
    return !!c.resolvedAt;
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, DocComment[]>();
    for (const c of filtered) {
      const list = groups.get(c.nodeId) ?? [];
      list.push(c);
      groups.set(c.nodeId, list);
    }
    // Sort each group newest-first for scanning.
    for (const list of groups.values()) {
      list.sort((a, b) => b.createdAt - a.createdAt);
    }
    return groups;
  }, [filtered]);

  const openThread = (nodeId: string) => {
    select(nodeId);
    // Microtask defer so the store write lands before the overlay handler
    // reads from it.
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent("cv:open-comment-thread", { detail: { nodeId } }),
      );
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--color-editor-border)" }}
      >
        <span className="editor-label">Comments</span>
        <div
          role="tablist"
          aria-label="Filter comments"
          className="flex gap-1"
        >
          {(["unresolved", "all", "resolved"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className="editor-btn editor-btn-ghost"
              data-active={filter === f ? "true" : undefined}
              style={{ padding: "2px 6px", fontSize: 10 }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {filtered.length === 0 && (
          <p className="text-[12px] text-[var(--color-editor-text-dim)]">
            {filter === "unresolved"
              ? "No unresolved comments. Press C on a selected node to add one."
              : filter === "resolved"
                ? "No resolved comments yet."
                : "No comments on this document."}
          </p>
        )}

        {Array.from(grouped.entries()).map(([nodeId, list]) => {
          const node = nodeById.get(nodeId);
          const preview = nodePreview(node);
          return (
            <section key={nodeId}>
              <button
                type="button"
                onClick={() => openThread(nodeId)}
                className="block w-full text-left"
                style={{
                  padding: "4px 6px",
                  marginLeft: -6,
                  borderRadius: 4,
                  background: "transparent",
                }}
              >
                <span className="editor-label">{preview}</span>
              </button>
              <ul className="mt-1 space-y-2">
                {list.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openThread(nodeId)}
                      className="block w-full text-left"
                      style={{
                        padding: 8,
                        border: "1px solid var(--color-editor-border)",
                        borderRadius: 4,
                        background: c.resolvedAt
                          ? "rgba(255,255,255,0.02)"
                          : "#2a2a2a",
                        opacity: c.resolvedAt ? 0.65 : 1,
                      }}
                    >
                      <div
                        className="editor-label"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 4,
                        }}
                      >
                        <span>
                          {c.author === "ai" ? "ai" : "you"}
                          {c.resolvedAt ? " · resolved" : ""}
                        </span>
                        <span>
                          {new Date(c.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                          margin: 0,
                        }}
                      >
                        {c.body}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function nodePreview(node: Node | undefined): string {
  if (!node) return "(deleted node)";
  const label = node.name ?? node.type;
  if (node.type === "text") {
    const snippet = node.content.slice(0, 40).replace(/\n/g, " ");
    return `${label} — "${snippet}${node.content.length > 40 ? "…" : ""}"`;
  }
  return label;
}
