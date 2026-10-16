// The Greenhouse filler at its interface (read, fill, undo) on synthetic Greenhouse pages in
// happy-dom: the classic board and the new React board. Made-up companies; the values are a made-up
// person's (Mira Petrova). No live sites.
import { describe, expect, it } from "vitest";
import type { FieldAnswer } from "@apply-kit/core";
import { openFixture } from "./fixtures/load.ts";
import { createGreenhouseFiller } from "./greenhouse.ts";
import { refusal } from "./page-actions.ts";

const classic = () => openFixture("greenhouse-classic.html", "https://boards.greenhouse.io/vireohealth/jobs/4471029");
const newBoard = () => openFixture("greenhouse-new.html", "https://job-boards.greenhouse.io/kestrel/jobs/4410", { controlled: true });

const fill = (fieldId: string, value: string): FieldAnswer => ({ fieldId, kind: "fill", value, source: "profile", basis: null });
const marks = (doc: Document) => Array.from(doc.querySelectorAll("[data-apply-kit-mark]")).map((m) => `${m.getAttribute("data-for")}:${m.getAttribute("data-apply-kit-mark")}`);

describe("reading a Greenhouse page", () => {
  it("finds the classic board's fields in the portal's order, with labels and kinds", () => {
    const page = classic();
    const r = createGreenhouseFiller().read(page.document);

    expect(r).toMatchObject({ pageKind: "form", jobRef: { portal: "greenhouse", board: "vireohealth", jobId: "4471029" }, stepLabel: null, stepCount: null });
    expect(r.fields.map((f) => [f.id, f.label, f.kind, f.required])).toEqual([
      ["first_name", "First Name", "text", true],
      ["last_name", "Last Name", "text", true],
      ["email", "Email", "text", true],
      ["phone", "Phone", "text", true],
      ["job_application_location", "Location (City)", "text", false],
      ["resume", "Resume/CV", "file", true],
      ["job_application_answers_attributes_0_text_value", "LinkedIn Profile", "text", false],
      ["job_application_answers_attributes_1_text_value", "Website", "text", false],
      ["job_application_answers_attributes_2_text_value", "Why do you want to work at Vireo Health?", "textarea", true],
      ["job_application_answers_attributes_3_answer_selected_options_attributes_3_question_option_id", "How did you hear about this job?", "select", false],
      ["job_application_data_compliance_gdpr_consent_given", "I agree to Vireo Health processing my data as described in the privacy notice.", "checkbox", true],
    ]);
    expect(r.fields.find((f) => f.id === "phone")).toMatchObject({ value: "+359 000 0000", hint: "tel", maxLength: 255 });
    expect(r.fields.at(-2)!.options).toEqual(["LinkedIn", "Company website", "Referral"]);
    expect(r.fields.at(-1)).toMatchObject({ consent: true, password: false });
  });

  it("finds the new board's fields, including its typeahead and the labelled file field", () => {
    const r = createGreenhouseFiller().read(newBoard().document);

    expect(r.jobRef).toEqual({ portal: "greenhouse", board: "kestrel", jobId: "4410" });
    expect(r.fields.map((f) => [f.id, f.label, f.kind])).toEqual([
      ["first_name", "First Name", "text"],
      ["last_name", "Last Name", "text"],
      ["preferred_name", "Preferred First Name", "text"],
      ["email", "Email", "email"],
      ["country", "Country", "typeahead"],
      ["phone", "Phone", "tel"],
      ["resume", "Resume/CV", "file"],
      ["question_31001", "LinkedIn Profile", "text"],
      ["question_31002", "GitHub", "text"],
      ["question_31003", "What are your salary expectations? (gross monthly, EUR)", "text"],
      ["gdpr_consent", "I consent to Kestrel Payments storing my application for 12 months", "checkbox"],
    ]);
    expect(r.fields.find((f) => f.id === "gdpr_consent")!.consent).toBe(true);
  });
});

describe("reading Greenhouse's confirmation page", () => {
  it("reads the page after Submit as a confirmation of the job, with no fields, pressing nothing", () => {
    const page = openFixture("greenhouse-confirmation.html", "https://job-boards.greenhouse.io/kestrel/jobs/4410/confirmation");

    const r = createGreenhouseFiller().read(page.document);

    expect(r).toEqual({ pageKind: "confirmation", jobRef: { portal: "greenhouse", board: "kestrel", jobId: "4410" }, stepLabel: null, stepCount: null, fields: [] });
    expect(page.presses).toEqual([]);
  });

  it("doesn't take a form that thanks you in its intro for a confirmation", () => {
    const page = openFixture("greenhouse-new.html", "https://job-boards.greenhouse.io/kestrel/jobs/4410");
    page.document.querySelector(".required-fields")!.textContent = "Thank you for applying to Kestrel Payments! * indicates a required field";

    expect(createGreenhouseFiller().read(page.document).pageKind).toBe("form");
  });
});

