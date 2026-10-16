// The Workday filler (Apply #44): reads one step of a Workday application (My Information, My
// Experience, Application Questions, Voluntary Disclosures, Self Identify, Review), the start screen
// and the confirmation, with the step's label and count from Workday's own stepper; fills a step's
// answers through page actions, page by page; and undoes what it changed. Workday's list buttons,
// typeaheads and the repeating sections' Add and Delete need a press: the filler uses the one it's
// given and, without one, leaves those widgets to Kris as needs-you fields. It never presses Back,
// Save and Continue, Next or Submit; on the review step it only rings Submit.
import type { EntrySection, FieldAnswer, FieldKind, FieldOutcome, FieldStructure, PageReading, ReadField } from "@apply-kit/core";
import { describingAttribute } from "@apply-kit/core/field-report";
import { recognisePortal } from "../portal.ts";
import type { FileToAttach, Filler } from "./greenhouse.ts";
import { attachFile, choose, clearFile, consentWords, mark, pressWidget, refusal, removeMarks, setChecked, setValue, showField, unmark, type Press } from "./page-actions.ts";

export interface WorkdayOptions {
  /** The click Workday's widgets need; null leaves them to Kris. */
  press?: Press | null;
  /** How long to let the page settle after attaching the CV (Workday reads it and adds entries). */
  settleMs?: number;
  /** The longest wait for a typeahead's suggestions or a list's options. */
  waitMs?: number;
}

type Kind = FieldKind;
interface WField {
  id: string;
  kind: Kind;
  /** The formField box (or the section), where marks go. */
  box: Element;
  control: Element | null;
  label: string;
  required: boolean;
  entry: { section: EntrySection; index: number } | null;
  hint: string | null;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();
const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}+]+/gu, " ").trim();
const sections: Record<string, EntrySection> = { workExperience: "work", education: "education" };
const sectionKey: Record<EntrySection, string> = { work: "workExperience", education: "education" };
const empty = "select one";

function root(doc: Document): Element {
  return doc.querySelector("[data-automation-id=applyFlowPage]") ?? doc.body;
}

/** The step Workday's stepper shows as current, and its position as the stepper prints it ("current step 2 of 6"). */
function stepper(doc: Document): { label: string | null; count: { current: number; total: number } | null } {
  const active = doc.querySelector("[data-automation-id=progressBarActiveStep]");
  if (!active) return { label: null, count: null };
  const printed = /step (\d+) of (\d+)/i.exec(active.querySelector("label")?.textContent ?? "");
  const label = clean(Array.from(active.children).filter((c) => c.tagName.toLowerCase() !== "label").map((c) => c.textContent).join(" ")) || null;
  if (printed) return { label, count: { current: Number(printed[1]), total: Number(printed[2]) } };
  const all = Array.from(active.parentElement?.children ?? []).filter((c) => /^progressBar\w*Step$/.test(c.getAttribute("data-automation-id") ?? ""));
  return { label, count: all.length ? { current: all.indexOf(active) + 1, total: all.length } : null };
}

function labelOf(box: Element, control: Element | null): { text: string; raw: string } {
  const doc = box.ownerDocument;
  const legend = box.querySelector("legend");
  const forIt = control?.id ? Array.from(box.querySelectorAll("label")).find((l) => l.getAttribute("for") === control.id) : null;
  const by = control?.getAttribute("aria-labelledby");
  const el = legend ?? forIt ?? (by ? doc.getElementById(by.split(/\s+/)[0]!) : null) ?? box.querySelector("label");
  const raw = el?.textContent ?? "";
  return { text: clean(raw), raw: el?.querySelector("abbr") ? `${raw}*` : raw };
}

