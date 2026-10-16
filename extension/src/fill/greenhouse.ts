// The Greenhouse filler (Apply #38): reads a Greenhouse application page (the classic board and the
// new job board, and the embedded form) into its fields in the portal's order, fills the answers it's
// given through page actions, and undoes what it changed. It keeps only the previous values and which
// fields it filled, in the page's isolated world; nothing else. It never presses a button.
import type { FieldAnswer, FieldKind, FieldOutcome, PageReading, ReadField } from "@apply-kit/core";
import { recognisePortal } from "../portal.ts";
import { consentWords, mark, refusal, removeMarks, setChecked, setValue, showField, unmark } from "./page-actions.ts";

export interface Filler {
  read(doc: Document): PageReading;
  /** Fills the answers' values into empty fields; keeps non-empty ones; marks each field it reports. */
  fill(doc: Document, answers: FieldAnswer[]): FieldOutcome[];
  /** "Replace" on a kept field: puts apply-kit's value in (Undo restores the portal's). */
  replace(doc: Document, fieldId: string, value: string): FieldOutcome["outcome"];
  /** "Fill …" on a needs-you item: puts Kris's answer from the panel in that one field; later fills report it as his ("You"). */
  fillOne(doc: Document, fieldId: string, value: string): FieldOutcome["outcome"];
  /** Restores every value apply-kit changed on this page and removes its marks. Returns how many fields were restored. */
  undo(doc: Document): number;
  /** Show on page. False if the field is gone. */
  show(doc: Document, fieldId: string): boolean;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();

const isRadio = (el: Element) => (el.getAttribute("type") ?? "").toLowerCase() === "radio";

/** The form's controls a person fills, in the page's order; a radio group is its first button. */
function controls(doc: Document): Control[] {
  const root = doc.querySelector("#application_form, #application-form, form.application--form") ?? doc.querySelector("form") ?? doc.body;
  const groups = new Set<string>();
  return Array.from(root.querySelectorAll<Control>("input, select, textarea")).filter((el) => {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type) || el.disabled) return false;
    const name = el.getAttribute("name");
    if (type !== "radio" || !name) return true;
    if (groups.has(name)) return false;
    groups.add(name);
    return true;
  });
}

/** Every button of the radio group a radio belongs to. */
function radios(el: Control): HTMLInputElement[] {
  const name = el.getAttribute("name");
  const scope = el.closest("form") ?? el.ownerDocument;
  return name ? Array.from(scope.querySelectorAll<HTMLInputElement>("input[type=radio]")).filter((r) => r.getAttribute("name") === name) : [el as HTMLInputElement];
}

function fieldId(el: Control, index: number): string {
  if (isRadio(el)) return el.getAttribute("name") || el.id || `field-${index}`;
  return el.id || el.getAttribute("name") || `field-${index}`;
}

/** A radio group's question: its fieldset's legend, or the group's aria label. */
function groupLabel(el: Control): string {
  const group = el.closest("fieldset, [role=radiogroup]");
  const legend = group?.querySelector("legend");
  if (legend) return legend.textContent ?? "";
  const by = group?.getAttribute("aria-labelledby");
  if (by) return by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" ");
  return group?.getAttribute("aria-label") ?? "";
}

function rawLabel(el: Control): string {
  if (isRadio(el)) return groupLabel(el);
  return ownLabel(el);
}

function ownLabel(el: Control): string {
  const doc = el.ownerDocument;
  if (el.id) {
    const forIt = Array.from(doc.querySelectorAll("label")).find((l) => l.getAttribute("for") === el.id);
    if (forIt) return forIt.textContent ?? "";
  }
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const text = by.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? "").join(" ");
    if (text.trim()) return text;
  }
  const wrapping = el.closest("label");
  if (wrapping) return wrapping.textContent ?? "";
  return el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? "";
}

function kindOf(el: Control): FieldKind {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete")) return "typeahead";
  const type = (el.getAttribute("type") ?? "text").toLowerCase();
  return (["email", "tel", "url", "number", "date", "file", "checkbox", "radio"] as const).find((k) => k === type) ?? "text";
}

function valueOf(el: Control): string {
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type === "radio") {
    const on = radios(el).find((r) => r.checked);
    return on ? clean(ownLabel(on)) : "";
  }
  if (type === "checkbox" || type === "radio") return (el as HTMLInputElement).checked ? "checked" : "";
  if (el.tagName.toLowerCase() === "select") {
    const s = el as HTMLSelectElement;
    return s.value ? (s.options[s.selectedIndex]?.text.trim() ?? s.value) : "";
  }
  return el.value;
}

function readField(el: Control, index: number): ReadField {
  const raw = rawLabel(el);
  const label = clean(raw);
  const kind = kindOf(el);
  const hint = el.getAttribute("autocomplete");
  const max = Number(el.getAttribute("maxlength"));
  return {
    id: fieldId(el, index),
    label,
    kind,
    required: (kind === "radio" ? radios(el) : [el]).some((r) => r.hasAttribute("required") || r.getAttribute("aria-required") === "true") || /\*/.test(raw),
    value: valueOf(el),
    options: kind === "select" ? Array.from((el as HTMLSelectElement).options).filter((o) => o.value !== "").map((o) => o.text.trim())
      : kind === "radio" ? radios(el).map((r) => clean(ownLabel(r))) : [],
    maxLength: Number.isFinite(max) && max > 0 ? max : null,
    consent: (kind === "checkbox" || kind === "radio") && consentWords.test(label),
    password: (el.getAttribute("type") ?? "").toLowerCase() === "password",
    hint: hint && hint !== "on" && hint !== "off" ? hint : null,
  };
}

