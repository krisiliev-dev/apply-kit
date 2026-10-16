// The Greenhouse filler (Apply #38): reads a Greenhouse application page (the classic board and the
// new job board, and the embedded form) into its fields in the portal's order, fills the answers it's
// given through page actions, and undoes what it changed. It keeps only the previous values and which
// fields it filled, in the page's isolated world; nothing else. It never presses a button.
import type { EntrySection, FieldAnswer, FieldKind, FieldOutcome, FieldStructure, PackageFileKind, PageReading, ReadField } from "@apply-kit/core";
import { describingAttribute } from "@apply-kit/core/field-report";
import { recognisePortal } from "../portal.ts";
import { attachFile, clearFile, consentWords, mark, refusal, removeMarks, setChecked, setValue, showField, unmark, type FileBytes } from "./page-actions.ts";

export interface Filler {
  read(doc: Document): PageReading;
  /**
   * Attaches the package's files first (`files`: the bytes for the page's file answers), lets the page
   * settle (the portal may read the CV and fill fields itself), then fills the answers' values into
   * fields still empty; keeps non-empty ones; after one more settle reads every value it filled back
   * once (a value the page cleared or changed didn't stick); marks each field it reports. Outcomes in
   * the answers' order.
   */
  fill(doc: Document, answers: FieldAnswer[], files?: FileToAttach[]): Promise<FieldOutcome[]>;
  /**
   * "Try once more" on a field whose value didn't stick: puts the value in once, lets the page settle,
   * reads it back once. Never loops; the panel offers it once per field.
   */
  retry(doc: Document, fieldId: string, value: string): Promise<FieldOutcome["outcome"]>;
  /** "Replace" on a kept field: puts apply-kit's value in (Undo restores the portal's). */
  replace(doc: Document, fieldId: string, value: string): FieldOutcome["outcome"];
  /** "Fill …" on a needs-you item: puts Kris's answer from the panel in that one field; later fills report it as his ("You"). */
  fillOne(doc: Document, fieldId: string, value: string): FieldOutcome["outcome"];
  /** Restores every value apply-kit changed on this page and removes its marks. Returns how many fields were restored. */
  undo(doc: Document): number;
  /** Show on page. False if the field is gone. */
  show(doc: Document, fieldId: string): boolean;
  /** "Report this field": the field's structure, never its value (nor anything that contains it). Null if the field is gone. */
  describe(doc: Document, fieldId: string): FieldStructure | null;
  /** Kris's choice for a needs-you choice (a typeahead with two plausible matches): picks that option. */
  pick?(doc: Document, fieldId: string, option: string): Promise<FieldOutcome["outcome"]>;
  /** "Remove the N duplicates": deletes those entries of a repeating section with the portal's own Delete. Returns how many went. */
  removeEntries?(doc: Document, section: EntrySection, indexes: number[]): Promise<number>;
}

/** A package file for a file answer, as the panel fetched it from apply-kit. */
export interface FileToAttach extends FileBytes {
  which: PackageFileKind;
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

/** Every place a field's label can come from, in the order the filler looks. */
function labelChain(el: Control): { from: string; text: string }[] {
  const doc = el.ownerDocument;
  const chain: { from: string; text: string }[] = [];
  const add = (from: string, text: string | null | undefined) => { const t = clean(text); if (t) chain.push({ from, text: t }); };
  const byIds = (ids: string | null) => (ids ? ids.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? "").join(" ") : "");
  if (isRadio(el)) {
    const group = el.closest("fieldset, [role=radiogroup]");
    add("legend", group?.querySelector("legend")?.textContent);
    add("group aria-labelledby", byIds(group?.getAttribute("aria-labelledby") ?? null));
    add("group aria-label", group?.getAttribute("aria-label"));
  }
  if (el.id) add("label[for]", Array.from(doc.querySelectorAll("label")).find((l) => l.getAttribute("for") === el.id)?.textContent);
  add("aria-labelledby", byIds(el.getAttribute("aria-labelledby")));
  add("wrapping label", el.closest("label")?.textContent);
  add("aria-label", el.getAttribute("aria-label"));
  add("placeholder", el.getAttribute("placeholder"));
  return chain;
}

/** The upload box around a file input: where the portal shows the chosen file's name and takes a dropped file. */
function fileBox(el: Element): Element {
  return el.closest(".field, .file-upload, [class*=upload], [class*=drop]") ?? el.parentElement ?? el;
}
const shows = (box: Element, fileName: string) => (box.textContent ?? "").includes(fileName);
const chosen = (el: Element) => (el as HTMLInputElement).files?.[0]?.name ?? "";