function controlOf(box: Element): { kind: Kind; control: Element | null; hint: string | null } {
  const file = box.querySelector("input[type=file]");
  if (file) return { kind: "file", control: file, hint: null };
  const date = box.querySelector("[data-automation-id=dateInputWrapper]");
  if (date) return { kind: "date", control: date, hint: date.querySelector("[data-automation-id=dateSectionMonth-input]") ? "month-year" : "year" };
  const list = box.querySelector("button[aria-haspopup=listbox]");
  if (list) return { kind: "select", control: list, hint: null };
  const typeahead = box.querySelector("input[data-uxi-widget-type=selectinput], input[role=combobox]");
  if (typeahead) return { kind: "typeahead", control: typeahead, hint: null };
  const choices = box.querySelectorAll("input[type=radio], input[type=checkbox]");
  if (choices.length > 1 || box.querySelector("input[type=radio]")) return { kind: "radio", control: choices[0]!, hint: null };
  if (choices.length === 1) return { kind: "checkbox", control: choices[0]!, hint: null };
  const area = box.querySelector("textarea");
  if (area) return { kind: "textarea", control: area, hint: null };
  const input = box.querySelector("input");
  if (!input) return { kind: "text", control: null, hint: null };
  const type = (input.getAttribute("type") ?? "text").toLowerCase();
  return { kind: (["email", "tel", "url", "number"] as const).find((k) => k === type) ?? "text", control: input, hint: input.getAttribute("autocomplete") };
}

/** The step's fields in Workday's order: each formField, and each repeating section before its entries. */
function fields(doc: Document): WField[] {
  const out: WField[] = [];
  for (const box of Array.from(root(doc).querySelectorAll('[data-automation-id^="formField-"], [role=group][data-automation-id$="Section"]'))) {
    const aid = box.getAttribute("data-automation-id")!;
    if (aid.endsWith("Section")) {
      const key = aid.replace(/Section$/, "");
      const section = sections[key];
      if (!section) continue;
      out.push({ id: key, kind: "repeating", box, control: box.querySelector(":scope > [data-automation-id=add-button]"), label: clean(box.querySelector("h3")?.textContent), required: false, entry: { section, index: 0 }, hint: null });
      continue;
    }
    const name = aid.replace(/^formField-/, "");
    const holder = box.parentElement?.closest('[role=group][data-automation-id*="-"]');
    const m = holder ? /^(workExperience|education)-(\d+)$/.exec(holder.getAttribute("data-automation-id") ?? "") : null;
    const entry = m ? { section: sections[m[1]!]!, index: Number(m[2]) } : null;
    const id = m ? `${m[0]}/${name.slice(m[0].length).replace(/^-+/, "")}` : name;
    const { kind, control, hint } = controlOf(box);
    const { text, raw } = labelOf(box, control);
    const required = /\*/.test(raw) || !!control?.matches("[aria-required=true]") || !!box.querySelector("[aria-required=true]");
    out.push({ id, kind, box, control, label: text, required, entry, hint });
  }
  return out;
}

const entriesOf = (doc: Document, section: EntrySection) =>
  Array.from(doc.querySelectorAll(`[data-automation-id="${sectionKey[section]}Section"] > [role=group][data-automation-id^="${sectionKey[section]}-"]`));

function choiceBoxes(f: WField): HTMLInputElement[] {
  return Array.from(f.box.querySelectorAll<HTMLInputElement>("input[type=radio], input[type=checkbox]"));
}
const choiceLabel = (el: Element) => clean(Array.from(el.ownerDocument.querySelectorAll("label")).find((l) => l.getAttribute("for") === el.id)?.textContent);

function picked(f: WField): string[] {
  const container = f.control?.closest("[data-automation-id=multiselectInputContainer]");
  return Array.from(container?.querySelectorAll("[data-automation-id=selectedItem]") ?? []).map((i) => clean(i.querySelector("p")?.textContent ?? i.textContent));
}

function dateParts(f: WField): { month: HTMLInputElement | null; year: HTMLInputElement | null } {
  return {
    month: f.box.querySelector<HTMLInputElement>("[data-automation-id=dateSectionMonth-input]"),
    year: f.box.querySelector<HTMLInputElement>("[data-automation-id=dateSectionYear-input]"),
  };
}

function valueOf(f: WField, doc: Document): string {
  switch (f.kind) {
    case "repeating": return String(entriesOf(doc, f.entry!.section).length);
    case "select": {
      const t = clean(f.control?.textContent);
      return norm(t) === empty ? "" : t;
    }
    case "typeahead": return picked(f).join("\n");
    case "date": {
      const { month, year } = dateParts(f);
      const y = year?.value.trim() ?? "";
      const mo = month?.value.trim() ?? "";
      if (!month) return y;
      return y || mo ? `${y}-${mo.padStart(mo ? 2 : 0, "0")}` : "";
    }
    case "radio": return choiceBoxes(f).filter((r) => r.checked).map(choiceLabel).join("\n");
    case "checkbox": return (f.control as HTMLInputElement).checked ? "checked" : "";
    case "file": return (f.control as HTMLInputElement).files?.[0]?.name ?? "";
    default: return (f.control as HTMLInputElement | null)?.value ?? "";
  }
}

