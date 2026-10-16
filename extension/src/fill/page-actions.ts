// Page actions (Apply spec #23, ADR 0005): the only code that changes a portal page, and only inside
// a fill Kris clicked. It sets a field's value the way typing would (the element's native setter,
// then `input` and `change`, so React-style forms register it), draws and removes apply-kit's marks,
// and scrolls a field into view and focuses it for "Show on page". It refuses any control that is a
// link, a button, or reads as navigation, submission, sign-in, account creation or consent: those are
// Kris's. The guard test (user-driven.test.ts) allows events and scrolling only in this file.

/** Words on controls apply-kit never acts on: navigation, submission, sign-in and accounts (English and Bulgarian). */
const navigation = /\b(submit|send|next|continue|save and continue|apply|review|sign ?in|log ?in|sign ?up|register|create (an )?account|finish)\b|изпрати|кандидатствай|напред|продължи|вход|регистр|създай профил/iu;
/** Terms, consent and "I certify" boxes (English and Bulgarian): Kris ticks those. */
export const consentWords = /\b(i agree|agree to|consent|i certify|certify that|terms|privacy (policy|notice)|acknowledge|i confirm|gdpr)\b|съглас|декларирам|потвърждавам|условия|лични данни/iu;

/** Why apply-kit won't act on this control, or null when it may set its value. */
export function refusal(el: Element, label = ""): string | null {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (tag === "a" || role === "link") return "a link";
  if (tag === "button" || role === "button" || ["submit", "button", "image", "reset"].includes(type)) return "a button";
  if (tag === "form") return "a form";
  if (!["input", "select", "textarea"].includes(tag)) return "not a form field";
  const words = [label, el.getAttribute("aria-label"), el.getAttribute("name"), el.id, el.getAttribute("data-automation-id")].filter(Boolean).join(" ");
  if ((type === "checkbox" || type === "radio") && consentWords.test(words)) return "a consent box";
  if (type === "password") return "a password";
  // Workday names its controls in automation ids ("signInSubmitButton", "bottom-navigation-next-button").
  const automation = (el.getAttribute("data-automation-id") ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
  if (navigation.test(automation)) return "a navigation control";
  return null;
}

/** The setter the element's own class defines, past any setter a framework put on the instance. */
function nativeSetter(el: Element, prop: "value" | "checked"): ((v: unknown) => void) | null {
  for (let proto = Object.getPrototypeOf(el) as object | null; proto; proto = Object.getPrototypeOf(proto) as object | null) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (d?.set) return d.set as (v: unknown) => void;
  }
  return null;
}

function announceChange(el: Element) {
  const Event = el.ownerDocument.defaultView!.Event;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Sets a text field, textarea or select (by option text) as typing would. False if refused or impossible. */
export function setValue(el: Element, value: string, label = ""): boolean {
  if (refusal(el, label)) return false;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type === "checkbox" || type === "radio" || type === "file") return false;
  let raw = value;
  if (tag === "select") {
    const option = Array.from((el as HTMLSelectElement).options).find((o) => o.text.trim().toLowerCase() === value.trim().toLowerCase() || o.value === value);
    if (!option) return false;
    raw = option.value;
  }
  const set = nativeSetter(el, "value");
  if (!set) return false;
  set.call(el, raw);
  announceChange(el);
  return true;
}

/** Ticks or unticks a checkbox, or selects or clears a radio button, as a person would. False if refused (consent boxes are Kris's). */
export function setChecked(el: Element, checked: boolean, label = ""): boolean {
  if (refusal(el, label)) return false;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type !== "checkbox" && type !== "radio") return false;
  const set = nativeSetter(el, "checked");
  if (!set) return false;
  set.call(el, checked);
  announceChange(el);
  return true;
}

// ---------- marks: an outline and a badge over the field, never part of the portal's page ----------

/** apply-kit's mark colours, the light-theme values of the design tokens (--met, --bloom, --partly, --gap). Portal pages are the company's, so the panel's tokens don't reach them. */
const markStyle = {
  filled: { colour: "#2c6652", soft: "#e0eee7", badge: "✓", label: "filled by apply-kit" },
  "needs-you": { colour: "#a33d62", soft: "#f7e3ea", badge: "?", label: "needs you" },
  kept: { colour: "#75561a", soft: "#f6ecd1", badge: "◐", label: "kept the portal's value" },
  "didnt-stick": { colour: "#a33e46", soft: "#f6e2e3", badge: "✕", label: "didn't stick" },
} as const;
export type MarkKind = keyof typeof markStyle;

const markAttr = "data-apply-kit-mark";

/** Draws (or redraws) the mark on a field: an outline and a positioned badge, `pointer-events: none`, `aria-hidden`. */
export function mark(el: Element, kind: MarkKind, fieldId: string): void {
  const doc = el.ownerDocument;
  unmark(doc, fieldId);
  const s = markStyle[kind];
  const win = doc.defaultView!;
  const r = el.getBoundingClientRect();
  const box = doc.createElement("div");
  box.setAttribute(markAttr, kind);
  box.setAttribute("data-for", fieldId);
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = [
    "position:absolute", "pointer-events:none", "z-index:2147483646", "box-sizing:border-box", "border-radius:4px",
    `top:${r.top + win.scrollY - 3}px`, `left:${r.left + win.scrollX - 3}px`, `width:${r.width + 6}px`, `height:${r.height + 6}px`,
    `outline:2px solid ${s.colour}`, `box-shadow:inset 3px 0 0 ${s.colour}`,
  ].join(";");
  const badge = doc.createElement("span");
  badge.textContent = s.badge;
  badge.style.cssText = [
    "position:absolute", "top:-9px", "right:-9px", "width:18px", "height:18px", "border-radius:50%", "display:grid", "place-items:center",
    "font:700 11px/1 system-ui,sans-serif", `background:${s.soft}`, `color:${s.colour}`, `border:1px solid ${s.colour}`,
  ].join(";");
  box.append(badge);
  doc.body.append(box);
}

export function unmark(doc: Document, fieldId: string): void {
  for (const m of Array.from(doc.querySelectorAll(`[${markAttr}]`))) if (m.getAttribute("data-for") === fieldId) m.remove();
}

/** Every mark apply-kit drew on the page, for Undo and when the session ends. */
export function removeMarks(doc: Document): void {
  for (const m of Array.from(doc.querySelectorAll(`[${markAttr}]`))) m.remove();
}

/** Show on page: scrolls the field into view and focuses it. */
export function showField(el: Element): void {
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  (el as HTMLElement).focus({ preventScroll: true });
}
