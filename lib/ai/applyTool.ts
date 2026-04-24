"use client";

import { z } from "zod";
import { useEditor } from "@/lib/doc/store";
import { defaultTheme } from "@/lib/doc/types";
import { toolSchemas, type ToolName } from "./tools";

// Applies a tool call from the model to the client-side document store.
// Returns a small JSON-friendly result the model can read back.

type ApplyResult =
  | { ok: true; id?: string; ids?: string[]; message?: string }
  | { ok: false; error: string };

export function applyTool(name: string, rawInput: unknown): ApplyResult {
  const toolName = name as ToolName;
  const schema = toolSchemas[toolName] as z.ZodTypeAny | undefined;
  if (!schema) return { ok: false, error: `Unknown tool: ${name}` };

  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }
  const input = parsed.data;
  const store = useEditor.getState();

  switch (toolName) {
    case "addText": {
      const { content, x, y, w, h, name: nodeName, style } = input as z.infer<
        typeof toolSchemas.addText
      >;
      const id = store.addNode({
        type: "text",
        name: nodeName,
        x,
        y,
        w,
        h,
        content,
        style: {
          fontToken: style?.fontToken ?? "sans",
          fontFamily: style?.fontFamily,
          fontSize: style?.fontSize ?? 12,
          fontWeight: style?.fontWeight ?? 400,
          italic: style?.italic,
          color: style?.color ?? defaultTheme.colors.ink,
          lineHeight: style?.lineHeight,
          letterSpacing: style?.letterSpacing,
          textTransform: style?.textTransform,
          textAlign: style?.textAlign,
        },
      });
      return { ok: true, id, message: "Added text node" };
    }

    case "addImage": {
      const { x, y, w, h, placeholder, alt, name: nodeName } = input as z.infer<
        typeof toolSchemas.addImage
      >;
      const id = store.addNode({
        type: "image",
        name: nodeName ?? (placeholder ? "Image placeholder" : "Image"),
        x,
        y,
        w,
        h,
        src: "",
        alt,
        objectFit: "cover",
      });
      return {
        ok: true,
        id,
        message: placeholder
          ? "Added image placeholder — user will upload source."
          : "Added image node",
      };
    }

    case "addShape": {
      const {
        shape,
        x,
        y,
        w,
        h,
        fill,
        stroke,
        strokeWidth,
        name: nodeName,
      } = input as z.infer<typeof toolSchemas.addShape>;
      const id = store.addNode({
        type: "shape",
        shape,
        name: nodeName,
        x,
        y,
        w,
        h,
        fill,
        stroke,
        strokeWidth,
      });
      return { ok: true, id, message: `Added ${shape}` };
    }

    case "updateNodeTransform": {
      const { id, patch } = input as z.infer<typeof toolSchemas.updateNodeTransform>;
      store.updateNode(id, patch);
      return { ok: true, id, message: "Updated transform" };
    }

    case "updateTextContent": {
      const { id, content } = input as z.infer<typeof toolSchemas.updateTextContent>;
      store.updateNode(id, { content } as Parameters<typeof store.updateNode>[1]);
      return { ok: true, id, message: "Updated text content" };
    }

    case "updateTextStyle": {
      const { id, style } = input as z.infer<typeof toolSchemas.updateTextStyle>;
      store.updateTextStyle(id, style);
      return { ok: true, id, message: "Updated text style" };
    }

    case "deleteNode": {
      const { ids } = input as z.infer<typeof toolSchemas.deleteNode>;
      store.deleteNodes(ids);
      return { ok: true, ids, message: `Deleted ${ids.length} node(s)` };
    }

    case "duplicateNode": {
      const { ids } = input as z.infer<typeof toolSchemas.duplicateNode>;
      store.duplicateNodes(ids);
      return { ok: true, ids, message: `Duplicated ${ids.length} node(s)` };
    }

    case "setTheme": {
      const { colors, fonts } = input as z.infer<typeof toolSchemas.setTheme>;
      store.setTheme({
        colors: colors
          ? { ...store.doc.theme.colors, ...colors }
          : undefined,
        fonts: fonts ? { ...store.doc.theme.fonts, ...fonts } : undefined,
      });
      return { ok: true, message: "Updated theme" };
    }

    case "resolveComment": {
      const { commentId } = input as z.infer<typeof toolSchemas.resolveComment>;
      const existing = (store.doc.comments ?? []).find(
        (c) => c.id === commentId,
      );
      if (!existing) {
        return { ok: false, error: `No comment with id ${commentId}` };
      }
      if (existing.resolvedAt) {
        return { ok: true, id: commentId, message: "Comment already resolved" };
      }
      store.resolveComment(commentId);
      return { ok: true, id: commentId, message: "Resolved comment" };
    }

    case "addComment": {
      const { nodeId, body, range } = input as z.infer<
        typeof toolSchemas.addComment
      >;
      const nodeExists = store.doc.pages.some((p) =>
        p.nodes.some((n) => n.id === nodeId),
      );
      if (!nodeExists) {
        return { ok: false, error: `No node with id ${nodeId}` };
      }
      const id = store.addComment({ nodeId, body, range, author: "ai" });
      return { ok: true, id, message: "Added comment" };
    }
  }
}
