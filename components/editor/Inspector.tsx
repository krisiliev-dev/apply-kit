"use client";

import { useEditor, isTextNode, isImageNode, isShapeNode } from "@/lib/doc/store";
import type { Node, TextNode, ImageNode, ShapeNode, FontToken } from "@/lib/doc/types";

// Inspector — edits the currently selected node(s).
// When multiple nodes are selected, only fields that apply to all types are shown.

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const updateNode = useEditor((s) => s.updateNode);
  const updateTextStyle = useEditor((s) => s.updateTextStyle);
  const setTheme = useEditor((s) => s.setTheme);

  const page = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];
  const selected = page.nodes.filter((n) => selectedIds.includes(n.id));

  if (selected.length === 0) {
    return <ThemeInspector doc={doc} setTheme={setTheme} />;
  }

  const isSingle = selected.length === 1;
  const node = selected[0];

  return (
    <div className="p-3 space-y-4 overflow-auto">
      <SectionHead>
        {isSingle
          ? `${node.type}${node.name ? ` · ${node.name}` : ""}`
          : `${selected.length} selected`}
      </SectionHead>

      {/* transform — applies to all node types */}
      <TransformBlock
        nodes={selected}
        onChange={(patch) => selected.forEach((n) => updateNode(n.id, patch))}
      />

      {/* per-type editors */}
      {isSingle && isTextNode(node) && (
        <TextBlock node={node} updateNode={updateNode} updateTextStyle={updateTextStyle} />
      )}
      {isSingle && isImageNode(node) && (
        <ImageBlock node={node} updateNode={updateNode} />
      )}
      {isSingle && isShapeNode(node) && (
        <ShapeBlock node={node} updateNode={updateNode} />
      )}

      {/* name / visibility */}
      {isSingle && (
        <>
          <SectionHead>Layer</SectionHead>
          <Row label="Name">
            <input
              className="editor-input"
              value={node.name ?? ""}
              onChange={(e) => updateNode(node.id, { name: e.target.value })}
            />
          </Row>
          <Row label="Opacity">
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              className="editor-input"
              value={node.opacity ?? 1}
              onChange={(e) =>
                updateNode(node.id, { opacity: Number(e.target.value) })
              }
            />
          </Row>
        </>
      )}
    </div>
  );
}

// ———————————————————————————————————————
// Blocks
// ———————————————————————————————————————

function TransformBlock({
  nodes,
  onChange,
}: {
  nodes: Node[];
  onChange: (patch: Partial<Node>) => void;
}) {
  const n = nodes[0];
  const same = (key: keyof Node) => nodes.every((x) => x[key] === n[key]);
  return (
    <>
      <SectionHead>Transform</SectionHead>
      <Grid2>
        <NumField
          label="X"
          value={same("x") ? n.x : ""}
          onChange={(v) => onChange({ x: v })}
        />
        <NumField
          label="Y"
          value={same("y") ? n.y : ""}
          onChange={(v) => onChange({ y: v })}
        />
        <NumField
          label="W"
          value={same("w") ? n.w : ""}
          onChange={(v) => onChange({ w: v })}
        />
        <NumField
          label="H"
          value={same("h") ? n.h : ""}
          onChange={(v) => onChange({ h: v })}
        />
      </Grid2>
      <Row label="Rotate">
        <input
          type="number"
          className="editor-input"
          value={n.rotation ?? 0}
          onChange={(e) => onChange({ rotation: Number(e.target.value) })}
        />
      </Row>
    </>
  );
}

const FONT_TOKENS: { value: FontToken; label: string }[] = [
  { value: "display", label: "Display" },
  { value: "sans", label: "Sans" },
  { value: "mono", label: "Mono" },
];

