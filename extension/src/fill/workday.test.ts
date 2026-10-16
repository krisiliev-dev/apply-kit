// The Workday filler at its interface (read, fill, pick, removeEntries, undo) on synthetic Workday
// pages in happy-dom, one per step of an application and the start screen. Workday's widgets are
// simulated by the fixture (list buttons, typeaheads with delayed suggestions, Add and Delete, its CV
// reading); the filler presses them only through the press it's given. Made-up company (Kestrel
// Payments) and person (Mira Petrova). No live sites.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldAnswer, PageReading } from "@apply-kit/core";
import { openWorkday, workdayUrl, type WorkdayOptions } from "./fixtures/workday.ts";
import { createWorkdayFiller } from "./workday.ts";

/** What a click on a widget would be; apply-kit has none in the extension yet (see the report on #44). */
const press = (el: Element) => (el as HTMLElement).click();
const fill = (fieldId: string, value: string, source: "profile" | "answer-bank" | "cv-version" = "profile"): FieldAnswer => ({ fieldId, kind: "fill", value, source, basis: null });
const marks = (doc: Document) => Array.from(doc.querySelectorAll("[data-apply-kit-mark]")).map((m) => `${m.getAttribute("data-for")}:${m.getAttribute("data-apply-kit-mark")}`);
const page = (name: string, options?: WorkdayOptions) => openWorkday(`workday-${name}.html`, options);
const jobRef = { portal: "workday", board: "kestrelpayments", jobId: "R-10482" };

afterEach(() => { vi.useRealTimers(); });

describe("reading Workday's steps", () => {
  it.each([
    ["my-information", "My Information", 1],
    ["my-experience", "My Experience", 2],
    ["questions", "Application Questions", 3],
    ["voluntary", "Voluntary Disclosures", 4],
    ["self-identify", "Self Identify", 5],
    ["review", "Review", 6],
  ])("%s: the step's label and count from Workday's own stepper, and the job from the address", (name, label, current) => {
    const r = createWorkdayFiller().read(page(name).document);
    expect(r).toMatchObject({ pageKind: name === "review" ? "review" : "form", jobRef, stepLabel: label, stepCount: { current, total: 6 } });
  });

  it("reads the start screen and the confirmation, with the job from the address and no stepper", () => {
    expect(createWorkdayFiller().read(page("start").document)).toEqual({ pageKind: "start", jobRef, stepLabel: null, stepCount: null, fields: [] });
    expect(createWorkdayFiller().read(page("confirmation").document)).toEqual({ pageKind: "confirmation", jobRef, stepLabel: null, stepCount: null, fields: [] });
  });

  it("reads My Information's fields in Workday's order: list buttons, typeaheads, the radio question", () => {
    const r = createWorkdayFiller().read(page("my-information").document);
    expect(r.fields.map((f) => [f.id, f.label, f.kind, f.required])).toEqual([
      ["country--country", "Country", "select", true],
      ["legalName--firstName", "Given Name(s)", "text", true],
      ["legalName--lastName", "Family Name", "text", true],
      ["address--addressLine1", "Address Line 1", "text", false],
      ["address--city", "City", "typeahead", true],
      ["address--postalCode", "Postal Code", "text", false],
      ["source--source", "How Did You Hear About Us?", "typeahead", true],
      ["candidateIsPreviousWorker", "Have you previously worked for Kestrel Payments?", "radio", true],
      ["emailAddress", "Email Address", "email", true],
      ["phoneNumber--phoneType", "Phone Device Type", "select", true],
      ["phoneNumber--countryPhoneCode", "Country Phone Code", "typeahead", true],
      ["phoneNumber--phoneNumber", "Phone Number", "tel", true],
      ["phoneNumber--extension", "Phone Extension", "text", false],
    ]);
    expect(r.fields.find((f) => f.id === "candidateIsPreviousWorker")!.options).toEqual(["Yes", "No"]);
    expect(r.fields.find((f) => f.id === "country--country")!.value).toBe("");
  });
});
