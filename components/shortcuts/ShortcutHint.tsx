"use client";

// Tiny fixed hint in the bottom-right of the home page pointing to the `?`
// cheatsheet. Intentionally low-contrast so it doesn't compete with the
// primary content; it's there for new users who wouldn't think to try `?`.

export function ShortcutHint() {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40"
      aria-hidden="true"
    >
      Press{" "}
      <kbd className="pointer-events-auto ml-1 rounded border border-ink/15 bg-paper px-1.5 py-0.5 text-[10px] text-ink/60">
        ?
      </kbd>{" "}
      for shortcuts
    </div>
  );
}
