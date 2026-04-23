"use client";

import { create, type StateCreator } from "zustand";
import { temporal } from "zundo";
import { nanoid } from "nanoid";
import type {
  CvDocument,
  Node,
  Page,
  TextNode,
  ImageNode,
  ShapeNode,
  Theme,
  TextStyle,
} from "./types";
import { defaultTheme, A4 } from "./types";

// ———————————————————————————————————————————————
// Store shape
// ———————————————————————————————————————————————

type DocState = {
  doc: CvDocument;
  selectedIds: string[];
  activePageId: string;
  editingId: string | null; // text node being edited inline
};

type UiState = {
  zoom: number;
  showGrid: boolean;
  showGuides: boolean;
};

type Actions = {
  // doc lifecycle
  loadDoc: (doc: CvDocument) => void;
  setTheme: (patch: Partial<Theme>) => void;
  setTargetRole: (role: string) => void;

  // selection
  select: (ids: string[] | string | null) => void;
  toggleSelect: (id: string) => void;
  deselect: () => void;

  // inline text edit
  startEdit: (id: string) => void;
  stopEdit: () => void;

  // nodes
  addNode: (node: NodeInput) => string;
  updateNode: (id: string, patch: Partial<Node>) => void;
  updateTextStyle: (id: string, patch: Partial<TextStyle>) => void;
  deleteNodes: (ids?: string[]) => void;
  duplicateNodes: (ids?: string[]) => void;
  nudgeNodes: (dx: number, dy: number, ids?: string[]) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  // ui
  setZoom: (z: number) => void;
  setShowGrid: (v: boolean) => void;
  setShowGuides: (v: boolean) => void;
};

export type Store = DocState & UiState & Actions;

// Distributive Omit so discriminated-union members keep their own shapes.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type NodeInput = DistributiveOmit<Node, "id" | "z"> & {
  id?: string;
  z?: number;
};

// ———————————————————————————————————————————————
// Helpers
// ———————————————————————————————————————————————

const emptyDoc = (): CvDocument => ({
  slug: "untitled",
  targetRole: "Untitled",
  pages: [
    {
      id: nanoid(8),
      width: A4.width,
      height: A4.height,
      nodes: [],
    },
  ],
  theme: defaultTheme,
  updatedAt: Date.now(),
});

function updatePages(
  doc: CvDocument,
  pageId: string,
  fn: (p: Page) => Page,
): CvDocument {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === pageId ? fn(p) : p)),
    updatedAt: Date.now(),
  };
}

function nextZ(nodes: Node[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.z), 0) + 1;
}

// ———————————————————————————————————————————————
// Store creator
// ———————————————————————————————————————————————

