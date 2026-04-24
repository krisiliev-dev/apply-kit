"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  isToolUIPart,
  isFileUIPart,
  getToolName,
  type UIMessage,
  type FileUIPart,
} from "ai";
import { useEditor } from "@/lib/doc/store";
import { applyTool } from "@/lib/ai/applyTool";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";

// Docked AI chat. Streams responses, executes tool calls client-side against
// the editor store, and re-submits automatically once results are in.

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<FileUIPart[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const addFiles = async (files: FileList | File[]) => {
    const items = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (items.length === 0) return;
    const parts = await Promise.all(
      items.map(
        (f) =>
          new Promise<FileUIPart>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                type: "file",
                mediaType: f.type,
                filename: f.name,
                url: typeof reader.result === "string" ? reader.result : "",
              });
            reader.readAsDataURL(f);
          }),
      ),
    );
    setPending((p) => [...p, ...parts]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text && pending.length === 0) return;
    if (pending.length > 0) {
      sendMessage({ text: text || "(see attached)", files: pending });
    } else {
      sendMessage({ text });
    }
    setInput("");
    setPending([]);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      await addFiles(files);
    }
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

        {error && <ApiKeyHint error={error.message} />}
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-2 border-t"
        style={{ borderColor: "var(--color-editor-border)" }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          await addFiles(e.dataTransfer.files);
        }}
      >
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {pending.map((p, i) => (
              <div key={i} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.filename ?? ""}
                  className="rounded object-cover"
                  style={{
                    width: 48,
                    height: 48,
                    border: "1px solid var(--color-editor-border)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPending((list) => list.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 rounded-full"
                  style={{
                    background: "#111",
                    color: "#fff",
                    width: 16,
                    height: 16,
                    fontSize: 10,
                    lineHeight: "16px",
                  }}
                  aria-label="Remove attachment"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder={
              dragOver
                ? "drop image to attach…"
                : "describe a change — ⌘V or drop to add reference images"
            }
            className="editor-input"
            style={{
              minHeight: 68,
              resize: "none",
              paddingRight: 64,
              paddingLeft: 32,
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              borderColor: dragOver
                ? "var(--color-editor-select)"
                : "var(--color-editor-border)",
            }}
            disabled={busy}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-2 left-2 editor-btn editor-btn-ghost"
            title="Attach image"
            disabled={busy}
          >
            +
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <button
            type="submit"
            disabled={busy || (input.trim().length === 0 && pending.length === 0)}
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
          if (isFileUIPart(part) && part.mediaType.startsWith("image/")) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={part.url}
                alt={part.filename ?? ""}
                className="rounded"
                style={{
                  maxWidth: "100%",
                  maxHeight: 200,
                  border: "1px solid var(--color-editor-border)",
                }}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