describe("filling a Greenhouse page", () => {
  it("sets the new board's React-style inputs through the native setter, so the form registers them", () => {
    const page = newBoard();
    // The controlled inputs ignore a direct write, as React does.
    page.field("preferred_name").value = "Mimi";
    expect(page.field("preferred_name").value).toBe("");

    const outcomes = createGreenhouseFiller().fill(page.document, [
      fill("first_name", "Mira"), fill("last_name", "Petrova"), fill("email", "mira.petrova@example.com"), fill("phone", "+359 88 000 0175"),
      { fieldId: "question_31002", kind: "needs-you", reason: "Your profile has no GitHub link", basis: null },
      { fieldId: "gdpr_consent", kind: "skip", reason: "Consent boxes are yours to tick" },
    ]);

    expect(outcomes).toEqual([
      { fieldId: "first_name", outcome: "filled", source: "profile" },
      { fieldId: "last_name", outcome: "filled", source: "profile" },
      { fieldId: "email", outcome: "filled", source: "profile" },
      { fieldId: "phone", outcome: "filled", source: "profile" },
      { fieldId: "question_31002", outcome: "needs-you", source: null },
      { fieldId: "gdpr_consent", outcome: "skipped", source: null },
    ]);
    expect(["first_name", "last_name", "email", "phone"].map((id) => page.field(id).value)).toEqual(["Mira", "Petrova", "mira.petrova@example.com", "+359 88 000 0175"]);
    expect(marks(page.document)).toEqual(["first_name:filled", "last_name:filled", "email:filled", "phone:filled", "question_31002:needs-you"]);
  });

  it("draws marks as an outline and badge that can't be clicked and aren't read out", () => {
    const page = classic();
    createGreenhouseFiller().fill(page.document, [fill("first_name", "Mira")]);

    const m = page.document.querySelector<HTMLElement>("[data-apply-kit-mark]")!;
    expect(m.getAttribute("aria-hidden")).toBe("true");
    expect(m.style.pointerEvents).toBe("none");
    expect(m.style.outline).toContain("solid");
    expect(m.textContent).toBe("✓");
  });

  it("keeps a field that already has a value, and replaces it only when asked", () => {
    const page = classic();
    const filler = createGreenhouseFiller();

    const [phone] = filler.fill(page.document, [fill("phone", "+359 88 000 0175")]);

    expect(phone).toEqual({ fieldId: "phone", outcome: "kept", source: null });
    expect(page.field("phone").value).toBe("+359 000 0000");
    expect(marks(page.document)).toEqual(["phone:kept"]);

    expect(filler.replace(page.document, "phone", "+359 88 000 0175")).toBe("filled");
    expect(page.field("phone").value).toBe("+359 88 000 0175");
    expect(marks(page.document)).toEqual(["phone:filled"]);
  });

  it("filling twice fills only what's still empty, and keeps what Kris changed", () => {
    const page = classic();
    const filler = createGreenhouseFiller();
    filler.fill(page.document, [fill("first_name", "Mira"), fill("last_name", "Petrova")]);
    page.field("last_name").value = "Petrova-Ivanova";

    const again = filler.fill(page.document, [fill("first_name", "Mira"), fill("last_name", "Petrova"), fill("email", "mira.petrova@example.com")]);

    expect(again.map((o) => o.outcome)).toEqual(["filled", "kept", "filled"]);
    expect(page.field("last_name").value).toBe("Petrova-Ivanova");
    expect(page.field("email").value).toBe("mira.petrova@example.com");
  });

  it("picks a dropdown's option by its text", () => {
    const page = classic();
    const id = "job_application_answers_attributes_3_answer_selected_options_attributes_3_question_option_id";
    const [o] = createGreenhouseFiller().fill(page.document, [{ fieldId: id, kind: "fill", value: "Company website", source: "answer-bank", basis: null }]);
    expect(o).toEqual({ fieldId: id, outcome: "filled", source: "answer-bank" });
    expect((page.document.getElementById(id) as HTMLSelectElement).value).toBe("102");
  });

  it("undo restores every value it changed and removes its marks", () => {
    const page = newBoard();
    const filler = createGreenhouseFiller();
    filler.fill(page.document, [fill("first_name", "Mira"), fill("email", "mira.petrova@example.com"), { fieldId: "question_31002", kind: "needs-you", reason: "", basis: null }]);

    expect(filler.undo(page.document)).toBe(2);

    expect(page.field("first_name").value).toBe("");
    expect(page.field("email").value).toBe("");
    expect(marks(page.document)).toEqual([]);
  });
});

describe("what filling never does", () => {
  it("never presses Submit or ticks a consent box, even when told to fill one", () => {
    for (const page of [classic(), newBoard()]) {
      const filler = createGreenhouseFiller();
      const reading = filler.read(page.document);
      const consent = reading.fields.find((f) => f.consent)!;

      const outcomes = filler.fill(page.document, reading.fields.map((f) => fill(f.id, f.kind === "checkbox" ? "checked" : "Mira")));
      filler.undo(page.document);

      expect(page.presses).toEqual([]);
      expect((page.document.getElementById(consent.id) as HTMLInputElement).checked).toBe(false);
      expect(outcomes.find((o) => o.fieldId === consent.id)!.outcome).toBe("skipped");
    }
  });

  it("refuses every submit, navigation and consent control on the fixtures", () => {
    for (const page of [classic(), newBoard()]) {
      const controls = Array.from(page.document.querySelectorAll("button, input[type=button], input[type=submit], a, form, input[type=checkbox]"));
      expect(controls.length).toBeGreaterThan(2);
      for (const el of controls) {
        const label = el.closest("label")?.textContent ?? page.document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "";
        expect(refusal(el, label), el.outerHTML.slice(0, 80)).not.toBeNull();
      }
    }
    const doc = classic().document;
    expect(refusal(doc.createElement("a"))).toBe("a link");
    const signIn = doc.createElement("input");
    signIn.setAttribute("data-automation-id", "signInSubmitButton");
    expect(refusal(signIn)).toBe("a navigation control");
    const create = doc.createElement("div");
    create.setAttribute("role", "button");
    create.textContent = "Create Account";
    expect(refusal(create)).toBe("a button");
  });
});
