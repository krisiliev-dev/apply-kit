import type { CvDocument, Node, TextNode } from "./types";

// ————————————————————————————————————————————————
// Doc diff primitives.
//
// The /cv/compare view answers one question at a glance: "what changed between
// variant A and variant B?". We group by the node's `name` (user-assigned
// layer name, which for seeded CVs is stable — e.g. "Experience heading",
// "Exp:Acme bullet") plus a content fingerprint so the same-named but
// differently-worded bullets don't collapse together.
//
// Output is a per-group list of items the caller can render in three columns.
// ————————————————————————————————————————————————

export type CompareItem = {
  /** Normalized bucket key used for grouping. */
  key: string;
  /** Human label shown in the UI. Falls back to the node type. */
  label: string;
  /** Content summary used in the unique/shared lists. */
  preview: string;
  source: "A" | "B" | "both";
};

export type CompareSummary = {
  onlyInA: CompareItem[];
  onlyInB: CompareItem[];
  shared: CompareItem[];
  /** Total counts — cheaper to read than `onlyInA.length` repeatedly. */
  counts: {
    a: number;
    b: number;
    onlyA: number;
    onlyB: number;
    shared: number;
  };
};

type Fingerprint = {
  key: string;
  label: string;
  preview: string;
};

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?·—–-]/g, "")
    .trim();
}

function previewOf(node: Node): string {
  if (node.type === "text") {
    const t = node.content.trim().replace(/\s+/g, " ");
    return t.length > 80 ? `${t.slice(0, 77)}…` : t;
  }
  if (node.type === "image") return `[image ${node.alt ?? ""}]`.trim();
  return `[shape ${node.shape}]`;
}

function fingerprintFor(node: Node): Fingerprint {
  const label = node.name?.trim() || defaultLabelFor(node);
  if (node.type === "text") {
    const t = (node as TextNode).content;
    const normalized = normalizeText(t);
    // Short labels — e.g. bullets — share a group only if text is very close.
    // Long headings/body copy grouped by label + content prefix.
    const prefix = normalized.slice(0, 48);
    return {
      key: `${label.toLowerCase()}::${prefix}`,
      label,
      preview: previewOf(node),
    };
  }
  if (node.type === "image") {
    return {
      key: `image::${(node.alt ?? "").toLowerCase()}::${node.src.slice(0, 24)}`,
      label,
      preview: previewOf(node),
    };
  }
  return {
    key: `shape::${node.shape}::${node.fill ?? ""}::${node.stroke ?? ""}`,
    label,
    preview: previewOf(node),
  };
}

function defaultLabelFor(node: Node): string {
  if (node.type === "text") return "text";
  if (node.type === "image") return "image";
  return node.shape;
}

function collectNodes(doc: CvDocument): Node[] {
  const out: Node[] = [];
  for (const p of doc.pages) {
    for (const n of p.nodes) {
      if (n.hidden) continue;
      out.push(n);
    }
  }
  return out;
}

export function compareDocs(
  a: CvDocument,
  b: CvDocument,
): CompareSummary {
  const fromA = collectNodes(a).map(fingerprintFor);
  const fromB = collectNodes(b).map(fingerprintFor);

  const mapA = new Map<string, Fingerprint>();
  const mapB = new Map<string, Fingerprint>();
  for (const f of fromA) if (!mapA.has(f.key)) mapA.set(f.key, f);
  for (const f of fromB) if (!mapB.has(f.key)) mapB.set(f.key, f);

  const onlyInA: CompareItem[] = [];
  const onlyInB: CompareItem[] = [];
  const shared: CompareItem[] = [];

  for (const [key, f] of mapA.entries()) {
    if (mapB.has(key)) {
      shared.push({ key, label: f.label, preview: f.preview, source: "both" });
    } else {
      onlyInA.push({ key, label: f.label, preview: f.preview, source: "A" });
    }
  }
  for (const [key, f] of mapB.entries()) {
    if (!mapA.has(key)) {
      onlyInB.push({ key, label: f.label, preview: f.preview, source: "B" });
    }
  }

  // Stable alphabetical display order — labels first, then preview.
  const byLabel = (x: CompareItem, y: CompareItem) =>
    x.label.localeCompare(y.label) || x.preview.localeCompare(y.preview);
  onlyInA.sort(byLabel);
  onlyInB.sort(byLabel);
  shared.sort(byLabel);

  return {
    onlyInA,
    onlyInB,
    shared,
    counts: {
      a: mapA.size,
      b: mapB.size,
      onlyA: onlyInA.length,
      onlyB: onlyInB.length,
      shared: shared.length,
    },
  };
}

// ————————————————————————————————————————————————
// Doc stats — used by the summary card under each preview.
// ————————————————————————————————————————————————

export type DocStats = {
  totalNodes: number;
  textNodes: number;
  wordCount: number;
};

export function statsFor(doc: CvDocument): DocStats {
  let total = 0;
  let textNodes = 0;
  let wordCount = 0;
  for (const p of doc.pages) {
    for (const n of p.nodes) {
      total += 1;
      if (n.type === "text") {
        textNodes += 1;
        wordCount += n.content.split(/\s+/).filter(Boolean).length;
      }
    }
  }
  return { totalNodes: total, textNodes, wordCount };
}