function toRead(f: WField, doc: Document): ReadField {
  const max = Number(f.control?.getAttribute("maxlength"));
  const hint = f.hint && f.hint !== "on" && f.hint !== "off" ? f.hint : null;
  return {
    id: f.id, label: f.label, kind: f.kind, required: f.required, value: valueOf(f, doc),
    options: f.kind === "radio" ? choiceBoxes(f).map(choiceLabel) : [],
    maxLength: Number.isFinite(max) && max > 0 ? max : null,
    consent: (f.kind === "checkbox" || f.kind === "radio") && consentWords.test(f.label + " " + choiceBoxes(f).map(choiceLabel).join(" ")),
    password: f.control?.getAttribute("type") === "password",
    hint,
    entry: f.entry,
  };
}

/** Which of the offered options a value is: the exact one, the only plausible one, or a choice for Kris. */
export function matchOption(value: string, options: string[]): { pick: string } | { choices: string[] } {
  const v = norm(value);
  const real = options.filter((o) => norm(o) !== empty);
  const exact = real.filter((o) => norm(o) === v);
  if (exact.length === 1) return { pick: exact[0]! };
  const yn = /^(yes|no|да|не)$/.exec(v)?.[0];
  if (yn) {
    const hits = real.filter((o) => norm(o).split(" ")[0] === yn);
    if (hits.length === 1) return { pick: hits[0]! };
  }
  const near = real.filter((o) => norm(o).includes(v) || (norm(o).length > 2 && v.includes(norm(o))));
  if (near.length === 1) return { pick: near[0]! };
  return { choices: near };
}

