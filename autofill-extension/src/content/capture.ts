import type { FieldContext } from "../shared/types";
import { sendToBackground } from "../shared/message";

// Capture the value the user ended up with and push it to the store.
// Called on blur, and whenever a field's value changed without matching
// the suggested value that was offered.

export async function captureAnswer(
  field: FieldContext,
  value: string,
): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) return;
  // Skip unreasonably short strings for non-single-char fields (e.g. empty checkbox noise).
  if (trimmed.length < 1) return;

  const resp = await sendToBackground({
    kind: "saveAnswer",
    field,
    value: trimmed,
    url: location.href,
  });
  if (resp.kind === "error") {
    console.warn("[cv-autofill] saveAnswer failed", resp.message);
  }
}

export function readValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") {
      return el.checked ? el.value || "on" : "";
    }
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) {
    const opt = el.selectedOptions[0];
    return opt ? opt.label || opt.value : "";
  }
  return "";
}

export function writeValue(el: HTMLElement, value: string): void {
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") {
      const match = Boolean(value) && value !== "off" && value !== "false";
      if (el.checked !== match) {
        el.checked = match;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    setNativeValue(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (el instanceof HTMLTextAreaElement) {
    setNativeValue(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (el instanceof HTMLSelectElement) {
    const opt = Array.from(el.options).find(
      (o) => o.value === value || o.label === value,
    );
    if (opt) {
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}

// React intercepts the setter on input/textarea. We bypass with the native setter
// so frameworks see the change as a real user edit.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  const nativeSetter = descriptor?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }
}
