// A filler for a portal whose application is one page of ordinary form controls (Lever, Ashby; Apply
// #43), built from the portal's shape: where its form is, what to leave out, how its questions are
// labelled, whether its typeaheads keep only a picked suggestion, and how its thank-you reads. It
// reads the form in the portal's order, attaches the package's files first, fills the answers it's
// given through page actions (typing, ticking, choosing a yes/no button or a suggestion), verifies
// each value once, and undoes what it changed. It keeps only how to put back what it changed and which
// fields it filled, in the page's isolated world. It never presses a button.
import type { FieldAnswer, FieldKind, FieldOutcome, PageKind, PageReading, ReadField } from "@apply-kit/core";
import { recognisePortal } from "../portal.ts";
import type { FileToAttach, Filler } from "./greenhouse.ts";
import { attachFile, choiceRefusal, choose, clearFile, consentWords, mark, refusal, removeMarks, setChecked, setValue, showField, unmark } from "./page-actions.ts";

export interface FormShape {
  /** The application form (Ashby's is not a `<form>`), or null when the page shows none. */
  form(doc: Document): Element | null;
  /** Parts of the form apply-kit never reads or fills (Ashby's "Autofill from resume" box). */
  ignore?: string;
  /** A question's box and the label in it, for controls no `<label>` names (Lever's cards). */
  question?: { box: string; label: string };
  /** Typeaheads that keep only a picked suggestion (Ashby's location): typed text alone doesn't count. */
  pickOnly: boolean;
  /** The portal's thank-you after Submit, from the page's address and text. */
  confirmation(doc: Document): boolean;
}

export interface FormFillerOptions {
  /** How long the page gets after the files go in (the portal reads the CV) and after a drop. */
  settleMs?: number;
  /** How long a typeahead gets to show its suggestions. */
  optionWaitMs?: number;
}

/** One question on the page: a control, a group of radios or tick boxes, or a yes/no button pair. */
interface Item {
  /** The control; a yes/no pair's own box. */
  el: HTMLElement;
  kind: FieldKind;
  /** A group's radios or tick boxes, a yes/no pair's buttons, or the control alone. */
  members: HTMLElement[];
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").replace(/\s*[*✱]\s*$/u, "").trim();
const typeOf = (el: Element) => (el.getAttribute("type") ?? "").toLowerCase();
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** An element's text without the options of a control inside it (a label wrapping a dropdown). */
function textOf(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const inner of Array.from(copy.querySelectorAll("select, option, textarea, [role=listbox]"))) inner.remove();
  return copy.textContent ?? "";
}

function byIds(doc: Document, ids: string | null): string {
  return (ids ?? "").split(/\s+/).filter(Boolean).map((id) => doc.getElementById(id)?.textContent ?? "").join(" ");
}

const isGroup = (item: Item) => item.kind === "yes-no" || item.kind === "radio" || item.members.length > 1;

function items(doc: Document, shape: FormShape): Item[] {
  const root = shape.form(doc);
  if (!root) return [];
  const out: Item[] = [];
  const seen = new Set<Element | string>();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("input, select, textarea, button"))) {
    if (shape.ignore && el.closest(shape.ignore)) continue;
    if (el.tagName.toLowerCase() === "button") {
      // A yes/no question's two buttons are one field; any other button is the portal's.
      const pair = el.parentElement!;
      if (seen.has(pair) || choiceRefusal(el) !== null) continue;
      seen.add(pair);
      out.push({ el: pair, kind: "yes-no", members: Array.from(pair.children).filter((c): c is HTMLElement => c.tagName.toLowerCase() === "button") });
      continue;
    }
    const type = typeOf(el);
    if (["hidden", "submit", "button", "image", "reset"].includes(type) || (el as HTMLInputElement).disabled) continue;
    if (type === "radio" || type === "checkbox") {
      const name = el.getAttribute("name");
      const group = name ? Array.from(root.querySelectorAll<HTMLElement>(`input[type=${type}]`)).filter((r) => r.getAttribute("name") === name) : [el];
      if (type === "radio" || group.length > 1) {
        if (seen.has(`${type}:${name}`)) continue;
        seen.add(`${type}:${name}`);
        out.push({ el: group[0]!, kind: type, members: group });
        continue;
      }
    }
    out.push({ el, kind: kindOf(el), members: [el] });
  }
  return out;
}