export function createWorkdayFiller({ press = choose, settleMs = 1500, waitMs = 3000 }: WorkdayOptions = {}): Filler {
  /** Field id → the value it had before apply-kit changed it (this step). */
  const previous = new Map<string, string>();
  /** Field id → the value apply-kit put in. */
  const filled = new Map<string, string>();
  const attached = new Set<string>();
  /** Entries apply-kit added with Add, per section, for Undo. */
  const added = new Map<EntrySection, number>();
  /** Each section's entry count when the page was read: an entries answer for a page that changed since is stale. */
  const readCounts = new Map<string, number>();
  let step: string | null = null;

  const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  async function waitFor<T>(check: () => T | null | undefined | false): Promise<T | null> {
    for (let waited = 0; ; waited += 50) {
      const r = check();
      if (r) return r;
      if (waited >= waitMs) return null;
      await sleep(50);
    }
  }
  const find = (doc: Document, id: string) => fields(doc).find((f) => f.id === id) ?? null;
  const markAt = (f: WField) => (f.kind === "text" || f.kind === "email" || f.kind === "tel" || f.kind === "url" || f.kind === "number" || f.kind === "textarea" ? f.control ?? f.box : f.box);

  /** The listbox a list button or typeahead opened, and its options. */
  const optionsFor = (doc: Document, control: Element) => {
    const id = control.getAttribute("aria-controls");
    const list = (id ? doc.getElementById(id) : null) ?? doc.querySelector("[role=listbox]");
    const options = Array.from(list?.querySelectorAll("[role=option]") ?? []);
    return options.length ? options : null;
  };
  const optionText = (o: Element) => clean(o.textContent);

  /** Opens a list button, picks `value` if one option is it; closes the list otherwise. */
  async function fromList(doc: Document, f: WField, value: string): Promise<{ outcome: FieldOutcome["outcome"]; choices?: string[] }> {
    const button = f.control!;
    if (!pressWidget(button, press, f.label)) return { outcome: "needs-you" };
    const options = await waitFor(() => optionsFor(doc, button));
    if (!options) return { outcome: "didnt-stick" };
    const m = matchOption(value, options.map(optionText));
    if ("pick" in m) {
      const option = options.find((o) => optionText(o) === m.pick)!;
      pressWidget(option, press);
      return { outcome: valueOf(f, doc) === m.pick ? "filled" : "didnt-stick" };
    }
    pressWidget(button, press, f.label);
    return { outcome: "needs-you", choices: m.choices.length > 1 ? m.choices : undefined };
  }

  /** Types into a typeahead, waits for Workday's suggestions, and picks the match; nothing typed is left behind otherwise. */
  async function typeAndPick(doc: Document, f: WField, value: string, exactly = false): Promise<{ outcome: FieldOutcome["outcome"]; choices?: string[] }> {
    const input = f.control!;
    if (!press || !setValue(input, value, f.label)) return { outcome: "needs-you" };
    const options = await waitFor(() => optionsFor(doc, input));
    const m = options ? (exactly ? { pick: options.map(optionText).find((o) => o === value) } : matchOption(value, options.map(optionText))) : { choices: [] };
    if ("pick" in m && m.pick) {
      pressWidget(options!.find((o) => optionText(o) === m.pick)!, press);
      if (picked(f).includes(m.pick)) return { outcome: "filled" };
    }
    // No partial selection: the typed text goes, and no suggestion list stays open.
    setValue(input, "", f.label);
    const choices = "choices" in m ? m.choices : [];
    return { outcome: options ? "needs-you" : "didnt-stick", choices: choices.length > 1 ? choices : undefined };
  }

  async function setDate(f: WField, value: string): Promise<boolean> {
    const { month, year } = dateParts(f);
    const [y, mo] = value.split("-");
    if (!year || !y) return false;
    if (month && mo && !setValue(month, mo, f.label)) return false;
    return setValue(year, y, f.label);
  }

  /** Puts a value in an empty field in its own way. */
  async function put(doc: Document, f: WField, value: string): Promise<{ outcome: FieldOutcome["outcome"]; choices?: string[] }> {
    const before = valueOf(f, doc);
    let r: { outcome: FieldOutcome["outcome"]; choices?: string[] };
    switch (f.kind) {
      case "select": r = await fromList(doc, f, value); break;
      case "typeahead": {
        const wanted = value.split("\n").map((v) => v.trim()).filter(Boolean);
        r = { outcome: "filled" };
        for (const v of wanted.filter((w) => !picked(f).includes(w))) {
          const one = await typeAndPick(doc, f, v);
          if (one.outcome !== "filled") { r = wanted.length > 1 ? { outcome: "needs-you" } : one; if (!press) break; }
        }
        break;
      }
      case "date": r = { outcome: (await setDate(f, value)) && valueOf(f, doc) === value ? "filled" : "didnt-stick" }; break;
      case "radio": {
        const box = choiceBoxes(f).find((b) => norm(choiceLabel(b)) === norm(value)) ?? choiceBoxes(f).find((b) => "pick" in matchOption(value, [choiceLabel(b)]));
        r = { outcome: box && setChecked(box, true, f.label) && valueOf(f, doc) === choiceLabel(box) ? "filled" : "didnt-stick" };
        break;
      }
      case "checkbox": r = { outcome: setChecked(f.control!, value === "checked", f.label) && valueOf(f, doc) === value ? "filled" : "didnt-stick" }; break;
      default: r = { outcome: f.control && setValue(f.control, value, f.label) && valueOf(f, doc).trim() === value.trim() ? "filled" : "didnt-stick" };
    }
    if (r.outcome === "filled" || valueOf(f, doc) !== before) {
      if (!previous.has(f.id)) previous.set(f.id, before);
      filled.set(f.id, valueOf(f, doc));
    }
    return r;
  }

  /** Adds entries to a repeating section with Workday's own Add, one at a time, checking each arrived. */
  async function addEntries(doc: Document, f: WField, count: number): Promise<FieldOutcome["outcome"]> {
    const section = f.entry!.section;
    for (let k = 0; k < count; k++) {
      const before = entriesOf(doc, section).length;
      const add = doc.querySelector(`[data-automation-id="${sectionKey[section]}Section"] > [data-automation-id=add-button]`);
      if (!add || !pressWidget(add, press, f.label)) return k === 0 ? "needs-you" : "didnt-stick";
      if (!(await waitFor(() => entriesOf(doc, section).length > before))) return "didnt-stick";
      added.set(section, (added.get(section) ?? 0) + 1);
    }
    return "filled";
  }

  async function deleteEntry(doc: Document, section: EntrySection, index: number): Promise<boolean> {
    const entry = doc.querySelector(`[data-automation-id="${sectionKey[section]}-${index}"]`);
    const del = entry?.querySelector("[data-automation-id=panel-set-delete-button]");
    const before = entriesOf(doc, section).length;
    if (!del || !pressWidget(del, press)) return false;
    return !!(await waitFor(() => entriesOf(doc, section).length < before));
  }

  function newStep(doc: Document) {
    const label = stepper(doc).label;
    if (label === step) return;
    step = label;
    previous.clear();
    filled.clear();
    attached.clear();
    added.clear();
  }

  /** A value Kris gave (or apply-kit's again) into one typed field: text, a date, a radio choice or a tick. Lists and typeaheads wait for Workday: `pick`. */
  function putNow(doc: Document, fieldId: string, value: string): FieldOutcome["outcome"] {
    const f = find(doc, fieldId);
    if (!f?.control) return "didnt-stick";
    unmark(doc, fieldId);
    const before = valueOf(f, doc);
    let ok: boolean;
    if (f.kind === "date") {
      const { month, year } = dateParts(f);
      const [y, m] = value.split("-");
      ok = !!year && setValue(year, y ?? "", f.label) && (!month || !m || setValue(month, m, f.label));
    } else if (f.kind === "radio") {
      const box = choiceBoxes(f).find((b) => norm(choiceLabel(b)) === norm(value));
      ok = !!box && setChecked(box, true, f.label);
    } else if (f.kind === "checkbox") ok = setChecked(f.control, value === "checked", f.label);
    else if (["text", "email", "tel", "url", "number", "textarea"].includes(f.kind)) ok = setValue(f.control, value, f.label);
    else ok = false;
    const now = valueOf(f, doc);
    if (!ok || now.trim() !== (f.kind === "radio" ? choiceBoxes(f).map(choiceLabel).find((l) => norm(l) === norm(value)) ?? value : value).trim()) {
      mark(markAt(f), "didnt-stick", fieldId);
      return "didnt-stick";
    }
    if (!previous.has(fieldId)) previous.set(fieldId, before);
    filled.set(fieldId, now);
    mark(markAt(f), "filled", fieldId);
    return "filled";
  }

  return {
    read(doc) {
      const text = root(doc).textContent ?? "";
      const jobRef = recognisePortal(doc.URL).ref;
      const { label, count } = stepper(doc);
      const ws = fields(doc);
      for (const f of ws) if (f.kind === "repeating") readCounts.set(f.id, entriesOf(doc, f.entry!.section).length);
      if (doc.querySelector("[data-automation-id=applyManually], [data-automation-id=autofillWithResume]")) return { pageKind: "start", jobRef, stepLabel: null, stepCount: null, fields: [] };
      if (!label && (doc.querySelector("[data-automation-id=applicationSubmittedDialog]") || /application (has been )?submitted/i.test(text))) {
        return { pageKind: "confirmation", jobRef, stepLabel: null, stepCount: null, fields: [] };
      }
      const review = /^review$/i.test(label ?? "") || !!doc.querySelector("[data-automation-id=reviewPage]");
      const reading: PageReading = { pageKind: review ? "review" : ws.length ? "form" : "other", jobRef, stepLabel: label, stepCount: count, fields: review ? [] : ws.map((f) => toRead(f, doc)) };
      return reading;
    },

    async fill(doc, answers, files = []) {
      newStep(doc);
      // The review step: Submit is ringed so Kris finds it, never pressed.
      const submit = Array.from(root(doc).querySelectorAll("[data-automation-id=pageFooterNextButton], [data-automation-id=bottom-navigation-next-button]")).find((b) => /submit/i.test(b.textContent ?? ""));
      if (submit) mark(submit, "submit", "submit");

      const outcomes = new Map<string, FieldOutcome>();
      const report = (fieldId: string, outcome: FieldOutcome["outcome"], source: FieldOutcome["source"] = null, choices?: string[]) =>
        outcomes.set(fieldId, choices ? { fieldId, outcome, source, choices } : { fieldId, outcome, source });

      // The CV first: Workday reads it and may add entries, so the page settles before anything else.
      const pending: { a: Extract<FieldAnswer, { kind: "file" }>; f: WField; box: Element; file: FileToAttach }[] = [];
      for (const a of answers) {
        if (a.kind !== "file") continue;
        const f = find(doc, a.fieldId);
        if (!f?.control) { report(a.fieldId, "skipped"); continue; }
        const box = f.box.querySelector(".file-upload, [data-automation-id=file-upload-drop-zone]") ?? f.box;
        const now = valueOf(f, doc);
        const file = files.find((x) => x.which === a.which && x.fileName === a.fileName);
        if (now === a.fileName && (box.textContent ?? "").includes(a.fileName)) { mark(box, "filled", a.fieldId); report(a.fieldId, "filled", "package"); }
        else if (now) { mark(box, "kept", a.fieldId); report(a.fieldId, "kept"); }
        else if (!file || !attachFile(f.control, file, "change", null, f.label)) { mark(box, "didnt-stick", a.fieldId); report(a.fieldId, "didnt-stick"); }
        else { attached.add(a.fieldId); pending.push({ a, f, box, file }); }
      }
      if (pending.length) {
        await sleep(settleMs);
        const dropped = pending.filter((p) => !(p.box.textContent ?? "").includes(p.file.fileName) && attachFile(p.f.control!, p.file, "drop", p.box, p.f.label));
        if (dropped.length) await sleep(settleMs);
        for (const p of pending) {
          const ok = (p.box.textContent ?? "").includes(p.file.fileName);
          mark(p.box, ok ? "filled" : "didnt-stick", p.a.fieldId);
          report(p.a.fieldId, ok ? "filled" : "didnt-stick", ok ? "package" : null);
        }
      }

      for (const a of answers) {
        if (a.kind === "file") continue;
        const f = find(doc, a.fieldId);
        if (!f || a.kind === "skip") { report(a.fieldId, "skipped"); continue; }
        if (a.kind === "entries") {
          const now = entriesOf(doc, a.section).length;
          const atRead = readCounts.get(f.id);
          // Workday changed the section since the page was read (its CV reading): read it again first.
          if (atRead !== undefined && atRead !== now) { report(a.fieldId, "skipped"); continue; }
          const outcome = a.add > 0 ? await addEntries(doc, f, a.add) : "filled";
          if (outcome !== "filled") mark(f.box, outcome === "needs-you" ? "needs-you" : "didnt-stick", a.fieldId);
          report(a.fieldId, outcome, outcome === "filled" ? "cv-version" : null);
          continue;
        }
        if (a.kind === "needs-you") { mark(markAt(f), "needs-you", a.fieldId); report(a.fieldId, "needs-you"); continue; }
        if (f.control && f.kind !== "select" && f.kind !== "radio" && f.kind !== "date" && refusal(f.control, f.label)) { report(a.fieldId, "skipped"); continue; }
        if ((f.kind === "radio" || f.kind === "checkbox") && consentWords.test(f.label)) { report(a.fieldId, "skipped"); continue; }
        const current = valueOf(f, doc);
        if (current.trim() !== "" && f.kind !== "typeahead") {
          if (filled.get(a.fieldId) === current) { report(a.fieldId, "filled", a.source); continue; }
          mark(markAt(f), "kept", a.fieldId);
          report(a.fieldId, "kept");
          continue;
        }
        if (f.kind === "typeahead" && current && !a.value.split("\n").some((v) => !current.split("\n").includes(v.trim()))) {
          report(a.fieldId, filled.get(a.fieldId) === current ? "filled" : "kept", filled.get(a.fieldId) === current ? a.source : null);
          if (filled.get(a.fieldId) !== current) mark(markAt(f), "kept", a.fieldId);
          continue;
        }
        if (f.kind === "typeahead" && current && a.value.split("\n").length === 1) { mark(markAt(f), "kept", a.fieldId); report(a.fieldId, "kept"); continue; }
        const r = await put(doc, f, a.value);
        mark(markAt(f), r.outcome === "filled" ? "filled" : r.outcome === "needs-you" ? "needs-you" : "didnt-stick", a.fieldId);
        report(a.fieldId, r.outcome, r.outcome === "filled" ? a.source : null, r.choices);
      }
      return answers.map((a) => outcomes.get(a.fieldId) ?? { fieldId: a.fieldId, outcome: "skipped", source: null });
    },

    replace(doc, fieldId, value) {
      return putNow(doc, fieldId, value);
    },

    async retry(doc, fieldId, value) {
      if (putNow(doc, fieldId, value) !== "filled") return "didnt-stick";
      await sleep(settleMs);
      const f = find(doc, fieldId);
      const ok = !!f && valueOf(f, doc).trim() !== "";
      if (f) mark(markAt(f), ok ? "filled" : "didnt-stick", fieldId);
      return ok ? "filled" : "didnt-stick";
    },

    fillOne(doc, fieldId, value) {
      return putNow(doc, fieldId, value);
    },

    describe(doc, fieldId): FieldStructure | null {
      const f = find(doc, fieldId);
      if (!f) return null;
      const el = f.control ?? f.box;
      const value = ["select", "radio", "checkbox", "repeating"].includes(f.kind) ? "" : valueOf(f, doc).trim();
      const holds = (text: string) => value.length > 1 && text.toLowerCase().includes(value.toLowerCase());
      const attributes: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) if (describingAttribute.test(a.name) && !holds(a.value)) attributes[a.name] = a.value;
      attributes["data-automation-id"] ??= f.box.getAttribute("data-automation-id") ?? "";
      return {
        tag: el.tagName.toLowerCase(), type: el.getAttribute("type"), role: el.getAttribute("role"), kind: f.kind, attributes,
        labelChain: [{ from: f.box.querySelector("legend") ? "legend" : "label", text: f.label }].filter((l) => l.text && !holds(l.text)),
        options: toRead(f, doc).options.filter((o) => !holds(o)),
      };
    },

    async pick(doc, fieldId, option) {
      const f = find(doc, fieldId);
      if (!f) return "didnt-stick";
      unmark(doc, fieldId);
      const before = valueOf(f, doc);
      const r = f.kind === "typeahead" ? await typeAndPick(doc, f, option, true) : f.kind === "select" ? await fromList(doc, f, option) : { outcome: "didnt-stick" as const };
      if (r.outcome === "filled") {
        if (!previous.has(fieldId)) previous.set(fieldId, before);
        filled.set(fieldId, valueOf(f, doc));
      }
      mark(markAt(f), r.outcome === "filled" ? "filled" : r.outcome === "needs-you" ? "needs-you" : "didnt-stick", fieldId);
      return r.outcome;
    },

    async removeEntries(doc, section, indexes) {
      let removed = 0;
      // From the last up: Workday renumbers the entries after a delete.
      for (const i of [...new Set(indexes)].sort((a, b) => b - a)) if (await deleteEntry(doc, section, i)) removed++;
      return removed;
    },

    undo(doc) {
      let restored = 0;
      for (const id of attached) {
        const f = find(doc, id);
        if (f?.control && clearFile(f.control, f.label)) restored++;
      }
      attached.clear();
      for (const [id, before] of previous) {
        const f = find(doc, id);
        if (!f?.control) continue;
        if (f.kind === "typeahead") {
          // Picks apply-kit made come off with their own delete, when apply-kit has a press.
          const mine = (filled.get(id) ?? "").split("\n").filter((v) => v && !before.split("\n").includes(v));
          const items = Array.from(f.control.closest("[data-automation-id=multiselectInputContainer]")?.querySelectorAll("[data-automation-id=selectedItem]") ?? []);
          let ok = mine.length > 0;
          for (const item of items) if (mine.includes(clean(item.querySelector("p")?.textContent))) ok = pressWidget(item.querySelector("[data-automation-id=DELETE_charm]") ?? item, press) && ok;
          if (ok) restored++;
        } else if (f.kind === "date") {
          const { month, year } = dateParts(f);
          const [y, m] = before.split("-");
          if (year && setValue(year, y ?? "", f.label) && (!month || setValue(month, m ?? "", f.label))) restored++;
        } else if (f.kind === "radio") {
          if (choiceBoxes(f).every((b) => b.checked === before.split("\n").includes(choiceLabel(b)) || setChecked(b, !b.checked, f.label))) restored++;
        } else if (f.kind === "checkbox") {
          if (setChecked(f.control, before === "checked", f.label)) restored++;
        } else if (f.kind !== "select" && setValue(f.control, before, f.label)) restored++;
      }
      // Entries apply-kit added come off from the last, with Workday's own Delete (no waiting: Undo is immediate).
      for (const [section, count] of added) {
        const list = entriesOf(doc, section);
        for (const entry of list.slice(list.length - count).reverse()) {
          const del = entry.querySelector("[data-automation-id=panel-set-delete-button]");
          if (del && pressWidget(del, press)) restored++;
        }
      }
      added.clear();
      previous.clear();
      filled.clear();
      removeMarks(doc);
      return restored;
    },

    show(doc, fieldId) {
      const f = find(doc, fieldId);
      if (!f) return false;
      showField(f.control ?? f.box);
      return true;
    },
  };
}
