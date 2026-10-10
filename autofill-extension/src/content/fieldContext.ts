import type { FieldContext, FieldKind } from "../shared/types";
import { normalizeQuestion } from "../shared/normalize";

type FormFieldEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const SKIP_INPUT_TYPES = new Set([
  "password",
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
  "search",
]);

export function isCandidateField(el: Element): el is FormFieldEl {
  if (el instanceof HTMLInputElement) {
    if (SKIP_INPUT_TYPES.has(el.type)) return false;
    if (el.autocomplete === "off" && el.type === "search") return false;
    return true;
  }
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLSelectElement) return true;
  return false;
}

export function fieldKindOf(el: FormFieldEl): FieldKind {
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLSelectElement) return "select";
  switch (el.type) {
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "file":
      return "file";
    default:
      return "text";
  }
}

/**
 * Derive a human-readable label for a form field by walking a few candidates:
 *   1. <label for="id">
 *   2. wrapping <label>
 *   3. aria-labelledby -> id lookup
 *   4. aria-label
 *   5. placeholder
 *   6. nearest preceding heading or text sibling
 *   7. name attribute (last resort, humanized)
 */
export function deriveLabel(el: FormFieldEl): string {
  if (el.id) {
    const lbl = document.querySelector<HTMLLabelElement>(
      `label[for="${cssEscape(el.id)}"]`,
    );
    if (lbl?.textContent) return cleanText(lbl.textContent);
  }

  const wrapping = el.closest("label");
  if (wrapping?.textContent) return cleanText(wrapping.textContent);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .filter(Boolean)
      .join(" ");
    if (parts) return cleanText(parts);
  }

  const aria = el.getAttribute("aria-label");
  if (aria) return cleanText(aria);

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return cleanText(el.placeholder);
  }

  const heading = findPrecedingHeading(el);
  if (heading) return heading;

  const name = el.getAttribute("name");
  if (name) return humanizeName(name);

  return "Unlabeled field";
}

function findPrecedingHeading(el: FormFieldEl): string | null {
  // Walk up looking for a group/fieldset-like container, then find a heading in it.
  let node: Element | null = el;
  for (let i = 0; i < 5 && node; i++) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const heading = parent.querySelector("legend, h1, h2, h3, h4, h5, h6, .question, [role='heading']");
    if (heading && heading.contains(el)) {
      const txt = heading.textContent;
      if (txt) return cleanText(txt);
    }
    node = parent;
  }
  return null;
}

function humanizeName(name: string): string {
  return name
    .replace(/[_\-.[\]]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 240);
}

function cssEscape(v: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
  return c?.escape ? c.escape(v) : v.replace(/"/g, '\\"');
}

let syntheticCounter = 0;
const idCache = new WeakMap<FormFieldEl, string>();

export function stableIdFor(el: FormFieldEl): string {
  const cached = idCache.get(el);
  if (cached) return cached;
  const id = el.id || el.getAttribute("name") || `cvaf-${++syntheticCounter}`;
  idCache.set(el, id);
  return id;
}

export function toFieldContext(el: FormFieldEl): FieldContext {
  const label = deriveLabel(el);
  return {
    id: stableIdFor(el),
    label,
    placeholder:
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.placeholder
        : "") || "",
    kind: fieldKindOf(el),
    questionNormalized: normalizeQuestion(label),
  };
}

// Heuristic: does this page look like a job-application form?
// We want to avoid showing suggestions on login pages, search boxes, cookie banners.
export function pageLooksLikeApplication(): boolean {
  const hay = (
    document.title +
    " " +
    (document.body?.innerText ?? "").slice(0, 4000)
  ).toLowerCase();
  const keywords = [
    "apply",
    "application",
    "resume",
    "cv",
    "cover letter",
    "work authorization",
    "sponsorship",
    "why do you want",
    "tell us about",
    "years of experience",
  ];
  let hits = 0;
  for (const k of keywords) if (hay.includes(k)) hits++;
  return hits >= 2;
}

// Simpler per-form heuristic — for when the page as a whole doesn't scream "application"
// but one particular <form> does.
export function formLooksLikeApplication(form: HTMLFormElement): boolean {
  const hay = (form.innerText ?? "").toLowerCase();
  return /apply|application|resume|cv|cover letter/.test(hay);
}
