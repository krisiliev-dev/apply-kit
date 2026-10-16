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
  if (movedDocument(el)) return "the page changed during filling";
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (tag === "a" || role === "link") return "a link";
  if (tag === "button" || role === "button" || ["submit", "button", "image", "reset"].includes(type)) return "a button";
  if (tag === "form") return "a form";
  if (!["input", "select", "textarea"].includes(tag)) return "not a form field";
  const words = [label, el.getAttribute("aria-label"), el.getAttribute("name"), el.id, el.getAttribute("data-automation-id")].filter(Boolean).join(" ");
  if (consentWords.test(words)) return "a consent box";
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

/** `input` and `change` as typing sends them: bubbling, and composed, so a web component hears its control from outside its shadow root. */
function announceChange(el: Element) {
  const Event = el.ownerDocument.defaultView!.Event;
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
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

// ---------- widgets: the portal's own list buttons, options, Add and Delete ----------

/**
 * A click on one of the portal's widgets (a list button, an option, a picked item's delete, an
 * entry's Add or Delete). The extension has no click of its own: the guard test (user-driven.test.ts)
 * forbids clicks everywhere, page actions included. A filler is given one, or leaves these widgets to Kris.
 */
export type Press = (el: Element) => void;

/** Why apply-kit won't press this widget, or null when it may: never a link, a submit, navigation or consent. */
export function widgetRefusal(el: Element, words = ""): string | null {
  if (movedDocument(el)) return "the page changed during filling";
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (tag === "a" || role === "link") return "a link";
  if (tag === "form") return "a form";
  if (["submit", "image", "reset"].includes(type)) return "a submit button";
  if (tag !== "button" && role !== "button" && role !== "option") return "not a widget";
  const all = [words, el.textContent, el.getAttribute("aria-label"), el.getAttribute("data-automation-id")].filter(Boolean).join(" ");
  if (consentWords.test(all)) return "a consent box";
  // An option is the portal's wording of an answer ("Next week"), not a control that moves the page.
  if (role === "option") return null;
  const automation = (el.getAttribute("data-automation-id") ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
  const said = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""} ${automation}`;
  if (navigation.test(said) || moving.test(said)) return "a navigation control";
  return null;
}

/** Widgets that move, close or leave the page, or open the file picker (English and Bulgarian): never pressed. */
const moving = /\b(back|previous|close|cancel|exit|withdraw|select files|upload)\b|назад|затвори|откажи/iu;

/** Presses a widget with the click the filler was given. False if there's none, or the control is refused. */
export function pressWidget(el: Element, press: Press | null, words = ""): boolean {
  if (!press || widgetRefusal(el, words)) return false;
  press(el);
  return true;
}

// ---------- files: the package's CV or letter, attached as choosing it would ----------

/** A package file as the panel passes it into the page: its name, type and bytes (base64). */
export interface FileBytes {
  fileName: string;
  type: string;
  base64: string;
}

function isFileInput(el: Element): el is HTMLInputElement {
  return el.tagName.toLowerCase() === "input" && (el.getAttribute("type") ?? "").toLowerCase() === "file";
}

/** The page's own constructors (the page's window, not the panel's). */
type PageWindow = Window & { DataTransfer: typeof DataTransfer; File: typeof File; Event: typeof Event };

function dataTransfer(win: PageWindow, files: FileBytes[]): DataTransfer {
  const dt = new win.DataTransfer();
  for (const f of files) {
    const bin = win.atob(f.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    dt.items.add(new win.File([bytes], f.fileName, { type: f.type }));
  }
  return dt;
}

/**
 * Attaches a file to a file input: `change` puts it in the input's files and announces it, as choosing
 * it in the file picker would; `drop` drops it on the upload box (`dropOn`), for boxes that only take a
 * dropped file. False if refused or impossible. Nothing is clicked.
 */
export function attachFile(el: Element, file: FileBytes, how: "change" | "drop", dropOn: Element | null = null, label = ""): boolean {
  if (refusal(el, label) || !isFileInput(el)) return false;
  const win = el.ownerDocument.defaultView! as PageWindow;
  const dt = dataTransfer(win, [file]);
  if (how === "change") {
    el.files = dt.files;
    announceChange(el);
    return true;
  }
  const target = dropOn ?? el.parentElement;
  if (!target || refusal(target) === "a link" || refusal(target) === "a button" || refusal(target) === "a form") return false;
  const Drag = (win as unknown as { DragEvent?: typeof DragEvent }).DragEvent;
  for (const type of ["dragenter", "dragover", "drop"]) {
    const init = { bubbles: true, cancelable: true, dataTransfer: dt };
    const ev: Event = Drag ? new Drag(type, init) : new win.Event(type, init);
    // A DOM without drag events (a test page) makes plain events: give them the file too.
    if ((ev as DragEvent).dataTransfer !== dt) Object.defineProperty(ev, "dataTransfer", { value: dt });
    target.dispatchEvent(ev);
  }
  return true;
}

/** Undo for a file field: empties the input and announces it. */
export function clearFile(el: Element, label = ""): boolean {
  if (refusal(el, label) || !isFileInput(el)) return false;
  el.files = dataTransfer(el.ownerDocument.defaultView! as PageWindow, []).files;
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
  /** The portal's Submit on its review page: ringed so Kris finds it, never pressed. */
  submit: { colour: "#a33d62", soft: "#f7e3ea", badge: "!", label: "you press Submit" },
} as const;
export type MarkKind = keyof typeof markStyle;

const markAttr = "data-apply-kit-mark";

/** Draws (or redraws) the mark on a field: an outline and a positioned badge, `pointer-events: none`, `aria-hidden`. */
export function mark(el: Element, kind: MarkKind, fieldId: string): void {
  if (movedDocument(el)) return;
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
    kind === "submit" ? `outline:2px dashed ${s.colour}` : `outline:2px solid ${s.colour}`, kind === "submit" ? "outline-offset:2px" : `box-shadow:inset 3px 0 0 ${s.colour}`,
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

// ---------- choosing inside a form control: a yes/no button, a suggestion in a field's own list ----------

const yesNoWords = /^(yes|no|да|не)$/iu;
const buttonText = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const isYesNoButton = (el: Element) => {
  const tag = el.tagName.toLowerCase();
  return (tag === "button" || el.getAttribute("role") === "button") && (el.getAttribute("type") ?? "").toLowerCase() === "button" && yesNoWords.test(buttonText(el));
};

/**
 * Why apply-kit won't choose this, or null when it's a form control's own choice: one of the two
 * buttons of a yes/no question (Ashby), or a suggestion in a typeahead's list (`role=option` inside a
 * `role=listbox`). Choosing one is filling, not navigating. Everything else is refused: links,
 * submit buttons (a `<button>` is one unless it says `type="button"`), and any other button.
 */
export function choiceRefusal(el: Element): string | null {
  if (movedDocument(el)) return "the page changed during filling";
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (tag === "a" || role === "link" || el.closest("a") || el.querySelector("a")) return "a link";
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if ((tag === "button" && type !== "button") || ["submit", "image", "reset"].includes(type)) return "a submit button";
  const question = el.closest("fieldset, [role=group], [role=radiogroup], .application-question, [data-automation-id^=formField]");
  if (consentWords.test([el.getAttribute("aria-label"), question?.querySelector("legend")?.textContent, question?.getAttribute("aria-label"), question?.textContent].filter(Boolean).join(" "))) return "a consent question";
  if (role === "option") return el.closest("[role=listbox]") && !el.querySelector("button, input") ? null : "not a suggestion in a field's list";
  if (tag === "button" && type === "button" && widgetRefusal(el) === null && el.closest(".entries, [data-ui=experience], [data-ui=education]") && el.matches('.add-entry, .remove-entry, [data-ui^="add-"], [data-ui^="remove-"], [aria-label^="Remove"]') && /^(?:\+\s*)?(add|remove|delete)(?:\s|$)/i.test(el.getAttribute("aria-label") || el.textContent || "")) return null;
  if (widgetRefusal(el) === null && el.matches('button[type="button"][aria-haspopup="listbox"], button[type="button"][data-automation-id="add-button"], button[type="button"][data-automation-id="panel-set-delete-button"], [role="button"][data-automation-id="DELETE_charm"]')) return null;
  if (tag === "button" || role === "button" || tag === "input") {
    if (!isYesNoButton(el)) return "not a yes/no answer";
    const pair = Array.from(el.parentElement?.children ?? []).filter((c) => c.tagName.toLowerCase() === "button" || c.getAttribute("role") === "button");
    if (pair.length !== 2 || !pair.every(isYesNoButton)) return "not a yes/no question";
    return null;
  }
  return "not a choice";
}

/** Chooses a yes/no button or a suggestion as a person's click would. False if refused. The only click apply-kit makes. */
export function choose(el: Element): boolean {
  if (choiceRefusal(el)) return false;
  (el as HTMLElement).click();
  return true;
}

/** Lets Chrome offer a password; reads and writes no password value. */
export function passwordHint(el: Element): void {
  if (movedDocument(el)) return;
  if (el.tagName.toLowerCase() === "input" && el.getAttribute("type") === "password") el.setAttribute("autocomplete", "new-password");
}

const documentAddresses = new WeakMap<Document, string>();
export function bindDocument(doc: Document): void { documentAddresses.set(doc, doc.URL); }
const movedDocument = (el: Element) => documentAddresses.has(el.ownerDocument) && documentAddresses.get(el.ownerDocument) !== el.ownerDocument.URL;
