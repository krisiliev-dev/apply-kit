// The SmartRecruiters filler (Apply #45): the OneClick application (jobs.smartrecruiters.com/oneclick-ui/
// company/{Company}/publication/{uuid}) is one long page of spl-* web components whose real controls sit
// in open shadow roots: personal information, a confirm-email field, location, the CV drop zone,
// Experience and Education entries (added with the portal's own Add, which apply-kit never presses),
// "Your message to the hiring manager", and sometimes a second step of screening questions. Its
// "Apply with LinkedIn/Indeed", Next and Submit are Kris's. A component whose shadow root is closed is
// listed as needs-you with the value to copy.
import type { FieldKind } from "@apply-kit/core";
import type { Filler } from "./greenhouse.ts";
import { createOnePageFiller } from "./one-page.ts";

/** SmartRecruiters' components that hold a control, and the field each one is. */
const components: Record<string, FieldKind> = {
  "spl-input": "text", "spl-phone-field": "tel", "spl-textarea": "textarea", "spl-select": "select",
  "spl-autocomplete": "typeahead", "spl-checkbox": "checkbox", "spl-radio-group": "radio", "spl-dropzone": "file",
};

export function createSmartRecruitersFiller(options: { settleMs?: number } = {}): Filler {
  return createOnePageFiller({
    form: (doc) => doc.querySelector("#oc-form, form.oc-form") ?? doc.querySelector("form"),
    components,
    entries: { section: ".entries[data-section]", entry: ".entry", name: (section) => section.getAttribute("data-section") ?? "Entry" },
    stepLabel: (doc) => doc.querySelector(".step-title")?.textContent?.trim() || null,
    confirmation: (doc) => /thank you for (applying|your application)|your application has been (submitted|received|sent)/i.test(doc.body?.textContent ?? ""),
  }, options);
}
