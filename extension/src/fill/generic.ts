import { createFormFiller, type FormFillerOptions } from "./form-filler.ts";
import type { Filler } from "./greenhouse.ts";

/** Unknown forms are read for a copy list; filling requires the panel's separate opt-in. */
export function createGenericFiller(options: FormFillerOptions = {}): Filler {
  const filler = createFormFiller({ form: (doc) => doc.querySelector("form") ?? doc.body, pickOnly: false, confirmation: () => false, labelFallback: true }, options);
  return {
    ...filler,
    async fill(doc, answers, files) {
      const clear = new Set(filler.read(doc).fields.filter((f) => {
        const control = doc.getElementById(f.id) ?? Array.from(doc.querySelectorAll("input,select,textarea")).find((el) => el.getAttribute("name") === f.id);
        return control && (control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby") || control.hasAttribute("autocomplete") || control.closest("label") || Array.from(doc.querySelectorAll("label")).some((l) => l.htmlFor === control.id && control.id !== "") || /^(full name|first name|last name|name|email|phone number|телефон|име|фамилия)$/iu.test(f.label));
      }).map((f) => f.id));
      return filler.fill(doc, answers.map((a) => clear.has(a.fieldId) ? a : { fieldId: a.fieldId, kind: "skip", reason: "The field's label isn't clear enough to fill" }), files);
    },
  };
}
