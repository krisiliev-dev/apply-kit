"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Global keyboard-shortcut cheatsheet overlay.
//
// Press `?` (Shift+/) anywhere in the app (except inside text inputs,
// textareas, contenteditable regions) to open. Press Escape or click the
// backdrop to close.
//
// Shortcuts are grouped by area. Keep the list here — the source of truth is
// a bundled constant, not a registry. When you add a real shortcut, add an
// entry so users discover it.

type ShortcutRow = {
  keys: string[];
  description: string;
};

type ShortcutGroup = {
  title: string;
  rows: ShortcutRow[];
};

const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Global",
    rows: [
      { keys: ["?"], description: "Toggle this cheatsheet" },
      { keys: ["Esc"], description: "Close overlays · deselect" },
      { keys: ["⌘", "K"], description: "Command palette (where available)" },
    ],
  },
  {
    title: "Editor",
    rows: [
      { keys: ["Click"], description: "Select a node" },
      { keys: ["Shift", "Click"], description: "Extend selection" },
      { keys: ["Drag"], description: "Move selected node(s)" },
      { keys: ["⌘", "Z"], description: "Undo" },
      { keys: ["⌘", "Shift", "Z"], description: "Redo" },
      { keys: ["⌘", "D"], description: "Duplicate selected node(s)" },
      { keys: ["Del"], description: "Delete selected node(s)" },
      { keys: ["Esc"], description: "Deselect" },
      { keys: ["⌘", "Scroll"], description: "Zoom the canvas" },
      { keys: ["Double-click"], description: "Edit text inline" },
    ],
  },
  {
    title: "Applications",
    rows: [
      { keys: ["N"], description: "New application (from list view)" },
      { keys: ["↑", "↓"], description: "Move through applications" },
      { keys: ["Enter"], description: "Open selected application" },
      { keys: ["/"], description: "Focus the filter / search" },
    ],
  },
  {
    title: "Discover",
    rows: [
      { keys: ["R"], description: "Refresh feeds" },
      { keys: ["S"], description: "Save job to inbox" },
      { keys: ["J", "K"], description: "Next · previous posting" },
    ],
  },
  {
    title: "Advisor · Pair",
    rows: [
      { keys: ["⌘", "Enter"], description: "Send chat message" },
      { keys: ["↑"], description: "Recall last prompt (in chat input)" },
    ],
  },
];

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return false;
}

export function Cheatsheet() {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Global key handler — `?` to open, Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
        return;
      }
      // `?` = Shift+/ on US layouts. Use `e.key === "?"` which works across
      // layouts that produce the literal character.
      if (!open && e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Focus management: capture the previously-focused element so we can
  // restore focus on close, and focus the close button when the sheet opens.
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      // defer to next tick so the button exists
      const id = window.setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(id);
    }
    previouslyFocusedRef.current?.focus?.();
    return undefined;
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={close}
    >
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        aria-hidden="true"
      />
      <div
        className="relative z-[101] max-h-[85vh] w-[min(720px,92vw)] overflow-auto rounded-lg border border-ink/15 bg-paper p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
              Keyboard shortcuts
            </p>
            <h2 className="mt-1 font-display text-3xl">
              Every key that does something.
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink underline decoration-ink/20 underline-offset-4"
          >
            Close (Esc)
          </button>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {SHORTCUTS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
                {group.title}
              </h3>
              <ul className="divide-y divide-ink/10 border-y border-ink/10">
                {group.rows.map((row, i) => (
                  <li
                    key={`${group.title}-${i}`}
                    className="flex items-center justify-between gap-4 py-2.5"
                  >
                    <span className="text-sm text-ink/80">
                      {row.description}
                    </span>
                    <span className="flex gap-1">
                      {row.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="min-w-[1.75rem] rounded border border-ink/20 bg-paper px-1.5 py-0.5 text-center font-mono text-[11px] text-ink/80 shadow-[0_1px_0_rgba(0,0,0,0.08)]"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
          Press <kbd className="px-1">?</kbd> anywhere to reopen this sheet.
        </p>
      </div>
    </div>
  );
}
