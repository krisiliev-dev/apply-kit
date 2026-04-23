"use client";

import type { CSSProperties } from "react";
import type { Node, TextStyle, Theme } from "@/lib/doc/types";

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

  return (
    <div
      data-node-id={node.id}
      className={className}
      style={containerStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => onHoverChange(node.id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      <NodeBody node={node} theme={theme} />
    </div>
  );
}

function NodeBody({ node, theme }: { node: Node; theme: Theme }) {
  if (node.type === "text") {
    return (
      <div
        style={{
          ...textStyleToCss(node.style, theme),
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          height: "100%",
          width: "100%",
        }}
      >
        {node.content}
      </div>
    );
  }

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