function TextBlock({
  node,
  updateNode,
  updateTextStyle,
}: {
  node: TextNode;
  updateNode: (id: string, patch: Partial<Node>) => void;
  updateTextStyle: (id: string, patch: Partial<TextNode["style"]>) => void;
}) {
  return (
    <>
      <SectionHead>Text</SectionHead>
      <textarea
        className="editor-input"
        style={{ height: 80, fontFamily: "var(--font-sans)" }}
        value={node.content}
        onChange={(e) => updateNode(node.id, { content: e.target.value })}
      />

      <SectionHead>Typography</SectionHead>
      <Row label="Font">
        <select
          className="editor-input"
          value={node.style.fontToken ?? "sans"}
          onChange={(e) =>
            updateTextStyle(node.id, {
              fontToken: e.target.value as FontToken,
              fontFamily: undefined,
            })
          }
        >
          {FONT_TOKENS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Row>
      <Grid2>
        <NumField
          label="Size"
          value={node.style.fontSize}
          step={1}
          onChange={(v) => updateTextStyle(node.id, { fontSize: v })}
        />
        <NumField
          label="Weight"
          value={node.style.fontWeight}
          step={100}
          onChange={(v) => updateTextStyle(node.id, { fontWeight: v })}
        />
        <NumField
          label="Line"
          value={node.style.lineHeight ?? 1.2}
          step={0.05}
          onChange={(v) => updateTextStyle(node.id, { lineHeight: v })}
        />
        <NumField
          label="Track"
          value={node.style.letterSpacing ?? 0}
          step={0.01}
          onChange={(v) => updateTextStyle(node.id, { letterSpacing: v })}
        />
      </Grid2>
      <Row label="Color">
        <ColorField
          value={node.style.color}
          onChange={(c) => updateTextStyle(node.id, { color: c })}
        />
      </Row>
      <Row label="Align">
        <div className="flex gap-1">
          {(["left", "center", "right", "justify"] as const).map((a) => (
            <button
              key={a}
              className="editor-btn flex-1"
              data-active={node.style.textAlign === a}
              onClick={() => updateTextStyle(node.id, { textAlign: a })}
            >
              {a[0]}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Style">
        <div className="flex gap-1">
          <button
            className="editor-btn flex-1"
            data-active={node.style.italic}
            onClick={() => updateTextStyle(node.id, { italic: !node.style.italic })}
          >
            italic
          </button>
          <button
            className="editor-btn flex-1"
            data-active={node.style.textTransform === "uppercase"}
            onClick={() =>
              updateTextStyle(node.id, {
                textTransform:
                  node.style.textTransform === "uppercase" ? "none" : "uppercase",
              })
            }
          >
            UPPER
          </button>
        </div>
      </Row>
    </>
  );
}

function ImageBlock({
  node,
  updateNode,
}: {
  node: ImageNode;
  updateNode: (id: string, patch: Partial<Node>) => void;
}) {
  return (
    <>
      <SectionHead>Image</SectionHead>
      <Row label="Fit">
        <select
          className="editor-input"
          value={node.objectFit ?? "cover"}
          onChange={(e) =>
            updateNode(node.id, {
              objectFit: e.target.value as "cover" | "contain",
            })
          }
        >
          <option value="cover">cover</option>
          <option value="contain">contain</option>
        </select>
      </Row>
      <Row label="Radius">
        <input
          type="number"
          className="editor-input"
          value={node.borderRadius ?? 0}
          onChange={(e) =>
            updateNode(node.id, { borderRadius: Number(e.target.value) })
          }
        />
      </Row>
      <Row label="Alt">
        <input
          className="editor-input"
          value={node.alt ?? ""}
          onChange={(e) => updateNode(node.id, { alt: e.target.value })}
        />
      </Row>
    </>
  );
}

function ShapeBlock({
  node,
  updateNode,
}: {
  node: ShapeNode;
  updateNode: (id: string, patch: Partial<Node>) => void;
}) {
  return (
    <>
      <SectionHead>Shape</SectionHead>
      {node.shape === "rect" && (
        <Row label="Fill">
          <ColorField
            value={node.fill ?? "#000"}
            onChange={(c) => updateNode(node.id, { fill: c })}
          />
        </Row>
      )}
      <Row label="Stroke">
        <ColorField
          value={node.stroke ?? "#111"}
          onChange={(c) => updateNode(node.id, { stroke: c })}
        />
      </Row>
      <Row label="Weight">
        <input
          type="number"
          step={0.1}
          className="editor-input"
          value={node.strokeWidth ?? 1}
          onChange={(e) =>
            updateNode(node.id, { strokeWidth: Number(e.target.value) })
          }
        />
      </Row>
    </>
  );
}

function ThemeInspector({
  doc,
  setTheme,
}: {
  doc: { theme: import("@/lib/doc/types").Theme };
  setTheme: (patch: Partial<import("@/lib/doc/types").Theme>) => void;
}) {
  return (
    <div className="p-3 space-y-3 overflow-auto">
      <SectionHead>Theme · Colors</SectionHead>
      <Row label="Ink">
        <ColorField
          value={doc.theme.colors.ink}
          onChange={(c) =>
            setTheme({ colors: { ...doc.theme.colors, ink: c } })
          }
        />
      </Row>
      <Row label="Paper">
        <ColorField
          value={doc.theme.colors.paper}
          onChange={(c) =>
            setTheme({ colors: { ...doc.theme.colors, paper: c } })
          }
        />
      </Row>
      <Row label="Accent">
        <ColorField
          value={doc.theme.colors.accent}
          onChange={(c) =>
            setTheme({ colors: { ...doc.theme.colors, accent: c } })
          }
        />
      </Row>

      <SectionHead>Theme · Fonts</SectionHead>
      <p className="text-[11px] text-[var(--color-editor-text-dim)] leading-relaxed">
        Default tokens are wired up in <code>app/layout.tsx</code>. To add a new
        font, register it via <code>next/font</code> and expose a CSS variable.
      </p>
      <Row label="Display">
        <input
          className="editor-input"
          value={doc.theme.fonts.display}
          onChange={(e) =>
            setTheme({ fonts: { ...doc.theme.fonts, display: e.target.value } })
          }
        />
      </Row>
      <Row label="Sans">
        <input
          className="editor-input"
          value={doc.theme.fonts.sans}
          onChange={(e) =>
            setTheme({ fonts: { ...doc.theme.fonts, sans: e.target.value } })
          }
        />
      </Row>
      <Row label="Mono">
        <input
          className="editor-input"
          value={doc.theme.fonts.mono}
          onChange={(e) =>
            setTheme({ fonts: { ...doc.theme.fonts, mono: e.target.value } })
          }
        />
      </Row>
    </div>
  );
}

// ———————————————————————————————————————
// Tiny form primitives (kept local so the inspector reads top-to-bottom)
// ———————————————————————————————————————

function SectionHead({ children }: { children: React.ReactNode }) {
  return <div className="editor-label pt-1">{children}</div>;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="editor-label w-14 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function NumField({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number | "";
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="editor-label w-6 shrink-0">{label}</span>
      <input
        type="number"
        step={step}
        value={value === "" ? "" : Number(value.toFixed(2))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="editor-input"
      />
    </label>
  );
}

function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value.startsWith("#") ? value : "#111111"}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-8 rounded border-[var(--color-editor-border)] bg-transparent"
      />
      <input
        className="editor-input flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
