"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { Page } from "@/lib/doc/types";
import { useEditor } from "@/lib/doc/store";

// ————————————————————————————————————————————
// Inline comments overlay. For every node with at least one unresolved
// comment, renders a "💬 N" pill pinned to the node's top-right corner.
// Clicking the pill (or pressing C on a selected node) expands a thread
// panel anchored to the node.
//
// Reasons this is its own layer and not inside NodeView:
//   1. The pill must survive through `display: none` if the node is hidden
//      — in practice we hide pills for hidden nodes, but making it its own
//      overlay keeps the stacking/positioning concerns separate.
//   2. We want a single focusable panel at a time — owning "which node's
//      thread is open" here is simpler than lifting to the store.
// Coordinates: pages are sized in mm, so this overlay uses the same
// `mm` units as the nodes so pills stay pinned under zoom.
// ————————————————————————————————————————————

type ThreadAnchor = { nodeId: string; openedVia: "pill" | "shortcut" };

/** Listen for "open-comment-thread" events dispatched by the shortcut hook. */
function useOpenCommentShortcut(
  setAnchor: (a: ThreadAnchor | null) => void,
): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string }>).detail;
      if (!detail?.nodeId) return;
      setAnchor({ nodeId: detail.nodeId, openedVia: "shortcut" });
    };
    window.addEventListener("cv:open-comment-thread", handler as EventListener);
    return () =>
      window.removeEventListener(
        "cv:open-comment-thread",
        handler as EventListener,
      );
  }, [setAnchor]);
}

