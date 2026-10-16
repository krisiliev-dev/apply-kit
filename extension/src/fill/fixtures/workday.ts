// Workday's widgets on the synthetic Workday pages (workday-*.html), for the Workday filler's tests:
// list buttons whose options show only once opened, typeaheads whose suggestions come after a delay,
// the repeating sections' Add and Delete (Workday renumbers the entries after a delete), React-style
// controlled inputs, and Workday reading the CV and adding work entries of its own. Navigation buttons
// (Back, Save and Continue, Submit) and the start screen's links note any press, which fails a test.
import { controlInput, openFixture, portalWrite, type FixturePage } from "./load.ts";

export const workdayUrl = "https://kestrelpayments.wd3.myworkdayjobs.com/en-US/Kestrel_Careers/job/Sofia/Security-Engineer_R-10482/apply/applyManually";

export interface WorkdayOptions {
  /** How long Workday takes to show a typeahead's suggestions after typing (ms). */
  suggestMs?: number;
  /** How long a list button takes to show its options once opened (ms). */
  listMs?: number;
  /** Workday reads the CV once it's attached and, after `delayMs`, adds these work entries. */
  cvReads?: { delayMs: number; entries: { title: string; company: string; from: string }[] };
  /** Entries already on the page: Work Experience and Education entries to add before the test starts, with values. */
  work?: { title: string; company: string; from?: string }[];
}

/** What a filler may press: list buttons, options, suggestions, a picked item's delete, Add and Delete. Never navigation. */
const widgets = "button[aria-haspopup=listbox], [data-automation-id=add-button], [data-automation-id=panel-set-delete-button]";

export interface WorkdayPage extends FixturePage {
  /** The entries in a repeating section, by their heading ("Work Experience 1"). */
  entries(section: "workExperience" | "education"): string[];
  /** A typeahead's picked items. */
  picked(id: string): string[];
  /** A list button's shown value ("Select One" when nothing is chosen). */
  shown(id: string): string;
}

