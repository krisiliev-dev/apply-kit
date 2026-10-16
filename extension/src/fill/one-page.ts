// A filler for a portal whose application is one page of form controls, some of them inside web
// components' shadow roots (SmartRecruiters, Workable; Apply #45), built from the portal's shape:
// where its form is, which components hold a control, how its repeating entries are named, how it
// marks optional fields, its step label and its thank-you. It reads the form in the portal's order,
// walking open shadow roots; a component whose root is closed can't be read or filled, so it is
// listed as needs-you with apply-kit's value to copy, never guessed. Files go in first, then the
// values into fields still empty; each value is read back once after the page settles. It keeps only
// the previous values and which fields it filled, in the page's isolated world. It never presses a
// button (an entry's Add included).
import type { EntrySection, FieldKind, FieldOutcome, FieldStructure, PageReading, ReadField } from "@apply-kit/core";
import { describingAttribute } from "@apply-kit/core/field-report";
import { recognisePortal } from "../portal.ts";
import type { FileToAttach, Filler } from "./greenhouse.ts";
import { attachFile, choose, clearFile, consentWords, mark, refusal, removeMarks, setChecked, setValue, showField, unmark } from "./page-actions.ts";

export interface PageShape {
  /** The application form, or null when the page shows none. */
  form(doc: Document): Element | null;
  /** The portal's components that hold a control, by tag, with the kind of field each is (for one whose shadow root is closed). */
  components?: Record<string, FieldKind>;
  /** A repeating section's entries: the section, one entry in it, and the section's name ("Experience"), for labels like "Experience 1 › Title". */
  entries?: { section: string; entry: string; name(section: Element): string };
  /** The portal marks optional fields with "Optional" in their label and the rest are required (Workable). */
  optionalInText?: boolean;
  /** The portal's own name for this step, if it shows one. */
  stepLabel?(doc: Document): string | null;
  /** The portal's thank-you after Submit, from the page's address and text. */
  confirmation(doc: Document): boolean;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** One field: a control, or a component whose closed shadow root hides its control (`closed`). */
interface Item {
  el: HTMLElement;
  closed: boolean;
  repeating?: EntrySection;
}

const optionalWords = /\(?\boptional\b\)?/i;
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").replace(/\s*[*✱]\s*$/u, "").trim();
const typeOf = (el: Element) => (el.getAttribute("type") ?? "").toLowerCase();
const isRadio = (el: Element) => typeOf(el) === "radio";
const isControl = (el: Element) => ["input", "select", "textarea"].includes(el.tagName.toLowerCase());
const rootOf = (el: Element) => el.getRootNode() as Document | ShadowRoot;
const hostOf = (el: Element): Element | null => (rootOf(el) as ShadowRoot).host ?? null;

/** Every element under `node` in the order the page shows them, each open shadow root in its host's place. */
function walk(node: ParentNode, out: Element[] = []): Element[] {
  for (const el of Array.from(node.children)) {
    out.push(el);
    if (el.shadowRoot) walk(el.shadowRoot, out);
    walk(el, out);
  }
  return out;
}

/** `closest` that carries on past a shadow root to its host. */
function closestAcross(el: Element, selector: string): Element | null {
  for (let at: Element | null = el; at; at = hostOf(at)) {
    const hit = at.closest(selector);
    if (hit) return hit;
  }
  return null;
}

function byIds(el: Element, ids: string | null): string {
  const root = rootOf(el);
  return (ids ?? "").split(/\s+/).filter(Boolean).map((id) => (root.getElementById(id) ?? el.ownerDocument.getElementById(id))?.textContent ?? "").join(" ");
}

function items(doc: Document, shape: PageShape): Item[] {
  const root = shape.form(doc);
  if (!root) return [];
  const out: Item[] = [];
  const groups = new Set<string>();
  for (const el of walk(root) as HTMLElement[]) {
    const tag = el.tagName.toLowerCase();
    if (shape.entries && el.matches(shape.entries.section)) out.push({ el, closed: false, repeating: /education|образ/iu.test(shape.entries.name(el)) ? "education" : "work" });
    if (shape.components?.[tag] && !el.shadowRoot && !el.querySelector("input, select, textarea")) {
      out.push({ el, closed: true });
      continue;
    }
    if (!isControl(el)) continue;
    const type = typeOf(el);
    if (["hidden", "submit", "button", "image", "reset"].includes(type) || (el as Control).disabled) continue;
    if (type === "radio") {
      const key = `${el.getAttribute("name")}`;
      if (groups.has(key)) continue;
      groups.add(key);
    }
    out.push({ el, closed: false });
  }
  return out;
}

/** Every button of the radio group a radio belongs to, in its own shadow root or form. */
function radios(el: Element): HTMLInputElement[] {
  const name = el.getAttribute("name");
  return name ? Array.from(rootOf(el).querySelectorAll<HTMLInputElement>("input[type=radio]")).filter((r) => r.getAttribute("name") === name) : [el as HTMLInputElement];
}

function fieldId({ el, repeating }: Item, index: number): string {
  if (repeating) return `section-${repeating}`;
  if (isRadio(el)) return el.getAttribute("name") || el.id || `field-${index}`;
  return el.id || el.getAttribute("name") || hostOf(el)?.id || `field-${index}`;
}

/** Every place a field's label can come from, in the order the filler looks. */
function labelChain({ el, closed }: Item): { from: string; text: string }[] {
  const chain: { from: string; text: string }[] = [];
  const add = (from: string, text: string | null | undefined) => { const t = clean(text); if (t) chain.push({ from, text: t }); };
  if (closed) {
    add("component label", el.getAttribute("label"));
    add("aria-label", el.getAttribute("aria-label"));
    return chain;
  }
  if (isRadio(el)) {
    const group = el.closest("fieldset, [role=radiogroup]");
    add("legend", group?.querySelector("legend")?.textContent);
    add("group aria-labelledby", byIds(el, group?.getAttribute("aria-labelledby") ?? null));
    add("group aria-label", group?.getAttribute("aria-label"));
  }
  if (el.id) add("label[for]", Array.from(rootOf(el).querySelectorAll("label")).find((l) => l.getAttribute("for") === el.id)?.textContent);
  add("aria-labelledby", byIds(el, el.getAttribute("aria-labelledby")));
  add("wrapping label", el.closest("label")?.textContent);
  add("aria-label", el.getAttribute("aria-label"));
  add("placeholder", el.getAttribute("placeholder"));
  add("component label", hostOf(el)?.getAttribute("label"));
  return chain;
}

/** The label as the portal shows it, and as the panel names it: "Experience 1 › Title" inside a repeating entry. */
function labelOf(item: Item, shape: PageShape): { raw: string; label: string } {
  const raw = (isRadio(item.el) ? labelChain(item).find((l) => /legend|group/.test(l.from)) : null)?.text ?? labelChain(item).find((l) => !/legend|group/.test(l.from))?.text ?? "";
  let label = clean(shape.optionalInText ? raw.replace(optionalWords, " ") : raw);
  if (shape.entries) {
    const entry = closestAcross(item.el, shape.entries.entry);
    const section = entry && closestAcross(entry, shape.entries.section);
    if (entry && section) label = `${shape.entries.name(section)} ${Array.from(section.querySelectorAll(shape.entries.entry)).indexOf(entry) + 1} › ${label}`;
  }
  return { raw, label };
}

function kindOf({ el, closed }: Item, shape: PageShape): FieldKind {
  const tag = el.tagName.toLowerCase();
  if (closed) return shape.components?.[tag] ?? "text";
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete")) return "typeahead";
  const type = typeOf(el) || "text";
  return (["email", "tel", "url", "number", "date", "file", "checkbox", "radio"] as const).find((k) => k === type) ?? "text";
}

function ownLabel(el: Element): string {
  return clean(labelChain({ el: el as HTMLElement, closed: false }).find((l) => !/legend|group/.test(l.from))?.text);
}

function valueOf({ el, closed }: Item): string {
  if (typeOf(el) === "password") return "";
  if (closed) return "";
  const type = typeOf(el);
  if (type === "radio") {
    const on = radios(el).find((r) => r.checked);
    return on ? ownLabel(on) : "";
  }
  if (type === "checkbox") return (el as HTMLInputElement).checked ? "checked" : "";
  if (el.tagName.toLowerCase() === "select") {
    const s = el as HTMLSelectElement;
    return s.value ? (s.options[s.selectedIndex]?.text.trim() ?? s.value) : "";
  }
  return (el as Control).value;
}

function readField(item: Item, index: number, shape: PageShape): ReadField {
  const { el, closed } = item;
  if (item.repeating && shape.entries) return { id: fieldId(item, index), label: shape.entries.name(el), kind: "repeating", required: false, value: String(el.querySelectorAll(shape.entries.entry).length), options: [], maxLength: null, consent: false, password: false, hint: null, entry: { section: item.repeating, index: 0 } };
  const ownEntry = shape.entries && closestAcross(el, shape.entries.entry);
  const section = ownEntry && closestAcross(ownEntry, shape.entries!.section);
  const entry = ownEntry && section ? { section: /education|образ/iu.test(shape.entries!.name(section)) ? "education" as const : "work" as const, index: Array.from(section.querySelectorAll(shape.entries!.entry)).indexOf(ownEntry) + 1 } : null;
  const { raw, label } = labelOf(item, shape);
  const kind = kindOf(item, shape);
  const hint = el.getAttribute("autocomplete");
  const max = Number(el.getAttribute("maxlength"));
  const host = closed ? el : hostOf(el);
  const marked = (kind === "radio" ? radios(el) : [el]).some((r) => r.hasAttribute("required") || r.getAttribute("aria-required") === "true") || !!host?.hasAttribute("required") || /\*/.test(raw);
  return {
    id: fieldId(item, index),
    label,
    kind,
    required: shape.optionalInText ? !optionalWords.test(raw) : marked,
    value: valueOf(item),
    options: closed ? [] : kind === "select" ? Array.from((el as HTMLSelectElement).options).filter((o) => o.value !== "").map((o) => o.text.trim())
      : kind === "radio" ? radios(el).map(ownLabel) : [],
    maxLength: Number.isFinite(max) && max > 0 ? max : null,
    consent: consentWords.test(label),
    password: typeOf(el) === "password",
    hint: typeOf(el) === "month" ? "month-year" : hint && hint !== "on" && hint !== "off" ? hint : null,
    ...(entry ? { entry } : {}),
  };
}

/** The upload box around a file input: where the portal shows the chosen file's name and takes a dropped file. */
const fileBox = (el: Element) => closestAcross(el, ".field, .file-upload, [class*=upload], [class*=drop]") ?? el.parentElement ?? el;
const shows = (box: Element, fileName: string) => (box.textContent ?? "").includes(fileName);
const chosen = (el: Element) => (el as HTMLInputElement).files?.[0]?.name ?? "";

export function createOnePageFiller(shape: PageShape, { settleMs = 1500 }: { settleMs?: number } = {}): Filler {
  /** Field id → the value it had before apply-kit changed it. */
  const addedEntries: Element[] = [];
  const previous = new Map<string, string>();
  /** File fields apply-kit attached a file to (Undo empties them). */
  const attached = new Set<string>();
  /** Field id → the value apply-kit put in. */
  const filled = new Map<string, string>();
  /** Fields Kris answered from the panel. */
  const yours = new Set<string>();
  const settle = () => (settleMs > 0 ? new Promise<void>((done) => setTimeout(done, settleMs)) : Promise.resolve());

  const find = (doc: Document, id: string) => {
    const all = items(doc, shape);
    const i = all.findIndex((item, n) => fieldId(item, n) === id);
    return i < 0 ? null : { item: all[i]!, el: all[i]!.el, field: readField(all[i]!, i, shape) };
  };

  /** Sets a field to a value in its own way: text, an option, a radio button by its label, a tick ("checked" or ""). */
  function set(item: Item, kind: FieldKind, value: string, label: string): boolean {
    if (item.closed) return false;
    const el = item.el;
    if (kind === "radio") {
      const group = radios(el);
      if (value === "") return group.every((r) => !r.checked || setChecked(r, false, label));
      const pick = group.find((r) => ownLabel(r).toLowerCase() === value.trim().toLowerCase());
      return !!pick && setChecked(pick, true, label);
    }
    if (kind === "checkbox") return setChecked(el, value === "checked", label);
    return setValue(el, value, label);
  }

  function put(doc: Document, id: string, value: string): FieldOutcome["outcome"] {
    const found = find(doc, id);
    if (!found) return "didnt-stick";
    const before = found.field.value;
    if (!set(found.item, found.field.kind, value, found.field.label)) return "didnt-stick";
    if (!previous.has(id)) previous.set(id, before);
    const now = valueOf(found.item);
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
    if (found && put !== undefined && valueOf(found.item).trim() === put.trim()) return "filled";
    filled.delete(id);
    if (found) mark(found.el, "didnt-stick", id);
    return "didnt-stick";
  }

  return {
    read(doc): PageReading {
      const fields = items(doc, shape).map((item, i) => readField(item, i, shape));
      return {
        pageKind: fields.length > 0 ? "form" : shape.confirmation(doc) ? "confirmation" : "other",
        jobRef: recognisePortal(doc.URL).ref,
        stepLabel: shape.stepLabel?.(doc) ?? null,
        stepCount: null,
        fields,
      };
    },

    async fill(doc, answers, files: FileToAttach[] = []) {
      const outcomes = new Map<string, FieldOutcome>();
      const report = (fieldId: string, outcome: FieldOutcome["outcome"], source: FieldOutcome["source"] = null) => outcomes.set(fieldId, { fieldId, outcome, source });

      // Files first: the portal's own CV reading runs when the CV goes in, before anything else is filled.
      const pending: { fieldId: string; el: Element; box: Element; file: FileToAttach; label: string }[] = [];
      for (const a of answers) {
        if (a.kind !== "file") continue;
        const found = find(doc, a.fieldId);
        if (!found || found.item.closed) {
          if (found) mark(found.el, "didnt-stick", a.fieldId);
          report(a.fieldId, found ? "didnt-stick" : "skipped");
          continue;
        }
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
        if (a.kind === "entries") {
          const own = items(doc, shape).find((i) => i.repeating === a.section);
          let count = 0;
          if (own && shape.entries) {
            for (let n = 0; n < Math.min(a.add, 50); n++) {
              const before = Array.from(own.el.querySelectorAll(shape.entries.entry));
              const add = own.el.querySelector<HTMLButtonElement>('button[type="button"].add-entry, button[type="button"][data-ui^="add-"]');
              if (!add || !choose(add)) break;
              for (let waited = 0; own.el.querySelectorAll(shape.entries.entry).length <= before.length && waited < 2000; waited += 50) await new Promise<void>((resolve) => setTimeout(resolve, 50));
              const fresh = Array.from(own.el.querySelectorAll(shape.entries.entry)).filter((el) => !before.includes(el));
              if (!fresh.length) break;
              addedEntries.push(...fresh); count++;
            }
          }
          report(a.fieldId, count === a.add ? "filled" : "needs-you", count === a.add ? "cv-version" : null);
          continue;
        }
        const found = find(doc, a.fieldId);
        if (!found || a.kind === "skip") { report(a.fieldId, "skipped"); continue; }
        // A closed component can't be read or filled: Kris types (or pastes) apply-kit's value.
        if (a.kind === "needs-you" && !found.item.closed) {
          const current = found.field.value;
          // Answered: from the panel (Kris's), or typed on the page (kept, so apply-kit can offer it to the bank).
          if (current.trim() !== "" && yours.has(a.fieldId) && filled.get(a.fieldId) === current) { report(a.fieldId, "filled", "you"); continue; }
          if (current.trim() !== "") {
            mark(found.el, "kept", a.fieldId);
            report(a.fieldId, "kept");
            continue;
          }
        }
        if (a.kind === "needs-you" || found.item.closed) {
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
      for (const entry of addedEntries.splice(0).reverse()) {
        const remove = entry.querySelector('button[type="button"].remove-entry, button[type="button"][data-ui^="remove-"], button[type="button"][aria-label^="Remove"]');
        if (remove && choose(remove)) restored++;
      }
      for (const id of attached) {
        const found = find(doc, id);
        if (found && clearFile(found.el, found.field.label)) restored++;
      }
      attached.clear();
      for (const [id, before] of previous) {
        const found = find(doc, id);
        if (found && set(found.item, found.field.kind, before, found.field.label)) restored++;
      }
      previous.clear();
      filled.clear();
      yours.clear();
      removeMarks(doc);
      return restored;
    },

    describe(doc, fieldId): FieldStructure | null {
      const found = find(doc, fieldId);
      if (!found) return null;
      const { el, field, item } = found;
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
        labelChain: labelChain(item).filter((l) => !holds(l.text)),
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
