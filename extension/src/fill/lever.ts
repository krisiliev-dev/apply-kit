// The Lever filler (Apply #43): Lever's apply page is one form (jobs.lever.co/{company}/{posting}/apply,
// or the same page in a company site's frame). One full-name field, the CV upload first (Lever reads
// it and may fill the name, email, phone and company itself: those are kept), "Additional information"
// (where the cover letter goes), cards of custom questions labelled in their own box, the voluntary
// EEO block, and /thanks after Submit. Its location typeahead takes typed text too.
import { createFormFiller, type FormFillerOptions } from "./form-filler.ts";
import type { Filler } from "./greenhouse.ts";

export function createLeverFiller(options: FormFillerOptions = {}): Filler {
  return createFormFiller({
    form: (doc) => doc.querySelector("#application-form, form.application-form"),
    question: { box: ".application-question", label: ".application-label" },
    pickOnly: false,
    confirmation: (doc) => /\/thanks\/?$/.test(new URL(doc.URL).pathname) || /application submitted/i.test(doc.body?.textContent ?? ""),
  }, options);
}