const creator: StateCreator<Store> = (set, get) => {
  const initial = emptyDoc();
  return {
    doc: initial,
    activePageId: initial.pages[0].id,
    selectedIds: [],
    editingId: null,

    zoom: 1,
    showGrid: false,
    showGuides: true,

    loadDoc: (doc) =>
      set({
        doc,
        activePageId: doc.pages[0]?.id ?? "",
        selectedIds: [],
      }),

    setTheme: (patch) =>
      set((s) => ({
        doc: {
          ...s.doc,
          theme: {
            fonts: { ...s.doc.theme.fonts, ...patch.fonts },
            colors: { ...s.doc.theme.colors, ...patch.colors },
          },
          updatedAt: Date.now(),
        },
      })),

    setTargetRole: (role) =>
      set((s) => ({ doc: { ...s.doc, targetRole: role, updatedAt: Date.now() } })),

    select: (ids) =>
      set({
        selectedIds: Array.isArray(ids) ? ids : ids ? [ids] : [],
      }),

    toggleSelect: (id) =>
      set((s) => ({
        selectedIds: s.selectedIds.includes(id)
          ? s.selectedIds.filter((x) => x !== id)
          : [...s.selectedIds, id],
      })),

    deselect: () => set({ selectedIds: [] }),

    startEdit: (id) => set({ editingId: id, selectedIds: [id] }),
    stopEdit: () => set({ editingId: null }),

    addNode: (partial) => {
      const id = (partial as { id?: string }).id ?? nanoid(8);
      const { activePageId, doc } = get();
      const page = doc.pages.find((p) => p.id === activePageId)!;
      const node = {
        ...partial,
        id,
        z: (partial as { z?: number }).z ?? nextZ(page.nodes),
      } as Node;
      set({
        doc: updatePages(doc, activePageId, (p) => ({
          ...p,
          nodes: [...p.nodes, node],
        })),
        selectedIds: [id],
      });
      return id;
    },

    updateNode: (id, patch) =>
      set((s) => ({
        doc: updatePages(s.doc, s.activePageId, (p) => ({
          ...p,
          nodes: p.nodes.map((n) =>
            n.id === id ? ({ ...n, ...patch } as Node) : n,
          ),
        })),
      })),

    updateTextStyle: (id, patch) =>
      set((s) => ({
        doc: updatePages(s.doc, s.activePageId, (p) => ({
          ...p,
          nodes: p.nodes.map((n) => {
            if (n.id !== id || n.type !== "text") return n;
            return { ...n, style: { ...n.style, ...patch } } satisfies TextNode;
          }),
        })),
      })),

    deleteNodes: (ids) => {
      const toDelete = ids ?? get().selectedIds;
      if (toDelete.length === 0) return;
      set((s) => ({
        doc: updatePages(s.doc, s.activePageId, (p) => ({
          ...p,
          nodes: p.nodes.filter((n) => !toDelete.includes(n.id)),
        })),
        selectedIds: [],
      }));
    },

    duplicateNodes: (ids) => {
      const source = ids ?? get().selectedIds;
      if (source.length === 0) return;
      const { doc, activePageId } = get();
      const page = doc.pages.find((p) => p.id === activePageId)!;
      const originals = page.nodes.filter((n) => source.includes(n.id));
      const newNodes: Node[] = originals.map((n) => ({
        ...n,
        id: nanoid(8),
        x: n.x + 4,
        y: n.y + 4,
        z: nextZ(page.nodes),
      }));
      set({
        doc: updatePages(doc, activePageId, (p) => ({
          ...p,
          nodes: [...p.nodes, ...newNodes],
        })),
        selectedIds: newNodes.map((n) => n.id),
      });
    },

    nudgeNodes: (dx, dy, ids) => {
      const targets = ids ?? get().selectedIds;
      if (targets.length === 0) return;
      set((s) => ({
        doc: updatePages(s.doc, s.activePageId, (p) => ({
          ...p,
          nodes: p.nodes.map((n) =>
            targets.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n,
          ),
        })),
      }));
    },

    bringForward: (id) =>
      set((s) => ({
        doc: updatePages(s.doc, s.activePageId, (p) => ({
          ...p,
          nodes: p.nodes.map((n) =>
            n.id === id ? { ...n, z: nextZ(p.nodes) } : n,
          ),
        })),
      })),

    sendBackward: (id) =>
      set((s) => ({
        doc: updatePages(s.doc, s.activePageId, (p) => {
          const minZ = p.nodes.reduce((m, n) => Math.min(m, n.z), Infinity);
          return {
            ...p,
            nodes: p.nodes.map((n) => (n.id === id ? { ...n, z: minZ - 1 } : n)),
          };
        }),
      })),

    setZoom: (zoom) => set({ zoom: Math.max(0.2, Math.min(3, zoom)) }),
    setShowGrid: (v) => set({ showGrid: v }),
    setShowGuides: (v) => set({ showGuides: v }),
  };
};

// Only the doc goes into the undo/redo stack. Selection, zoom, etc. don't.
export const useEditor = create<Store>()(
  temporal(creator, {
    partialize: (state) => ({ doc: state.doc }) as Pick<Store, "doc">,
    limit: 100,
    equality: (a, b) => a.doc.updatedAt === b.doc.updatedAt,
  }),
);

// Typed narrowers
export const isTextNode = (n: Node): n is TextNode => n.type === "text";
export const isImageNode = (n: Node): n is ImageNode => n.type === "image";
export const isShapeNode = (n: Node): n is ShapeNode => n.type === "shape";