function kindOf(el: Element): FieldKind {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete")) return "typeahead";
  if (el.closest(".react-datepicker-wrapper") || datePattern(el)) return "date";
  const type = typeOf(el) || "text";
  return (["email", "tel", "url", "number", "date", "file", "checkbox", "radio"] as const).find((k) => k === type) ?? "text";
}

/** A date picker's format, from its placeholder ("MM/DD/YYYY"). */
function datePattern(el: Element): { order: ("MM" | "DD" | "YYYY")[]; sep: string } | null {
  const m = /^(MM|DD|YYYY)([/.-])(MM|DD)\2(YYYY|DD)$/i.exec((el.getAttribute("placeholder") ?? "").trim());
  return m ? { order: [m[1]!, m[3]!, m[4]!].map((p) => p.toUpperCase() as "MM" | "DD" | "YYYY"), sep: m[2]! } : null;
}

/** An ISO date (the engine's answer) in the picker's own format. */
function inFormat(el: Element, value: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const p = datePattern(el);
  if (!iso || !p || typeOf(el) === "date") return value;
  const parts = { YYYY: iso[1]!, MM: iso[2]!, DD: iso[3]! };
  return p.order.map((k) => parts[k]).join(p.sep);
}

function questionLabel(el: Element, shape: FormShape): string {
  if (!shape.question) return "";
  const label = el.closest(shape.question.box)?.querySelector(shape.question.label);
  return label ? textOf(label) : "";
}

function ownLabel(el: Element, shape: FormShape): string {
  const doc = el.ownerDocument;
  if (el.id) {
    const forIt = Array.from(doc.querySelectorAll("label")).find((l) => l.getAttribute("for") === el.id);
    if (forIt) return textOf(forIt);
  }
  const by = byIds(doc, el.getAttribute("aria-labelledby"));
  if (by.trim()) return by;
  const wrapping = el.closest("label");
  if (wrapping && textOf(wrapping).trim()) return textOf(wrapping);
  return questionLabel(el, shape) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
}

function groupLabel(item: Item, shape: FormShape): string {
  const box = item.kind === "yes-no" ? item.el : item.el.closest("fieldset, [role=radiogroup], [role=group]");
  const legend = box?.querySelector("legend");
  if (legend) return legend.textContent ?? "";
  const by = byIds(item.el.ownerDocument, box?.getAttribute("aria-labelledby") ?? null);
  if (by.trim()) return by;
  return box?.getAttribute("aria-label") || questionLabel(item.el, shape);
}

const rawLabel = (item: Item, shape: FormShape) => (isGroup(item) ? groupLabel(item, shape) : ownLabel(item.el, shape));
const optionLabel = (el: Element, shape: FormShape) => clean(el.tagName.toLowerCase() === "button" ? el.textContent : ownLabel(el, shape));
const isOn = (b: Element) => b.getAttribute("aria-pressed") === "true" || Array.from(b.classList).some((c) => /active|selected/i.test(c));

function valueOf(item: Item, shape: FormShape): string {
  const { el, kind, members } = item;
  if (kind === "yes-no") return clean(members.find(isOn)?.textContent);
  if (kind === "radio" || (kind === "checkbox" && members.length > 1)) {
    return members.filter((m) => (m as HTMLInputElement).checked).map((m) => optionLabel(m, shape)).join(", ");
  }
  if (kind === "checkbox") return (el as HTMLInputElement).checked ? "checked" : "";
  if (kind === "select") {
    const s = el as HTMLSelectElement;
    return s.value ? (s.options[s.selectedIndex]?.text.trim() ?? s.value) : "";
  }
  return (el as HTMLInputElement).value;
}

