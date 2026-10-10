// Document model for the editor.
// A CV is one or more Pages of freely-positioned Nodes. All coordinates are in
// millimeters so the model is resolution-independent and prints cleanly to A4.

export type FontToken = "display" | "sans" | "mono";

export type TextStyle = {
  fontToken?: FontToken; // when set, uses the theme font; otherwise use fontFamily
  fontFamily?: string; // raw CSS font-family (for custom fonts)
  fontSize: number; // px
  fontWeight: number;
  italic?: boolean;
  color: string; // CSS color
  lineHeight?: number;
  letterSpacing?: number; // em
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textAlign?: "left" | "center" | "right" | "justify";
};

export type NodeBase = {
  id: string;
  name?: string; // shown in layers panel
  x: number; // mm from page left
  y: number; // mm from page top
  w: number; // mm
  h: number; // mm
  z: number; // stacking order
  rotation?: number; // deg
  locked?: boolean;
  hidden?: boolean;
  opacity?: number; // 0–1
};

export type TextNode = NodeBase & {
  type: "text";
  content: string; // plain text for now; newlines preserved
  style: TextStyle;
  // ————————————————————————————————————————————
  // Proof-of-work slot. "Bullet" text nodes (experience lines, •-prefixed
  // items, lines like `Exp:<company> bullet`) are expected to link to an
  // artifact — a commit, a published piece, a dashboard. An empty `proofUrl`
  // on a `proofRequired` node surfaces a warning in the evaluator and a
  // subtle pill on the canvas.
  //
  // `proofRequired` is inferred by heuristic on every doc change (see
  // `lib/evaluation/proofInspector.ts`). If the user explicitly sets this
  // false via the Inspector, the heuristic stops setting it back to true.
  // ————————————————————————————————————————————
  proofUrl?: string;
  proofLabel?: string;
  proofRequired?: boolean;
};

export type ImageNode = NodeBase & {
  type: "image";
  src: string; // data URL or http URL
  alt?: string;
  objectFit?: "cover" | "contain";
  borderRadius?: number; // px
};

export type ShapeKind = "rect" | "line";

export type ShapeNode = NodeBase & {
  type: "shape";
  shape: ShapeKind;
  fill?: string;
  stroke?: string;
  strokeWidth?: number; // px
};

export type Node = TextNode | ImageNode | ShapeNode;

export type Page = {
  id: string;
  width: number; // mm
  height: number; // mm
  background?: string;
  nodes: Node[];
};

export type Theme = {
  fonts: {
    display: string; // CSS font-family value
    sans: string;
    mono: string;
  };
  colors: {
    ink: string;
    paper: string;
    accent: string;
  };
};

// ————————————————————————————————————————————
// Inline document comments. Google-Docs-style side notes anchored to a node.
// Humans leave them. The AI copilot reads active (unresolved) comments on
// each turn and can act on them — including resolving one after a fix or
// leaving its own response comment.
//
// `comments` is optional on existing persisted documents; absence is treated
// as an empty array — no migration step required.
// ————————————————————————————————————————————

export type DocComment = {
  id: string;
  /** The node this comment is anchored to. */
  nodeId: string;
  /** The comment body. */
  body: string;
  /** Optional selected text range inside the node, as a character offset. */
  range?: { start: number; end: number };
  createdAt: number;
  resolvedAt?: number;
  /** Who left it — distinguishes user vs. AI-left notes. */
  author: "user" | "ai";
};

export type CvDocument = {
  slug: string;
  targetRole: string;
  pages: Page[];
  theme: Theme;
  updatedAt: number;
  /**
   * Inline doc comments. Absent on older persisted docs — callers should
   * treat undefined as `[]`. Mutations flow through the store so they're
   * included in undo/redo.
   */
  comments?: DocComment[];
};

export const defaultTheme: Theme = {
  fonts: {
    display: "var(--font-instrument-serif)",
    sans: "var(--font-inter)",
    mono: "var(--font-jetbrains-mono)",
  },
  colors: {
    ink: "#111111",
    paper: "#fafaf7",
    accent: "#d64933",
  },
};

export const A4 = { width: 210, height: 297 } as const;
