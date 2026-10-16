// The Ashby filler (Apply #43): Ashby's application is one page without a <form>
// (jobs.ashbyhq.com/{company}/{job}/application, or its embed in a company site's frame). System fields
// with stable ids, the CV upload (never "Autofill from resume", which is left out of the reading),
// a location typeahead that keeps only a picked suggestion, yes/no questions as two buttons, tick
// boxes, date pickers, the voluntary demographic survey, and an inline thank-you after Submit.
import { createFormFiller, type FormFillerOptions } from "./form-filler.ts";
import type { Filler } from "./greenhouse.ts";

export function createAshbyFiller(options: FormFillerOptions = {}): Filler {
  return createFormFiller({
    form: (doc) => doc.querySelector(".ashby-application-form-container"),
    ignore: "[class*=autofill]",
    question: { box: ".ashby-application-form-field-entry", label: ".ashby-application-form-question-title" },
    pickOnly: true,
    confirmation: (doc) => /thanks for applying|thank you for applying|successfully submitted|application submitted/i.test(doc.body?.textContent ?? ""),
  }, options);
}