function fieldId(item: Item, index: number): string {
  if (item.kind === "yes-no") return item.el.id || item.el.getAttribute("aria-labelledby") || `field-${index}`;
  if (isGroup(item)) return item.el.getAttribute("name") || item.el.id || `field-${index}`;
  return item.el.id || item.el.getAttribute("name") || `field-${index}`;
}

function readField(item: Item, index: number, shape: FormShape): ReadField {
  const raw = rawLabel(item, shape);
  const label = clean(raw);
  const { el, kind, members } = item;
  const hint = el.getAttribute("autocomplete");
  const max = Number(el.getAttribute("maxlength"));
  return {
    id: fieldId(item, index),
    label,
    kind,
    required: members.some((m) => m.hasAttribute("required") || m.getAttribute("aria-required") === "true") || /[*✱]/u.test(raw),
    value: valueOf(item, shape),
    options: kind === "select" ? Array.from((el as HTMLSelectElement).options).filter((o) => o.value !== "").map((o) => o.text.trim())
      : isGroup(item) ? members.map((m) => optionLabel(m, shape)) : [],
    maxLength: Number.isFinite(max) && max > 0 ? max : null,
    consent: (kind === "checkbox" || kind === "radio") && consentWords.test(label),
    password: typeOf(el) === "password",
    hint: kind !== "yes-no" && hint && hint !== "on" && hint !== "off" ? hint : null,
  };
}

/** The upload box around a file input: where the portal shows the chosen file's name and takes a dropped file. */
const fileBox = (el: Element): Element => el.closest(".field, .file-upload, [class*=upload], [class*=drop]") ?? el.parentElement ?? el;
const shows = (box: Element, fileName: string) => (box.textContent ?? "").includes(fileName);
const chosen = (el: Element) => (el as HTMLInputElement).files?.[0]?.name ?? "";

/** Where a field's mark goes: a group's box, or the control. */
function markTarget(item: Item, shape: FormShape): Element {
  if (item.kind === "yes-no") return item.el;
  if (isGroup(item)) return item.el.closest("fieldset, [role=radiogroup], [role=group]") ?? (shape.question ? item.el.closest(shape.question.box) : null) ?? item.el;
  return item.el;
}

const words = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The suggestions that fit an answer: the one worded the same, else every one holding all its words. */
function fitting(value: string, options: HTMLElement[]): HTMLElement[] {
  const want = words(value);
  const same = options.filter((o) => words(o.textContent ?? "") === want);
  if (same.length) return same;
  const need = want.split(" ").filter(Boolean);
  return need.length ? options.filter((o) => { const has = new Set(words(o.textContent ?? "").split(" ")); return need.every((w) => has.has(w)); }) : [];
}

type Put = { outcome: FieldOutcome["outcome"]; choices?: string[] };

