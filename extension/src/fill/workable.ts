// The Workable filler (Apply #45): Workable's application (apply.workable.com/{account}/j/{shortcode}/apply/)
// is one React form: first and last name, headline, phone with a country picker (a button: the phone
// field takes the whole number), address, the CV (Workable reads it and may fill fields itself: those
// are kept), cover letter, summary, Experience and Education entries (added with Workable's "+ Add",
// which apply-kit never presses), and custom questions QA_<id> (text, yes/no and multiple choice as
// radios, dates). Workable marks optional fields with "Optional" in their label; the rest are
// required. "Submit application" is Kris's; the thank-you replaces the form on the same address.
import type { Filler } from "./greenhouse.ts";
import { createOnePageFiller } from "./one-page.ts";

export function createWorkableFiller(options: { settleMs?: number } = {}): Filler {
  return createOnePageFiller({
    form: (doc) => doc.querySelector("form[data-ui=application-form], #application-form") ?? doc.querySelector("form"),
    entries: { section: ".entries[data-section], [data-ui=experience], [data-ui=education]", entry: ".entry, [data-ui$=-entry]", name: (section) => section.getAttribute("data-section") ?? "Entry" },
    optionalInText: true,
    confirmation: (doc) => /application submitted|thank you for applying|thanks for applying/i.test(doc.body?.textContent ?? ""),
  }, options);
}