export function CommentLayer({ page }: { page: Page }) {
  const comments = useEditor((s) => s.doc.comments) ?? [];
  const [anchor, setAnchor] = useState<ThreadAnchor | null>(null);

  useOpenCommentShortcut(setAnchor);

  // Group unresolved comments by node — this is what determines pill render.
  const byNode = new Map<string, number>();
  for (const c of comments) {
    if (c.resolvedAt) continue;
    byNode.set(c.nodeId, (byNode.get(c.nodeId) ?? 0) + 1);
  }

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: "none" }}
      data-editor-chrome
    >
      {page.nodes.map((n) => {
        const unresolved = byNode.get(n.id);
        const hasAny = comments.some((c) => c.nodeId === n.id);
        // Show a pill if there are unresolved comments OR a thread is open
        // for this node (even if everything was just resolved — the user is
        // still looking at it).
        if (!unresolved && anchor?.nodeId !== n.id) return null;
        if (!hasAny && anchor?.nodeId !== n.id) return null;
        if (n.hidden) return null;

        return (
          <CommentPill
            key={n.id}
            x={n.x + n.w}
            y={n.y}
            count={unresolved ?? 0}
            active={anchor?.nodeId === n.id}
            onClick={() =>
              setAnchor((a) =>
                a?.nodeId === n.id
                  ? null
                  : { nodeId: n.id, openedVia: "pill" },
              )
            }
          />
        );
      })}

      {anchor && (
        <CommentThread
          nodeId={anchor.nodeId}
          page={page}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}

function CommentPill({
  x,
  y,
  count,
  active,
  onClick,
}: {
  x: number;
  y: number;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  // Pinned to the node's top-right. Uses translate so the pill hangs just
  // outside the node bounds without offsetting its own width.
  const style: CSSProperties = {
    position: "absolute",
    left: `${x}mm`,
    top: `${y}mm`,
    transform: "translate(-50%, -50%)",
    pointerEvents: "auto",
  };

  const label =
    count > 0
      ? `${count} unresolved comment${count === 1 ? "" : "s"} — open thread`
      : "Open comment thread";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-editor-chrome
      style={{
        ...style,
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 9999,
        background: active ? "#4f8cff" : "#1f1f1f",
        color: "#fff",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        lineHeight: 1,
        border: "1px solid rgba(255,255,255,0.2)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        cursor: "pointer",
      }}
    >
      <span aria-hidden="true">💬</span>
      <span>{count || "+"}</span>
    </button>
  );
}

function CommentThread({
  nodeId,
  page,
  onClose,
}: {
  nodeId: string;
  page: Page;
  onClose: () => void;
}) {
  const node = page.nodes.find((n) => n.id === nodeId);
  const allComments = useEditor((s) => s.doc.comments) ?? [];
  const addComment = useEditor((s) => s.addComment);
  const resolveComment = useEditor((s) => s.resolveComment);
  const reopenComment = useEditor((s) => s.reopenComment);
  const deleteComment = useEditor((s) => s.deleteComment);

  const [body, setBody] = useState("");

  if (!node) return null;

  // Place the thread card immediately to the right of the node, clamped so
  // it doesn't fly off the page when the node is on the right edge.
  const nodeRight = node.x + node.w;
  const threadLeft = Math.min(nodeRight + 4, page.width - 2);
  const nodeComments = allComments.filter((c) => c.nodeId === nodeId);

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    addComment({ nodeId, body: trimmed, author: "user" });
    setBody("");
  };

  return (
    <div
      role="dialog"
      aria-label={`Comments on ${node.name ?? node.type} node`}
      data-editor-chrome
      style={{
        position: "absolute",
        left: `${threadLeft}mm`,
        top: `${node.y}mm`,
        width: "72mm",
        maxHeight: "calc(100% - 4mm)",
        overflow: "auto",
        background: "#1f1f1f",
        color: "#e8e8e8",
        border: "1px solid #3a3a3a",
        borderRadius: 6,
        boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
        padding: 10,
        fontSize: 12,
        lineHeight: 1.4,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header
        className="flex items-center justify-between"
        style={{ marginBottom: 8 }}
      >
        <span className="editor-label">
          Comments · {nodeComments.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comment thread"
          className="editor-btn editor-btn-ghost"
          style={{ padding: "0 6px" }}
        >
          ×
        </button>
      </header>

      {nodeComments.length === 0 && (
        <p
          style={{
            color: "var(--color-editor-text-dim)",
            fontSize: 11,
            marginBottom: 8,
          }}
        >
          No comments yet. Leave one below.
        </p>
      )}

      <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {nodeComments.map((c) => (
          <li
            key={c.id}
            style={{
              padding: 8,
              border: "1px solid #3a3a3a",
              borderRadius: 4,
              background: c.resolvedAt ? "rgba(255,255,255,0.03)" : "#2a2a2a",
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
              <time dateTime={new Date(c.createdAt).toISOString()}>
                {formatTime(c.createdAt)}
              </time>
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{c.body}</p>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {c.resolvedAt ? (
                <button
                  type="button"
                  onClick={() => reopenComment(c.id)}
                  className="editor-btn editor-btn-ghost"
                >
                  reopen
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => resolveComment(c.id)}
                  className="editor-btn editor-btn-ghost"
                >
                  resolve
                </button>
              )}
              <button
                type="button"
                onClick={() => deleteComment(c.id)}
                className="editor-btn editor-btn-ghost"
              >
                delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ marginTop: 10 }}
      >
        <label
          htmlFor={`comment-input-${nodeId}`}
          className="editor-label"
          style={{ display: "block", marginBottom: 4 }}
        >
          Add comment
        </label>
        <textarea
          id={`comment-input-${nodeId}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Note a change, ask the copilot for a tighter rewrite…"
          className="editor-input"
          style={{ minHeight: 56, resize: "vertical" }}
          autoFocus
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 6,
          }}
        >
          <span
            className="editor-label"
            style={{ color: "var(--color-editor-text-dim)" }}
          >
            ⌘↵ to submit
          </span>
          <button
            type="submit"
            disabled={body.trim().length === 0}
            className="editor-btn"
          >
            comment
          </button>
        </div>
      </form>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
