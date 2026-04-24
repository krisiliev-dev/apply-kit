"use client";

import { useRef, useState } from "react";
import type { Page, Theme } from "@/lib/doc/types";
import { NodeView } from "./NodeView";
import { useEditor } from "@/lib/doc/store";
import { SelectionOverlay } from "./SelectionOverlay";
import { ParserOverlay } from "./ParserOverlay";

export function PageView({
  page,
  theme,
}: {
  page: Page;
  theme: Theme;
}) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const selectedIds = useEditor((s) => s.selectedIds);
  const showGrid = useEditor((s) => s.showGrid);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const deselect = useEditor((s) => s.deselect);

  const handleNodeSelect = (id: string, additive: boolean) => {
    if (additive) toggleSelect(id);
    else select(id);
  };

  // Click on blank page area deselects.
  const handlePageMouseDown = (e: React.MouseEvent) => {
    if (e.target === pageRef.current) deselect();
  };

  return (
    <div
      ref={pageRef}
      className="cv-page"
      data-grid={showGrid ? "true" : "false"}
      style={{
        width: `${page.width}mm`,
        height: `${page.height}mm`,
        background: page.background ?? theme.colors.paper,
        color: theme.colors.ink,
      }}
      onMouseDown={handlePageMouseDown}
    >
      {[...page.nodes]
        .sort((a, b) => a.z - b.z)
        .map((n) => (
          <NodeView
            key={n.id}
            node={n}
            theme={theme}
            selected={selectedIds.includes(n.id)}
            hovered={hoverId === n.id}
            onSelect={handleNodeSelect}
            onHoverChange={setHoverId}
          />
        ))}

      <SelectionOverlay page={page} pageRef={pageRef} />
      <ParserOverlay page={page} />
    </div>
  );
}
