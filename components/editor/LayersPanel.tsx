"use client";

import { useEditor } from "@/lib/doc/store";
import type { Node } from "@/lib/doc/types";

const typeIcon: Record<Node["type"], string> = {
  text: "T",
  image: "⬚",
  shape: "▭",
};

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const updateNode = useEditor((s) => s.updateNode);
  const bringForward = useEditor((s) => s.bringForward);
  const sendBackward = useEditor((s) => s.sendBackward);

  const page = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];
  // Layers list shows top-of-stack first (like Figma).
  const sorted = [...page.nodes].sort((a, b) => b.z - a.z);

  const renderLabel = (n: Node) => {
    if (n.name) return n.name;
    if (n.type === "text") return n.content.slice(0, 24) || "Text";
    if (n.type === "image") return n.alt || "Image";
    return n.shape === "line" ? "Line" : "Rectangle";
  };

  return (
    <div
      className="editor-panel flex flex-col border-r"
      data-editor-chrome
      style={{ width: 240, borderColor: "var(--color-editor-border)" }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--color-editor-border)" }}
      >
        <span className="editor-label">Layers</span>
        <span className="editor-label">{sorted.length}</span>
      </div>

      <div className="flex-1 overflow-auto">
        {sorted.length === 0 && (
          <p className="p-3 text-[11px] text-[var(--color-editor-text-dim)]">
            Empty. Add a block from the toolbar.
          </p>
        )}
        <ul role="list">
          {sorted.map((n) => {
            const isSelected = selectedIds.includes(n.id);
            const label = renderLabel(n);
            return (
              <li
                key={n.id}
                className="group flex items-center gap-2 px-2 py-1.5 text-[12px]"
                style={{
                  background: isSelected
                    ? "rgba(79, 140, 255, 0.18)"
                    : "transparent",
                  color: n.hidden
                    ? "var(--color-editor-text-dim)"
                    : "var(--color-editor-text)",
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    if (e.shiftKey || e.metaKey) toggleSelect(n.id);
                    else select(n.id);
                  }}
                  aria-pressed={isSelected}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer bg-transparent"
                >
                  <span
                    aria-hidden="true"
                    className="w-4 text-center font-mono text-[11px]"
                    style={{ color: "var(--color-editor-text-dim)" }}
                  >
                    {typeIcon[n.type]}
                  </span>
                  <span className="flex-1 truncate">{label}</span>
                </button>

                <div className="hidden group-hover:flex group-focus-within:flex items-center gap-1">
                  <button
                    type="button"
                    className="editor-btn-ghost editor-btn"
                    onClick={() => bringForward(n.id)}
                    title="Bring forward"
                    aria-label={`Bring "${label}" forward`}
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    type="button"
                    className="editor-btn-ghost editor-btn"
                    onClick={() => sendBackward(n.id)}
                    title="Send backward"
                    aria-label={`Send "${label}" backward`}
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                  <button
                    type="button"
                    className="editor-btn-ghost editor-btn"
                    onClick={() => updateNode(n.id, { hidden: !n.hidden })}
                    title={n.hidden ? "Show" : "Hide"}
                    aria-label={n.hidden ? `Show "${label}"` : `Hide "${label}"`}
                    aria-pressed={!!n.hidden}
                  >
                    <span aria-hidden="true">{n.hidden ? "○" : "●"}</span>
                  </button>
                  <button
                    type="button"
                    className="editor-btn-ghost editor-btn"
                    onClick={() => updateNode(n.id, { locked: !n.locked })}
                    title={n.locked ? "Unlock" : "Lock"}
                    aria-label={n.locked ? `Unlock "${label}"` : `Lock "${label}"`}
                    aria-pressed={!!n.locked}
                  >
                    <span aria-hidden="true">{n.locked ? "🔒" : "🔓"}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
