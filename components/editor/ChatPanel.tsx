"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  isToolUIPart,
  getToolName,
  type UIMessage,
} from "ai";
import { useEditor } from "@/lib/doc/store";
import { applyTool } from "@/lib/ai/applyTool";

// Docked AI chat. Streams responses, executes tool calls client-side against
// the editor store, and re-submits automatically once results are in.

export function ChatPanel() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // DefaultChatTransport reads fresh doc state on every send via
  // prepareSendMessagesRequest, so the model always sees what's on screen.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            messages,
            document: useEditor.getState().doc,
            selectedIds: useEditor.getState().selectedIds,
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, addToolResult } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      const result = applyTool(toolCall.toolName, toolCall.input);
      // Feed the result back so the model sees what happened.
      await addToolResult({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: result,
      });
    },
  });

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--color-editor-border)" }}
      >
        <span className="editor-label">Copilot</span>
        <span
          className="editor-label"
          style={{
            color:
              status === "error"
                ? "#ff6b6b"
                : busy
                  ? "#4f8cff"
                  : "var(--color-editor-text-dim)",
          }}
        >
          {status === "error" ? "error" : busy ? "thinking…" : "ready"}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3 text-[12px] leading-relaxed text-[var(--color-editor-text-dim)]">
            <p>
              Ask me to change anything on the page. Examples:
            </p>
            <ul className="space-y-1 pl-3">
              <li>• &quot;Make the name 20% larger and tighter tracking.&quot;</li>
              <li>• &quot;Move the experience section up by 8mm.&quot;</li>
              <li>• &quot;Add a thin red line under the masthead.&quot;</li>
              <li>
                • &quot;Change the display font to something more editorial.&quot;
              </li>
            </ul>
          </div>
        )}

        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}

        {error && (
          <div
            className="text-[11px] px-3 py-2 rounded"
            style={{
              background: "rgba(255,107,107,0.15)",
              color: "#ff9a9a",
              border: "1px solid rgba(255,107,107,0.3)",
            }}
          >
            {error.message.includes("ANTHROPIC_API_KEY") ||
            error.message.includes("400") ? (
              <>
                Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to{" "}
                <code>.env.local</code> and restart the dev server.
              </>
            ) : (
              error.message
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-2 border-t"
        style={{ borderColor: "var(--color-editor-border)" }}
      >
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Describe a change…"
            className="editor-input"
            style={{
              minHeight: 68,
              resize: "none",
              paddingRight: 64,
              fontFamily: "var(--font-sans)",
              fontSize: 12,
            }}
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="editor-btn absolute bottom-2 right-2"
          >
            send
          </button>
        </div>
      </form>
    </div>
  );
}

// ———————————————————————————————————————
// Message rendering
// ———————————————————————————————————————

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className="space-y-1">
      <div
        className="editor-label"
        style={{ color: "var(--color-editor-text-dim)" }}
      >
        {isUser ? "you" : "copilot"}
      </div>
      <div className="space-y-2 text-[12px] leading-relaxed">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <p key={i} style={{ whiteSpace: "pre-wrap" }}>
                {part.text}
              </p>
            );
          }
          if (isToolUIPart(part)) {
            const name = getToolName(part);
            return (
              <div
                key={i}
                className="font-mono text-[10.5px] px-2 py-1 rounded"
                style={{
                  background: "rgba(79, 140, 255, 0.12)",
                  color: "#a8c4ff",
                  border: "1px solid rgba(79, 140, 255, 0.25)",
                }}
              >
                <div className="opacity-70">tool · {name} · {part.state}</div>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
