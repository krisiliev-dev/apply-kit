import {
  formLooksLikeApplication,
  isCandidateField,
  pageLooksLikeApplication,
  toFieldContext,
} from "./fieldContext";
import { hideSuggestion, showSuggestion } from "./suggest";
import { captureAnswer, readValue, writeValue } from "./capture";
import { sendToBackground } from "../shared/message";

// Content script entry. Wires up field detection, focus/blur handlers, and a
// MutationObserver that re-scans when the app mounts fields late (SPAs).
//
// TODO: auto-submit is NEVER done from here — we only read, suggest, write the
//   value the user accepted, and capture what they actually left in the box.
// TODO: field-kind detection beyond the basic enum (rich-text editors, combobox
//   popovers, date pickers, tag inputs). For now those just fall through to text.
// TODO: cross-device sync / encryption.
// TODO: captcha & anti-bot — we don't touch those, by design.

interface WiredField {
  ctx: ReturnType<typeof toFieldContext>;
  lastSuggestion: string | null;
  /** Value at focus time — used to know whether the user actually changed it. */
  focusValue: string;
}

const wired = new WeakMap<HTMLElement, WiredField>();
const scanned = new WeakSet<HTMLFormElement>();

function shouldProcessForm(form: HTMLFormElement): boolean {
  if (scanned.has(form)) return true;
  if (pageLooksLikeApplication() || formLooksLikeApplication(form)) {
    scanned.add(form);
    return true;
  }
  return false;
}

function scan(): void {
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>("form"));
  // Also handle the (common) case of "forms" that aren't actually <form> elements.
  const standalone = pageLooksLikeApplication()
    ? Array.from(document.querySelectorAll<HTMLElement>("main, [role='main'], body"))
    : [];

  for (const form of forms) {
    if (!shouldProcessForm(form)) continue;
    wireAllFieldsIn(form);
  }
  for (const root of standalone) {
    wireAllFieldsIn(root);
  }
}

function wireAllFieldsIn(root: Element): void {
  const els = root.querySelectorAll<HTMLElement>("input, textarea, select");
  els.forEach((el) => {
    if (!isCandidateField(el)) return;
    if (wired.has(el)) return;
    const ctx = toFieldContext(el);
    wired.set(el, { ctx, lastSuggestion: null, focusValue: readValue(el) });
    el.addEventListener("focus", () => onFocus(el), { passive: true });
    el.addEventListener("blur", () => onBlur(el), { passive: true });
  });
}

async function onFocus(el: HTMLElement): Promise<void> {
  const w = wired.get(el);
  if (!w) return;
  w.focusValue = readValue(el);
  // Don't badger the user if they already typed something here.
  if (w.focusValue.trim().length > 0) return;

  const resp = await sendToBackground({
    kind: "queryByQuestion",
    field: w.ctx,
  });
  if (resp.kind !== "queryByQuestion" || !resp.match) return;
  if (document.activeElement !== el) return; // user moved on

  w.lastSuggestion = resp.match.suggestion;
  showSuggestion(el, w.ctx, resp.match, {
    onAccept: (value) => {
      writeValue(el, value);
      // Fire-and-forget: accepting a suggestion shouldn't duplicate the answer.
    },
    onEdit: (value) => {
      writeValue(el, value);
      // Treat edited-and-saved as a new answer.
      void captureAnswer(w.ctx, value);
    },
    onSkip: () => {
      /* no-op */
    },
  });
}

async function onBlur(el: HTMLElement): Promise<void> {
  const w = wired.get(el);
  if (!w) return;
  hideSuggestion();
  const current = readValue(el);
  if (!current) return;
  if (current === w.focusValue) return;
  if (current === w.lastSuggestion) return;
  await captureAnswer(w.ctx, current);
}

// Initial scan once DOM is parsed, then keep watching for SPA-added fields.
function boot(): void {
  scan();
  const mo = new MutationObserver(() => {
    // Debounce via microtask — MutationObserver can fire hard.
    queueMicrotask(scan);
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
