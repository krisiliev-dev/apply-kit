import {
  streamText,
  convertToModelMessages,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { buildSystemPrompt } from "@/lib/ai/system";
import { toolSchemas } from "@/lib/ai/tools";
import type { CvDocument } from "@/lib/doc/types";
import type { Settings } from "@/lib/settings/types";
import {
  resolveForRoute,
  respondProviderError,
  streamingUsageHeader,
} from "@/lib/ai/route";

// Client-executed tools: we declare them here *without* an execute function so
// the model emits tool calls the client will handle (the doc lives in the
// browser). The client receives each call via the `onToolCall` callback and
// returns a result.

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  messages: UIMessage[];
  document: CvDocument;
  selectedIds: string[];
  settings?: Settings;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const { messages, document, selectedIds } = body;

  let resolved;
  try {
    resolved = resolveForRoute("chat", body);
  } catch (err) {
    return respondProviderError(err, { feature: "chat", settings: body?.settings });
  }

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: resolved.model,
    system: buildSystemPrompt(document, selectedIds ?? []),
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    tools: {
      addText: tool({
        description: "Add a text node to the page.",
        inputSchema: toolSchemas.addText,
      }),
      addImage: tool({
        description:
          "Add an image frame. If placeholder is true, leaves the image empty so the user uploads one.",
        inputSchema: toolSchemas.addImage,
      }),
      addShape: tool({
        description: "Add a decorative rectangle or horizontal line.",
        inputSchema: toolSchemas.addShape,
      }),
      updateNodeTransform: tool({
        description: "Move or resize a node by id.",
        inputSchema: toolSchemas.updateNodeTransform,
      }),
      updateTextContent: tool({
        description: "Change the text content of a text node.",
        inputSchema: toolSchemas.updateTextContent,
      }),
      updateTextStyle: tool({
        description:
          "Change typography (font token, size, weight, color, alignment, tracking, etc.) of a text node.",
        inputSchema: toolSchemas.updateTextStyle,
      }),
      deleteNode: tool({
        description: "Delete one or more nodes by id.",
        inputSchema: toolSchemas.deleteNode,
      }),
      duplicateNode: tool({
        description: "Duplicate one or more nodes by id.",
        inputSchema: toolSchemas.duplicateNode,
      }),
      setTheme: tool({
        description:
          "Update global theme colors or font family variables. Use CSS custom property strings for fonts (e.g. 'var(--font-inter)').",
        inputSchema: toolSchemas.setTheme,
      }),
      resolveComment: tool({
        description:
          "Mark an inline doc comment as resolved. Call this after you've made the change the comment asked for.",
        inputSchema: toolSchemas.resolveComment,
      }),
      addComment: tool({
        description:
          "Leave your own inline comment on a node (author is recorded as 'ai'). Use sparingly — only when you want to flag a tradeoff or ask the user a question that blocks a change.",
        inputSchema: toolSchemas.addComment,
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    headers: streamingUsageHeader({
      feature: resolved.feature,
      choice: resolved.choice,
    }),
  });
}