export function createFormFiller(shape: FormShape, { settleMs = 1500, optionWaitMs = 2000 }: FormFillerOptions = {}): Filler {
  /** Field id → how to put back what it held before apply-kit changed it. */
  const previous = new Map<string, () => boolean>();
  /** File fields apply-kit attached a file to (Undo empties them). */
  const attached = new Set<string>();
  /** Field id → the value apply-kit put in. */
  const filled = new Map<string, string>();
  const settle = () => (settleMs > 0 ? sleep(settleMs) : Promise.resolve());

  const find = (doc: Document, id: string) => {
    const all = items(doc, shape);
    const i = all.findIndex((item, n) => fieldId(item, n) === id);
    return i < 0 ? null : { item: all[i]!, field: readField(all[i]!, i, shape) };
  };

  /** Sets a field to a value in its own way; a typeahead gets the text typed. False if refused or impossible. */
  function set(item: Item, value: string, label: string): boolean {
    const { el, kind, members } = item;
    if (kind === "yes-no") {
      const on = members.find(isOn);
      const want = members.find((b) => optionLabel(b, shape).toLowerCase() === value.trim().toLowerCase());
      if (value === "") return !on || choose(on);
      return !!want && (want === on || choose(want));
    }
    if (kind === "radio" || (kind === "checkbox" && members.length > 1)) {
      if (value === "") return members.every((m) => !(m as HTMLInputElement).checked || setChecked(m, false, label));
      const pick = members.find((m) => optionLabel(m, shape).toLowerCase() === value.trim().toLowerCase());
      return !!pick && ((pick as HTMLInputElement).checked || setChecked(pick, true, label));
    }
    if (kind === "checkbox") return setChecked(el, value === "checked", label);
    return setValue(el, kind === "date" ? inFormat(el, value) : value, label);
  }

  /** How to put this field back as it is now. */
  function restorer(item: Item, label: string): () => boolean {
    if (item.kind === "checkbox" || item.kind === "radio") {
      const ticks = item.members.map((m) => (m as HTMLInputElement).checked);
      return () => item.members.every((m, i) => (m as HTMLInputElement).checked === ticks[i] || setChecked(m, ticks[i]!, label));
    }
    const before = valueOf(item, shape);
    return () => set(item, before, label) && valueOf(item, shape) === before;
  }

  /** The value the field should show once filled: a date in the picker's format, a tick's state, the value. */
  const expected = (item: Item, value: string) => (item.kind === "date" ? inFormat(item.el, value) : value).trim();
  const holds = (item: Item, value: string) => {
    const now = valueOf(item, shape).trim();
    return item.kind === "checkbox" && item.members.length > 1 ? now.split(", ").includes(value.trim()) : now === expected(item, value);
  };

  function finish(id: string, item: Item, ok: boolean): Put {
    mark(markTarget(item, shape), ok ? "filled" : "didnt-stick", id);
    if (ok) filled.set(id, valueOf(item, shape));
    return { outcome: ok ? "filled" : "didnt-stick" };
  }

  /** Puts apply-kit's value in now: typed, ticked or chosen, then read back once. */
  function putNow(doc: Document, id: string, value: string): Put {
    const found = find(doc, id);
    if (!found) return { outcome: "didnt-stick" };
    const restore = restorer(found.item, found.field.label);
    if (!set(found.item, value, found.field.label)) return { outcome: "didnt-stick" };
    if (!previous.has(id)) previous.set(id, restore);
    return finish(id, found.item, holds(found.item, value));
  }

  /** A typeahead: type, wait (bounded) for its suggestions, choose the one that fits; two that fit are Kris's choice. */
  async function putTypeahead(doc: Document, id: string, value: string): Promise<Put> {
    const found = find(doc, id);
    if (!found) return { outcome: "didnt-stick" };
    const { item, field } = found;
    const restore = restorer(item, field.label);
    if (!set(item, value, field.label)) return { outcome: "didnt-stick" };
    if (!previous.has(id)) previous.set(id, restore);
    const listId = item.el.getAttribute("aria-controls") ?? item.el.getAttribute("aria-owns");
    const suggestions = () => Array.from(doc.getElementById(listId ?? "")?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    let options = suggestions();
    for (let waited = 0; options.length === 0 && waited < optionWaitMs; waited += 100) {
      await sleep(100);
      options = suggestions();
    }
    const fits = fitting(value, options);
    if (fits.length > 1) {
      restore();
      previous.delete(id);
      mark(item.el, "needs-you", id);
      return { outcome: "needs-you", choices: fits.map((o) => clean(o.textContent)) };
    }
    if (fits.length === 1) {
      const name = clean(fits[0]!.textContent);
      return finish(id, item, choose(fits[0]!) && valueOf(item, shape).trim() === name);
    }
    if (shape.pickOnly) {
      restore();
      return finish(id, item, false);
    }
    return finish(id, item, holds(item, value));
  }

  return {
    read(doc) {
      const fields = items(doc, shape).map((item, i) => readField(item, i, shape));
      const apply = Array.from(doc.querySelectorAll("a, button")).some((b) => /^apply( for this job| now)?$/i.test(clean(b.textContent)));
      const pageKind: PageKind = fields.length > 0 ? "form" : shape.confirmation(doc) ? "confirmation" : apply ? "posting" : "other";
      return { pageKind, jobRef: recognisePortal(doc.URL).ref, stepLabel: null, stepCount: null, fields };
    },

    async fill(doc, answers, files: FileToAttach[] = []) {
      const outcomes = new Map<string, FieldOutcome>();
      const report = (fieldId: string, outcome: FieldOutcome["outcome"], source: FieldOutcome["source"] = null, choices?: string[]) =>
        outcomes.set(fieldId, choices ? { fieldId, outcome, source, choices } : { fieldId, outcome, source });

      // Files first: the portal's own CV reading runs when the CV goes in, before anything else is filled.
      const pending: { fieldId: string; el: HTMLElement; box: Element; file: FileToAttach; label: string }[] = [];
      for (const a of answers) {
        if (a.kind !== "file") continue;
        const found = find(doc, a.fieldId);
        if (!found) { report(a.fieldId, "skipped"); continue; }
        const el = found.item.el;
        const box = fileBox(el);
        const file = files.find((f) => f.which === a.which && f.fileName === a.fileName);
        const now = chosen(el);
        if (now === a.fileName && shows(box, a.fileName)) {
          mark(box, "filled", a.fieldId);
          report(a.fieldId, "filled", a.source);
        } else if (now && now !== a.fileName) {
          mark(box, "kept", a.fieldId);
          report(a.fieldId, "kept");
        } else if (!file || !attachFile(el, file, "change", null, found.field.label)) {
          mark(box, "didnt-stick", a.fieldId);
          report(a.fieldId, "didnt-stick");
        } else {
          attached.add(a.fieldId);
          pending.push({ fieldId: a.fieldId, el, box, file, label: found.field.label });
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

      for (const a of answers) {
        if (a.kind === "file") continue;
        const found = find(doc, a.fieldId);
        if (!found || a.kind === "skip") { report(a.fieldId, "skipped"); continue; }
        const { item, field } = found;
        if (a.kind === "needs-you") {
          mark(markTarget(item, shape), "needs-you", a.fieldId);
          report(a.fieldId, "needs-you");
          continue;
        }
        const refused = item.kind === "yes-no" ? item.members.some((b) => choiceRefusal(b)) : item.members.some((m) => refusal(m, field.label));
        if (refused || field.consent) { report(a.fieldId, "skipped"); continue; }
        const current = field.value;
        if (current.trim() !== "") {
          // Filled by apply-kit on an earlier click and untouched since: still apply-kit's. Anything else
          // (Kris's value, or what the portal read from the CV) is kept.
          if (filled.get(a.fieldId) === current) { report(a.fieldId, "filled", a.source); continue; }
          mark(markTarget(item, shape), "kept", a.fieldId);
          report(a.fieldId, "kept");
          continue;
        }
        const put = item.kind === "typeahead" ? await putTypeahead(doc, a.fieldId, a.value) : putNow(doc, a.fieldId, a.value);
        report(a.fieldId, put.outcome, put.outcome === "filled" ? a.source : null, put.choices);
      }
      return answers.map((a) => outcomes.get(a.fieldId)!);
    },

    replace(doc, fieldId, value) {
      unmark(doc, fieldId);
      return putNow(doc, fieldId, value).outcome;
    },

    undo(doc) {
      let restored = 0;
      for (const id of attached) {
        const found = find(doc, id);
        if (found && clearFile(found.item.el, found.field.label)) restored++;
      }
      attached.clear();
      for (const restore of previous.values()) if (restore()) restored++;
      previous.clear();
      filled.clear();
      removeMarks(doc);
      return restored;
    },

    show(doc, fieldId) {
      const found = find(doc, fieldId);
      if (!found) return false;
      showField(found.item.members[0] ?? found.item.el);
      return true;
    },
  };
}