export function openWorkday(name: string, { suggestMs = 300, listMs = 100, cvReads, work = [] }: WorkdayOptions = {}, url = workdayUrl): WorkdayPage {
  const page = openFixture(name, url, { controlled: true, widgets });
  const doc = page.document;
  const setNative = (el: HTMLInputElement, v: string) => portalWrite(el, v);
  const optionsOf = (el: Element) => (el.getAttribute("data-fixture-options") ?? "").split("|").filter(Boolean);
  const closeLists = () => doc.querySelectorAll("[role=listbox]").forEach((l) => l.remove());

  function listButton(b: HTMLButtonElement) {
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-expanded") === "true") { b.setAttribute("aria-expanded", "false"); closeLists(); return; }
      closeLists();
      b.setAttribute("aria-expanded", "true");
      setTimeout(() => {
        const list = Object.assign(doc.createElement("ul"), { id: `${b.id}-listbox` });
        list.setAttribute("role", "listbox");
        for (const text of optionsOf(b)) {
          const li = doc.createElement("li");
          li.setAttribute("role", "option");
          li.setAttribute("data-automation-id", "promptOption");
          li.innerHTML = `<div>${text}</div>`;
          li.addEventListener("click", () => {
            b.textContent = text;
            b.setAttribute("value", text === "Select One" ? "" : text);
            b.setAttribute("aria-expanded", "false");
            list.remove();
          });
          list.append(li);
        }
        b.setAttribute("aria-controls", list.id);
        doc.body.append(list);
      }, listMs);
    });
  }

  function typeahead(input: HTMLInputElement) {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const pickedList = input.closest("[data-automation-id=multiselectInputContainer]")!.querySelector("[data-automation-id=selectedItemList]")!;
    input.addEventListener("input", () => {
      if (pending) clearTimeout(pending);
      doc.getElementById(`${input.id}-listbox`)?.remove();
      const typed = input.value.trim().toLowerCase();
      if (!typed) { input.setAttribute("aria-expanded", "false"); return; }
      pending = setTimeout(() => {
        const list = Object.assign(doc.createElement("div"), { id: `${input.id}-listbox` });
        list.setAttribute("role", "listbox");
        list.setAttribute("data-automation-id", "activeListContainer");
        for (const text of optionsOf(input).filter((o) => o.toLowerCase().includes(typed))) {
          const opt = doc.createElement("div");
          opt.setAttribute("role", "option");
          opt.setAttribute("data-automation-id", "promptOption");
          opt.textContent = text;
          opt.addEventListener("click", () => {
            if (!input.hasAttribute("data-fixture-multi")) pickedList.replaceChildren();
            const item = doc.createElement("li");
            item.setAttribute("data-automation-id", "selectedItem");
            item.innerHTML = `<p data-automation-id="promptOption">${text}</p><span role="button" data-automation-id="DELETE_charm" aria-label="Delete ${text}">×</span>`;
            item.querySelector("[data-automation-id=DELETE_charm]")!.addEventListener("click", () => item.remove());
            pickedList.append(item);
            list.remove();
            setNative(input, "");
            input.setAttribute("aria-expanded", "false");
          });
          list.append(opt);
        }
        input.setAttribute("aria-controls", list.id);
        input.setAttribute("aria-expanded", "true");
        doc.body.append(list);
      }, suggestMs);
    });
  }

  function wire(root: ParentNode) {
    root.querySelectorAll<HTMLButtonElement>("button[aria-haspopup=listbox]").forEach(listButton);
    root.querySelectorAll<HTMLInputElement>("input[data-uxi-widget-type=selectinput]").forEach(typeahead);
    root.querySelectorAll<HTMLButtonElement>("[data-automation-id=panel-set-delete-button]").forEach((b) => b.addEventListener("click", () => remove(b.closest("[role=group][data-automation-id*='-']")!)));
  }

  const entriesIn = (key: string) => Array.from(doc.querySelectorAll(`[data-automation-id="${key}Section"] > [role=group][data-automation-id^="${key}-"]`));
  const titles: Record<string, string> = { workExperience: "Work Experience", education: "Education" };

  function add(key: string): Element {
    const section = doc.querySelector(`[data-automation-id="${key}Section"]`)!;
    const n = entriesIn(key).length + 1;
    const template = doc.querySelector<HTMLTemplateElement>(`template[data-fixture-entry="${key}"]`)!;
    const holder = doc.createElement("div");
    holder.innerHTML = template.innerHTML.replaceAll(`${key}-N`, `${key}-${n}`).replaceAll(`${titles[key]} N`, `${titles[key]} ${n}`);
    const entry = holder.firstElementChild!;
    section.querySelector(":scope > [data-automation-id=add-button]")!.before(entry);
    entry.querySelectorAll<HTMLInputElement>("input:not([type=checkbox]):not([type=file]), textarea").forEach(controlInput);
    wire(entry);
    return entry;
  }

  /** Delete: the entry goes and the ones after it are renumbered, keeping their values. */
  function remove(entry: Element) {
    const key = entry.getAttribute("data-automation-id")!.replace(/-\d+$/, "");
    const after = entriesIn(key).slice(entriesIn(key).indexOf(entry) + 1);
    entry.remove();
    for (const e of after) {
      const from = Number(e.getAttribute("data-automation-id")!.split("-").at(-1));
      const rename = (v: string) => v.replaceAll(`${key}-${from}`, `${key}-${from - 1}`).replaceAll(`${titles[key]} ${from}`, `${titles[key]} ${from - 1}`);
      for (const el of [e, ...Array.from(e.querySelectorAll("*"))]) {
        for (const attr of ["id", "for", "data-automation-id", "aria-labelledby", "aria-label", "name"]) {
          const v = el.getAttribute(attr);
          if (v) el.setAttribute(attr, rename(v));
        }
      }
      const h = e.querySelector("h4")!;
      h.textContent = rename(h.textContent ?? "");
    }
  }

  wire(doc);
  doc.querySelectorAll<HTMLButtonElement>("[data-automation-id=add-button]").forEach((b) => b.addEventListener("click", () => {
    const key = b.closest("[data-automation-id$=Section]")!.getAttribute("data-automation-id")!.replace(/Section$/, "");
    if (titles[key]) add(key);
  }));

  const fillEntry = (entry: Element, w: { title: string; company: string; from?: string }) => {
    const set = (suffix: string, v: string) => setNative(entry.querySelector<HTMLInputElement>(`[id$="--${suffix}"]`)!, v);
    set("jobTitle", w.title);
    set("companyName", w.company);
    if (w.from) {
      const [y, m] = w.from.split("-");
      setNative(entry.querySelector<HTMLInputElement>("[data-automation-id=dateSectionMonth-input]")!, m!);
      setNative(entry.querySelector<HTMLInputElement>("[data-automation-id=dateSectionYear-input]")!, y!);
    }
  };
  for (const w of work) fillEntry(add("workExperience"), w);

  const resume = doc.querySelector<HTMLInputElement>("input[type=file]");
  if (resume && cvReads) {
    let read = false;
    const reads = () => {
      if (read || !resume.closest(".file-upload")!.querySelector(".filename")!.textContent) return;
      read = true;
      setTimeout(() => { for (const w of cvReads.entries) fillEntry(add("workExperience"), w); }, cvReads.delayMs);
    };
    resume.addEventListener("change", reads);
    resume.closest(".file-upload")!.addEventListener("drop", reads);
  }

  return {
    ...page,
    entries: (key) => entriesIn(key).map((e) => e.querySelector("h4")?.textContent ?? ""),
    picked: (id) => Array.from(doc.getElementById(id)!.closest("[data-automation-id=multiselectInputContainer]")!.querySelectorAll("[data-automation-id=selectedItem] p")).map((p) => p.textContent ?? ""),
    shown: (id) => doc.getElementById(id)!.textContent ?? "",
  };
}