export function createGreenhouseFiller(): Filler {
  /** Field id → the value it had before apply-kit changed it. */
  const previous = new Map<string, string>();
  /** Field id → the value apply-kit put in. */
  const filled = new Map<string, string>();
  /** Fields Kris answered from the panel. */
  const yours = new Set<string>();

  const find = (doc: Document, id: string) => {
    const all = controls(doc);
    const i = all.findIndex((el, n) => fieldId(el, n) === id);
    return i < 0 ? null : { el: all[i]!, field: readField(all[i]!, i) };
  };

  /** Sets a field to a value in its own way: text, an option, a radio button by its label, a tick ("checked" or ""). */
  function set(el: Control, kind: FieldKind, value: string, label: string): boolean {
    if (kind === "radio") {
      const group = radios(el);
      if (value === "") return group.every((r) => !r.checked || setChecked(r, false, label));
      const pick = group.find((r) => clean(ownLabel(r)).toLowerCase() === value.trim().toLowerCase());
      return !!pick && setChecked(pick, true, label);
    }
    if (kind === "checkbox") return setChecked(el, value === "checked", label);
    return setValue(el, value, label);
  }

  function put(doc: Document, id: string, value: string): FieldOutcome["outcome"] {
    const found = find(doc, id);
    if (!found) return "didnt-stick";
    const before = found.field.value;
    if (!set(found.el, found.field.kind, value, found.field.label)) return "didnt-stick";
    if (!previous.has(id)) previous.set(id, before);
    const now = valueOf(found.el);
    if (now.trim() !== value.trim()) {
      mark(found.el, "didnt-stick", id);
      return "didnt-stick";
    }
    filled.set(id, now);
    mark(found.el, "filled", id);
    return "filled";
  }

  return {
    read(doc) {
      const fields = controls(doc).map(readField);
      const text = doc.body?.textContent ?? "";
      const confirmation = /thank you for applying|application (has been )?(received|submitted)/i.test(text) || /\/confirmation\b/.test(doc.URL);
      return {
        pageKind: fields.length > 0 ? "form" : confirmation ? "confirmation" : "other",
        jobRef: recognisePortal(doc.URL).ref,
        stepLabel: null,
        stepCount: null,
        fields,
      };
    },

    fill(doc, answers) {
      return answers.map((a): FieldOutcome => {
        const found = find(doc, a.fieldId);
        if (!found || a.kind === "skip") return { fieldId: a.fieldId, outcome: "skipped", source: null };
        if (a.kind === "needs-you") {
          const current = found.field.value;
          // Answered: from the panel (Kris's), or typed on the page (kept, so apply-kit can offer it to the bank).
          if (current.trim() !== "" && yours.has(a.fieldId) && filled.get(a.fieldId) === current) return { fieldId: a.fieldId, outcome: "filled", source: "you" };
          if (current.trim() !== "") {
            mark(found.el, "kept", a.fieldId);
            return { fieldId: a.fieldId, outcome: "kept", source: null };
          }
          mark(found.el, "needs-you", a.fieldId);
          return { fieldId: a.fieldId, outcome: "needs-you", source: null };
        }
        if (refusal(found.el, found.field.label)) return { fieldId: a.fieldId, outcome: "skipped", source: null };
        const current = found.field.value;
        if (current.trim() !== "") {
          // Filled by apply-kit on an earlier click and untouched since: still apply-kit's. Anything else is kept.
          if (filled.get(a.fieldId) === current) return { fieldId: a.fieldId, outcome: "filled", source: a.source };
          mark(found.el, "kept", a.fieldId);
          return { fieldId: a.fieldId, outcome: "kept", source: null };
        }
        const outcome = put(doc, a.fieldId, a.value);
        return { fieldId: a.fieldId, outcome, source: outcome === "filled" ? a.source : null };
      });
    },

    replace(doc, fieldId, value) {
      unmark(doc, fieldId);
      return put(doc, fieldId, value);
    },

    fillOne(doc, fieldId, value) {
      unmark(doc, fieldId);
      const outcome = put(doc, fieldId, value);
      if (outcome === "filled") yours.add(fieldId);
      return outcome;
    },

    undo(doc) {
      let restored = 0;
      for (const [id, before] of previous) {
        const found = find(doc, id);
        if (found && set(found.el, found.field.kind, before, found.field.label)) restored++;
      }
      previous.clear();
      filled.clear();
      yours.clear();
      removeMarks(doc);
      return restored;
    },

    show(doc, fieldId) {
      const found = find(doc, fieldId);
      if (!found) return false;
      showField(found.el);
      return true;
    },
  };
}
