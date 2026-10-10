"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { Node, TextNode, TextStyle, Theme } from "@/lib/doc/types";
import { useEditor } from "@/lib/doc/store";
import { heuristicIsBullet } from "@/lib/evaluation/proofInspector";

// Resolves a font token against the current theme.
function resolveFont(style: TextStyle, theme: Theme): string {
  if (style.fontFamily) return style.fontFamily;
  const token = style.fontToken ?? "sans";
  return theme.fonts[token];
}

function textStyleToCss(style: TextStyle, theme: Theme): CSSProperties {
  return {
    fontFamily: resolveFont(style, theme),
    fontSize: `${style.fontSize}px`,
    fontWeight: style.fontWeight,
    fontStyle: style.italic ? "italic" : "normal",
    color: style.color,
    lineHeight: style.lineHeight,
    letterSpacing:
      style.letterSpacing !== undefined ? `${style.letterSpacing}em` : undefined,
    textTransform: style.textTransform,
    textAlign: style.textAlign,
  };
}

// Renders one node inside a page. Nodes are absolutely positioned in mm.
export function NodeView({
  node,
  theme,
  selected,
  hovered,
  onSelect,
  onHoverChange,
}: {
  node: Node;
  theme: Theme;
  selected: boolean;
  hovered: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onHoverChange: (id: string | null) => void;
}) {
  if (node.hidden) return null;

  const containerStyle: CSSProperties = {
    position: "absolute",
    left: `${node.x}mm`,
    top: `${node.y}mm`,
    width: `${node.w}mm`,
    height: `${node.h}mm`,
    zIndex: node.z,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: "center center",
    opacity: node.opacity,
    pointerEvents: node.locked ? "none" : "auto",
  };

  const className = [
    "node-selectable",
    selected && "node-selected",
    hovered && "node-hover",
  ]
    .filter(Boolean)
    .join(" ");

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.id, e.shiftKey || e.metaKey);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (node.type !== "text") return;
    e.stopPropagation();
    useEditor.getState().startEdit(node.id);
  };

  return (
    <div
      data-node-id={node.id}
      className={className}
      style={containerStyle}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => onHoverChange(node.id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      <NodeBody node={node} theme={theme} />
      {node.type === "text" && <ProofWarningPill node={node} />}
    </div>
  );
}

// Tiny "proof?" chip in the top-right of a bullet node when its proofUrl is
// empty. Visible only while the parser overlay is on — reuses the existing
// editor-chrome toggle so this doesn't add another UI control.
function ProofWarningPill({ node }: { node: TextNode }) {
  const showParserOverlay = useEditor((s) => s.showParserOverlay);
  if (!showParserOverlay) return null;

  const required =
    node.proofRequired === undefined
      ? heuristicIsBullet(node)
      : node.proofRequired;
  if (!required) return null;
  if (node.proofUrl && node.proofUrl.trim().length > 0) return null;

  return (
    <div
      data-editor-chrome
      aria-hidden="true"
      style={{
        position: "absolute",
        top: -6,
        right: -6,
        padding: "1px 4px",
        background: "#d64933",
        color: "#fff",
        fontFamily: "var(--font-mono)",
        fontSize: 8,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        borderRadius: 2,
        pointerEvents: "none",
        zIndex: 50,
      }}
    >
      proof?
    </div>
  );
}

function NodeBody({ node, theme }: { node: Node; theme: Theme }) {
  if (node.type === "text") {
    return <TextBody node={node} theme={theme} />;
  }

  // Shared with TextBody below.
  if (node.type === "image") {
    return node.src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={node.src}
        alt={node.alt ?? ""}
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: node.objectFit ?? "cover",
          borderRadius: node.borderRadius ? `${node.borderRadius}px` : undefined,
          userSelect: "none",
        }}
      />
    ) : (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#eee",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#999",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
        }}
      >
        image
      </div>
    );
  }

  if (node.type === "shape") {
    if (node.shape === "line") {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: node.stroke ?? "#111",
          }}
        />
      );
    }
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: node.fill,
          border: node.stroke
            ? `${node.strokeWidth ?? 1}px solid ${node.stroke}`
            : undefined,
        }}
      />
    );
  }

  return null;
}

// Text body — renders either a static read-only view, or (when editingId
// matches this node) a textarea overlaid with the exact same typography so the
// user types in place and sees reflow live.
function TextBody({ node, theme }: { node: TextNode; theme: Theme }) {
  const editingId = useEditor((s) => s.editingId);
  const updateNode = useEditor((s) => s.updateNode);
  const stopEdit = useEditor((s) => s.stopEdit);
  const isEditing = editingId === node.id;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, [isEditing]);

  const style: CSSProperties = {
    ...textStyleToCss(node.style, theme),
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    height: "100%",
    width: "100%",
    margin: 0,
    padding: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    resize: "none",
    boxSizing: "border-box",
  };

  if (!isEditing) {
    return <div style={style}>{node.content}</div>;
  }

  return (
    <textarea
      ref={textareaRef}
      value={node.content}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => updateNode(node.id, { content: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          stopEdit();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          stopEdit();
        }
      }}
      onBlur={stopEdit}
      style={style}
    />
  );
}
