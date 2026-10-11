import { useCallback, useEffect, useRef, useState } from "react";

/** How long Undo stays on screen. The design asks for at least 10 s; the hi-fi uses 15. */
export const UNDO_SECONDS = 15;
const PLAIN_SECONDS = 6;

export interface ToastOptions {
  message: string;
  /** Offers Undo with a visible countdown when given. */
  undo?: () => void;
  /** Where focus goes if the toast had it when it closes. */
  returnFocus?: () => void;
}

interface Shown extends ToastOptions {
  key: number;
}

/**
 * One polite live region that is always in the page (so screen readers announce changes to it
 * reliably), plus the visual toast. The countdown pauses while the toast is hovered or focused.
 */
export function useToaster() {
  const [live, setLive] = useState("");
  const [toast, setToast] = useState<Shown | null>(null);
  const keyRef = useRef(0);

  const announce = useCallback((msg: string) => {
    // Clear first so the same words twice in a row are still announced.
    setLive("");
    window.setTimeout(() => setLive(msg), 60);
  }, []);

  const show = useCallback((opts: ToastOptions) => {
    keyRef.current += 1;
    setToast({ ...opts, key: keyRef.current });
    announce(opts.undo ? `${opts.message} Undo is available for ${UNDO_SECONDS} seconds.` : opts.message);
  }, [announce]);

  const element = (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{live}</div>
      {toast && <Toast key={toast.key} toast={toast} onClose={() => setToast(null)} />}
    </>
  );
  return { show, announce, element };
}

function Toast({ toast, onClose }: { toast: Shown; onClose: () => void }) {
  const [left, setLeft] = useState(toast.undo ? UNDO_SECONDS : PLAIN_SECONDS);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const paused = hovered || focused;

  const close = useCallback(() => {
    const hadFocus = ref.current?.contains(document.activeElement) ?? false;
    onClose();
    if (hadFocus) toast.returnFocus?.();
  }, [onClose, toast]);

  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => setLeft((n) => n - 1), 1000);
    return () => window.clearInterval(t);
  }, [paused]);

  useEffect(() => {
    if (left <= 0) close();
  }, [left, close]);

  return (
    <div
      ref={ref}
      className="toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
    >
      <span>{toast.message}</span>
      {toast.undo && (
        <button className="btn ghost sm" type="button" onClick={() => { close(); toast.undo?.(); }}>
          Undo<span className="cd" aria-hidden="true"> · {left} s</span>
        </button>
      )}
      <button className="btn ghost sm x" type="button" aria-label="Dismiss" onClick={close}>✕</button>
    </div>
  );
}

export type Toaster = ReturnType<typeof useToaster>;
