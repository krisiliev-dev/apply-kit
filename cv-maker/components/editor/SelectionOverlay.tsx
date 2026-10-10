"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Moveable, {
  type OnDrag,
  type OnDragEnd,
  type OnDragGroup,
  type OnDragGroupEnd,
  type OnResize,
  type OnResizeEnd,
  type OnResizeGroup,
  type OnResizeGroupEnd,
} from "react-moveable";
import type { Page } from "@/lib/doc/types";
import { useEditor } from "@/lib/doc/store";
import { mmToPx, pxToMm } from "@/lib/doc/units";

// Wraps react-moveable around the currently-selected node DOM element(s).
// Converts px deltas → mm model updates on drag/resize end.

export function SelectionOverlay({
  page,
  pageRef,
}: {
  page: Page;
  pageRef: RefObject<HTMLDivElement | null>;
}) {
  const selectedIds = useEditor((s) => s.selectedIds);
  const showGuides = useEditor((s) => s.showGuides);
  const editingId = useEditor((s) => s.editingId);
  const updateNode = useEditor((s) => s.updateNode);

  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const moveableRef = useRef<Moveable>(null);

  // Resolve the selected IDs to real DOM nodes inside the page. We re-query on
  // every selection/page change because React might have re-rendered nodes.
  useEffect(() => {
    if (!pageRef.current || selectedIds.length === 0) {
      setTargets([]);
      return;
    }
    const els = selectedIds
      .map((id) =>
        pageRef.current!.querySelector<HTMLElement>(`[data-node-id="${id}"]`),
      )
      .filter((el): el is HTMLElement => !!el);
    setTargets(els);
  }, [selectedIds, pageRef, page.nodes]);

  // Tell Moveable when the DOM moves (React re-renders update inline styles).
  useEffect(() => {
    moveableRef.current?.updateRect();
  });

  // Guidelines: snap to all other nodes + page edges/center.
  const pageW = mmToPx(page.width);
  const pageH = mmToPx(page.height);

  const otherElementGuidelines = useMemo(() => {
    if (!pageRef.current) return [];
    const all = Array.from(
      pageRef.current.querySelectorAll<HTMLElement>(`[data-node-id]`),
    );
    return all.filter((el) => !selectedIds.includes(el.dataset.nodeId ?? ""));
  }, [selectedIds, page.nodes, pageRef]);

  if (targets.length === 0) return null;
  if (editingId) return null; // hide handles during inline text editing

  const commitDrag = (target: HTMLElement, beforeTranslate: [number, number]) => {
    const id = target.dataset.nodeId;
    if (!id) return;
    const node = page.nodes.find((n) => n.id === id);
    if (!node) return;
    updateNode(id, {
      x: node.x + pxToMm(beforeTranslate[0]),
      y: node.y + pxToMm(beforeTranslate[1]),
    });
    // Clear transient transform so React's rendered position takes over.
    target.style.transform = "";
  };

  const commitResize = (
    target: HTMLElement,
    width: number,
    height: number,
    translate: [number, number],
  ) => {
    const id = target.dataset.nodeId;
    if (!id) return;
    const node = page.nodes.find((n) => n.id === id);
    if (!node) return;
    updateNode(id, {
      x: node.x + pxToMm(translate[0]),
      y: node.y + pxToMm(translate[1]),
      w: pxToMm(width),
      h: pxToMm(height),
    });
    target.style.transform = "";
    target.style.width = "";
    target.style.height = "";
  };

  return (
    <Moveable
      ref={moveableRef}
      target={targets as unknown as HTMLElement[]}
      draggable
      resizable
      snappable={showGuides}
      snapDirections={{
        top: true,
        left: true,
        bottom: true,
        right: true,
        center: true,
        middle: true,
      }}
      elementSnapDirections={{
        top: true,
        left: true,
        bottom: true,
        right: true,
        center: true,
        middle: true,
      }}
      snapThreshold={4}
      verticalGuidelines={showGuides ? [0, pageW / 2, pageW] : []}
      horizontalGuidelines={showGuides ? [0, pageH / 2, pageH] : []}
      elementGuidelines={showGuides ? otherElementGuidelines : []}
      keepRatio={false}
      origin={false}
      throttleDrag={0}
      edgeDraggable={false}
      renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
      // ——— single-target drag ———
      onDrag={(e: OnDrag) => {
        e.target.style.transform = e.transform;
      }}
      onDragEnd={(e: OnDragEnd) => {
        const last = e.lastEvent as OnDrag | undefined;
        if (!last) return;
        commitDrag(e.target as HTMLElement, last.beforeTranslate as [number, number]);
      }}
      // ——— group drag ———
      onDragGroup={(e: OnDragGroup) => {
        e.events.forEach((ev) => {
          ev.target.style.transform = ev.transform;
        });
      }}
      onDragGroupEnd={(e: OnDragGroupEnd) => {
        e.events.forEach((ev) => {
          const last = ev.lastEvent as OnDrag | undefined;
          if (!last) return;
          commitDrag(
            ev.target as HTMLElement,
            last.beforeTranslate as [number, number],
          );
        });
      }}
      // ——— single-target resize ———
      onResize={(e: OnResize) => {
        const t = e.target as HTMLElement;
        t.style.width = `${e.width}px`;
        t.style.height = `${e.height}px`;
        t.style.transform = e.drag.transform;
      }}
      onResizeEnd={(e: OnResizeEnd) => {
        const last = e.lastEvent as OnResize | undefined;
        if (!last) return;
        commitResize(
          e.target as HTMLElement,
          last.width,
          last.height,
          last.drag.beforeTranslate as [number, number],
        );
      }}
      // ——— group resize ———
      onResizeGroup={(e: OnResizeGroup) => {
        e.events.forEach((ev) => {
          const t = ev.target as HTMLElement;
          t.style.width = `${ev.width}px`;
          t.style.height = `${ev.height}px`;
          t.style.transform = ev.drag.transform;
        });
      }}
      onResizeGroupEnd={(e: OnResizeGroupEnd) => {
        e.events.forEach((ev) => {
          const last = ev.lastEvent as OnResize | undefined;
          if (!last) return;
          commitResize(
            ev.target as HTMLElement,
            last.width,
            last.height,
            last.drag.beforeTranslate as [number, number],
          );
        });
      }}
    />
  );
}