export function createGreenhouseFiller({ settleMs = 1500 }: { settleMs?: number } = {}): Filler {
  /** Field id → the value it had before apply-kit changed it. */
  const previous = new Map<string, string>();
  /** File fields apply-kit attached a file to (Undo empties them). */
  const attached = new Set<string>();
  const settle = () => (settleMs > 0 ? new Promise<void>((done) => setTimeout(done, settleMs)) : Promise.resolve());
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

  /** The single read-back after the settle wait: the value apply-kit put in is still there, or it didn't stick. */
  function verify(doc: Document, id: string): FieldOutcome["outcome"] {
    const found = find(doc, id);
    const put = filled.get(id);
    if (found && put !== undefined && valueOf(found.el).trim() === put.trim()) return "filled";
    filled.delete(id);
    if (found) mark(found.el, "didnt-stick", id);
    return "didnt-stick";
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

    async fill(doc, answers, files = []) {
      const outcomes = new Map<string, FieldOutcome>();
      const report = (fieldId: string, outcome: FieldOutcome["outcome"], source: FieldOutcome["source"] = null) => outcomes.set(fieldId, { fieldId, outcome, source });

      // Files first: the portal's own CV reading runs when the CV goes in, before anything else is filled.
      const pending: { fieldId: string; el: Control; box: Element; file: FileToAttach; label: string }[] = [];
      for (const a of answers) {
        if (a.kind !== "file") continue;
        const found = find(doc, a.fieldId);
        if (!found) { report(a.fieldId, "skipped"); continue; }
        const box = fileBox(found.el);
        const file = files.find((f) => f.which === a.which && f.fileName === a.fileName);
        const now = chosen(found.el);
        if (now === a.fileName && shows(box, a.fileName)) {
          mark(box, "filled", a.fieldId);
          report(a.fieldId, "filled", a.source);
        } else if (now && now !== a.fileName) {
          mark(box, "kept", a.fieldId);
          report(a.fieldId, "kept");
        } else if (!file || !attachFile(found.el, file, "change", null, found.field.label)) {
          mark(box, "didnt-stick", a.fieldId);
          report(a.fieldId, "didnt-stick");
        } else {
          attached.add(a.fieldId);
          pending.push({ fieldId: a.fieldId, el: found.el, box, file, label: found.field.label });
        }
      }
      if (pending.length) {
        await settle();
        // A box that ignored the input's change gets the file dropped on it.
        const dropped = pending.filter((p) => !shows(p.box, p.file.fileName) && attachFile(p.el, p.file, "drop", p.box, p.label));
        if (dropped.length) await settle();
        for (const p of pending) {
          const ok = shows(p.box, p.file.fileName);
          mark(p.box, ok ? "filled" : "didnt-stick", p.fieldId);
          report(p.fieldId, ok ? "filled" : "didnt-stick", ok ? "package" : null);
        }
      }

      const toVerify: string[] = [];
      for (const a of answers) {
        if (a.kind === "file") continue;
        const found = find(doc, a.fieldId);
        // Greenhouse has no repeating sections to add entries to.
        if (!found || a.kind === "skip" || a.kind === "entries") { report(a.fieldId, "skipped"); continue; }
        if (a.kind === "needs-you") {
          const current = found.field.value;
          // Answered: from the panel (Kris's), or typed on the page (kept, so apply-kit can offer it to the bank).
          if (current.trim() !== "" && yours.has(a.fieldId) && filled.get(a.fieldId) === current) { report(a.fieldId, "filled", "you"); continue; }
          if (current.trim() !== "") {
            mark(found.el, "kept", a.fieldId);
            report(a.fieldId, "kept");
            continue;
          }
          mark(found.el, "needs-you", a.fieldId);
          report(a.fieldId, "needs-you");
          continue;
        }
        if (refusal(found.el, found.field.label)) { report(a.fieldId, "skipped"); continue; }
        const current = found.field.value;
        if (current.trim() !== "") {
          // Filled by apply-kit on an earlier click and untouched since: still apply-kit's. Anything else
          // (Kris's value, or what the portal read from the CV) is kept.
          if (filled.get(a.fieldId) === current) { report(a.fieldId, "filled", a.source); continue; }
          mark(found.el, "kept", a.fieldId);
          report(a.fieldId, "kept");
          continue;
        }
        const outcome = put(doc, a.fieldId, a.value);
        report(a.fieldId, outcome, outcome === "filled" ? a.source : null);
        if (outcome === "filled") toVerify.push(a.fieldId);
      }
      // Verify once: some portals reformat or clear a value just after it's typed.
      if (toVerify.length) {
        await settle();
        for (const id of toVerify) if (verify(doc, id) === "didnt-stick") report(id, "didnt-stick");
      }
      return answers.map((a) => outcomes.get(a.fieldId)!);
    },

    async retry(doc, fieldId, value) {
      unmark(doc, fieldId);
      if (put(doc, fieldId, value) !== "filled") return "didnt-stick";
      await settle();
      return verify(doc, fieldId);
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
      for (const id of attached) {
        const found = find(doc, id);
        if (found && clearFile(found.el, found.field.label)) restored++;
      }
      attached.clear();
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

    describe(doc, fieldId) {
      const found = find(doc, fieldId);
      if (!found) return null;
      const { el, field } = found;
      // A free-text value can turn up in a portal's own text (a label echoing it): anything containing it is left out.
      const value = ["select", "radio", "checkbox"].includes(field.kind) ? "" : field.value.trim();
      const holds = (text: string) => value.length > 1 && text.toLowerCase().includes(value.toLowerCase());
      const attributes: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) if (describingAttribute.test(a.name) && !holds(a.value)) attributes[a.name] = a.value;
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type"),
        role: el.getAttribute("role"),
        kind: field.kind,
        attributes,
        labelChain: labelChain(el).filter((l) => !holds(l.text)),
        options: field.options.filter((o) => !holds(o)),
      };
    },

    show(doc, fieldId) {
      const found = find(doc, fieldId);
      if (!found) return false;
      showField(found.el);
      return true;
    },
  };
}
