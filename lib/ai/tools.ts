import { z } from "zod";

// Shared tool schemas used by both the server (for model-facing tool defs)
// and the client (for type-safe execution against the doc store).

export const fontTokenSchema = z.enum(["display", "sans", "mono"]);

export const textStylePatchSchema = z
  .object({
    fontToken: fontTokenSchema.optional(),
    fontFamily: z.string().optional(),
    fontSize: z.number().positive().optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
    italic: z.boolean().optional(),
    color: z.string().optional(),
    lineHeight: z.number().positive().optional(),
    letterSpacing: z.number().optional(),
    textTransform: z
      .enum(["none", "uppercase", "lowercase", "capitalize"])
      .optional(),
    textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  })
  .describe("Partial update to a text node's typography.");

export const addTextInput = z.object({
  content: z.string(),
  x: z.number().describe("X position in mm from the page's left edge."),
  y: z.number().describe("Y in mm from the top edge."),
  w: z.number().positive().describe("Width in mm."),
  h: z.number().positive().describe("Height in mm."),
  name: z.string().optional(),
  style: textStylePatchSchema.optional(),
});

export const addImageInput = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  placeholder: z.boolean().optional().describe("If true, leave src empty so the user sees a placeholder."),
  alt: z.string().optional(),
  name: z.string().optional(),
});

export const addShapeInput = z.object({
  shape: z.enum(["rect", "line"]),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  name: z.string().optional(),
});

export const transformPatchSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  rotation: z.number().optional(),
});

export const updateNodeTransformInput = z.object({
  id: z.string().describe("Node ID. Use getDocumentState to list IDs."),
  patch: transformPatchSchema,
});

export const updateTextContentInput = z.object({
  id: z.string(),
  content: z.string(),
});

export const updateTextStyleInput = z.object({
  id: z.string(),
  style: textStylePatchSchema,
});

export const deleteNodeInput = z.object({
  ids: z.array(z.string()).min(1),
});

export const duplicateNodeInput = z.object({
  ids: z.array(z.string()).min(1),
});

export const setThemeInput = z.object({
  colors: z
    .object({
      ink: z.string().optional(),
      paper: z.string().optional(),
      accent: z.string().optional(),
    })
    .optional(),
  fonts: z
    .object({
      display: z.string().optional(),
      sans: z.string().optional(),
      mono: z.string().optional(),
    })
    .optional(),
});

export const toolSchemas = {
  addText: addTextInput,
  addImage: addImageInput,
  addShape: addShapeInput,
  updateNodeTransform: updateNodeTransformInput,
  updateTextContent: updateTextContentInput,
  updateTextStyle: updateTextStyleInput,
  deleteNode: deleteNodeInput,
  duplicateNode: duplicateNodeInput,
  setTheme: setThemeInput,
} as const;

export type ToolName = keyof typeof toolSchemas;
