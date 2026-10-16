// The Greenhouse filler at its interface (read, fill, undo) on synthetic Greenhouse pages in
// happy-dom: the classic board and the new React board. Made-up companies; the values are a made-up
// person's (Mira Petrova). No live sites.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldAnswer } from "@apply-kit/core";
import { openFixture } from "./fixtures/load.ts";
import { createGreenhouseFiller, type FileToAttach } from "./greenhouse.ts";
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

describe("filling a Greenhouse page", () => {
  it("sets the new board's React-style inputs through the native setter, so the form registers them", async () => {
    const page = newBoard();
    // The controlled inputs ignore a direct write, as React does.
    page.field("preferred_name").value = "Mimi";
    expect(page.field("preferred_name").value).toBe("");

    const outcomes = await createGreenhouseFiller().fill(page.document, [
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

  it("draws marks as an outline and badge that can't be clicked and aren't read out", async () => {
    const page = classic();
    await createGreenhouseFiller().fill(page.document, [fill("first_name", "Mira")]);

    const m = page.document.querySelector<HTMLElement>("[data-apply-kit-mark]")!;
    expect(m.getAttribute("aria-hidden")).toBe("true");
    expect(m.style.pointerEvents).toBe("none");
    expect(m.style.outline).toContain("solid");
    expect(m.textContent).toBe("✓");
  });

  it("keeps a field that already has a value, and replaces it only when asked", async () => {
    const page = classic();
    const filler = createGreenhouseFiller();

    const [phone] = await filler.fill(page.document, [fill("phone", "+359 88 000 0175")]);

    expect(phone).toEqual({ fieldId: "phone", outcome: "kept", source: null });
    expect(page.field("phone").value).toBe("+359 000 0000");
    expect(marks(page.document)).toEqual(["phone:kept"]);

    expect(filler.replace(page.document, "phone", "+359 88 000 0175")).toBe("filled");
    expect(page.field("phone").value).toBe("+359 88 000 0175");
    expect(marks(page.document)).toEqual(["phone:filled"]);
  });

  it("filling twice fills only what's still empty, and keeps what Kris changed", async () => {
    const page = classic();
    const filler = createGreenhouseFiller();
    await filler.fill(page.document, [fill("first_name", "Mira"), fill("last_name", "Petrova")]);
    page.field("last_name").value = "Petrova-Ivanova";

    const again = await filler.fill(page.document, [fill("first_name", "Mira"), fill("last_name", "Petrova"), fill("email", "mira.petrova@example.com")]);

    expect(again.map((o) => o.outcome)).toEqual(["filled", "kept", "filled"]);
    expect(page.field("last_name").value).toBe("Petrova-Ivanova");
    expect(page.field("email").value).toBe("mira.petrova@example.com");
  });

  it("picks a dropdown's option by its text", async () => {
    const page = classic();
    const id = "job_application_answers_attributes_3_answer_selected_options_attributes_3_question_option_id";
    const [o] = await createGreenhouseFiller().fill(page.document, [{ fieldId: id, kind: "fill", value: "Company website", source: "answer-bank", basis: null }]);
    expect(o).toEqual({ fieldId: id, outcome: "filled", source: "answer-bank" });
    expect((page.document.getElementById(id) as HTMLSelectElement).value).toBe("102");
  });

  it("undo restores every value it changed and removes its marks", async () => {
    const page = newBoard();
    const filler = createGreenhouseFiller();
    await filler.fill(page.document, [fill("first_name", "Mira"), fill("email", "mira.petrova@example.com"), { fieldId: "question_31002", kind: "needs-you", reason: "", basis: null }]);

    expect(filler.undo(page.document)).toBe(2);

    expect(page.field("first_name").value).toBe("");
    expect(page.field("email").value).toBe("");
    expect(marks(page.document)).toEqual([]);
  });
});

describe("attaching the package's files", () => {
  const cvName = "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf";
  const letterName = "Mira_Petrova_Cover_Letter_Kestrel_Payments_Security_Engineer.pdf";
  const cv: FileToAttach = { which: "cv", fileName: cvName, type: "application/pdf", base64: "JVBERi1mYWtlIENW" };
  const letter: FileToAttach = { which: "letter", fileName: letterName, type: "application/pdf", base64: "JVBERi1mYWtlIGxldHRlcg==" };
  const attach = (fieldId: string, which: "cv" | "letter"): FieldAnswer => ({ fieldId, kind: "file", which, fileName: which === "cv" ? cvName : letterName, size: 12, source: "package", basis: "Your package's CV, v1" });
  const filesPage = (options: Parameters<typeof openFixture>[2] = {}) => openFixture("greenhouse-files.html", "https://boards.greenhouse.io/vireohealth/jobs/4471029", options);
  const dropPage = () => openFixture("greenhouse-dropzone.html", "https://job-boards.greenhouse.io/kestrel/jobs/4410", { uploads: "drop-only" });
  const shown = (doc: Document, inputId: string) => doc.getElementById(inputId)!.closest(".field, .file-upload")!.querySelector(".filename")!.textContent;

  afterEach(() => { vi.useRealTimers(); });

  it("attaches the CV and the letter through the file inputs, named as in the package", async () => {
    const page = filesPage();

    const outcomes = await createGreenhouseFiller({ settleMs: 0 }).fill(page.document, [attach("resume", "cv"), attach("cover_letter", "letter")], [cv, letter]);

    expect(outcomes).toEqual([{ fieldId: "resume", outcome: "filled", source: "package" }, { fieldId: "cover_letter", outcome: "filled", source: "package" }]);
    expect(page.field("resume").files![0]!.name).toBe(cvName);
    expect(await page.field("resume").files![0]!.text()).toBe("%PDF-fake CV");
    expect(shown(page.document, "resume")).toBe(cvName);
    expect(shown(page.document, "cover_letter")).toBe(letterName);
    expect(marks(page.document)).toEqual(["resume:filled", "cover_letter:filled"]);
    expect(page.presses).toEqual([]);
  });

  it("drops the CV on a box that ignores the input's change, and pastes the letter into the text-only option", async () => {
    const page = dropPage();

    const outcomes = await createGreenhouseFiller({ settleMs: 0 }).fill(page.document, [
      attach("resume", "cv"), { fieldId: "cover_letter_text", kind: "fill", value: "Dear Kestrel Payments team,", source: "package", basis: "Your package's letter, v1" },
    ], [cv]);

    expect(outcomes).toEqual([{ fieldId: "resume", outcome: "filled", source: "package" }, { fieldId: "cover_letter_text", outcome: "filled", source: "package" }]);
    expect(shown(page.document, "resume")).toBe(cvName);
    expect(page.field("cover_letter_text").value).toBe("Dear Kestrel Payments team,");
    expect(page.presses).toEqual([]);
  });

  it("attaches files first and lets the page settle, so the portal's CV reading can't overwrite what's filled; what it read is kept", async () => {
    vi.useFakeTimers();
    const page = filesPage({ cvParser: { delayMs: 800, values: { first_name: "MIRA", phone: "0880000175" } } });

    // The answers in the portal's order: the CV field comes after the names.
    const filling = createGreenhouseFiller({ settleMs: 1500 }).fill(page.document, [
      fill("first_name", "Mira"), fill("last_name", "Petrova"), fill("phone", "+359 88 000 0175"), attach("resume", "cv"),
    ], [cv]);
    await vi.advanceTimersByTimeAsync(1500);
    const outcomes = await filling;
    await vi.advanceTimersByTimeAsync(5000);

    expect(outcomes).toEqual([
      { fieldId: "first_name", outcome: "kept", source: null },
      { fieldId: "last_name", outcome: "filled", source: "profile" },
      { fieldId: "phone", outcome: "kept", source: null },
      { fieldId: "resume", outcome: "filled", source: "package" },
    ]);
    expect(["first_name", "last_name", "phone"].map((id) => page.field(id).value)).toEqual(["MIRA", "Petrova", "0880000175"]);
  });

  it("says the CV didn't attach when the portal rejects it, and leaves the other fields filled", async () => {
    const page = filesPage({ uploads: "reject" });

    const outcomes = await createGreenhouseFiller({ settleMs: 0 }).fill(page.document, [fill("first_name", "Mira"), attach("resume", "cv")], [cv]);

    expect(outcomes).toEqual([{ fieldId: "first_name", outcome: "filled", source: "profile" }, { fieldId: "resume", outcome: "didnt-stick", source: null }]);
    expect(marks(page.document)).toEqual(["resume:didnt-stick", "first_name:filled"]);
  });

  it("filling again keeps the CV it attached, and undo takes it off", async () => {
    const page = filesPage();
    const filler = createGreenhouseFiller({ settleMs: 0 });
    await filler.fill(page.document, [attach("resume", "cv")], [cv]);

    const again = await filler.fill(page.document, [attach("resume", "cv")], [cv]);
    expect(again).toEqual([{ fieldId: "resume", outcome: "filled", source: "package" }]);
    expect(page.field("resume").files).toHaveLength(1);

    expect(filler.undo(page.document)).toBe(1);
    expect(page.field("resume").files).toHaveLength(0);
    expect(marks(page.document)).toEqual([]);
  });
});

describe("what filling never does", () => {
  it("never presses Submit or ticks a consent box, even when told to fill one", async () => {
    for (const page of [classic(), newBoard()]) {
      const filler = createGreenhouseFiller();
      const reading = filler.read(page.document);
      const consent = reading.fields.find((f) => f.consent)!;

      const outcomes = await filler.fill(page.document, reading.fields.map((f) => fill(f.id, f.kind === "checkbox" ? "checked" : "Mira")));
      filler.undo(page.document);

      expect(page.presses).toEqual([]);
      expect((page.document.getElementById(consent.id) as HTMLInputElement).checked).toBe(false);
      expect(outcomes.find((o) => o.fieldId === consent.id)!.outcome).toBe("skipped");
    }
  });

  it("refuses every submit, navigation and consent control on the fixtures", () => {
    const files = openFixture("greenhouse-files.html", "https://boards.greenhouse.io/vireohealth/jobs/4471029");
    const drop = openFixture("greenhouse-dropzone.html", "https://job-boards.greenhouse.io/kestrel/jobs/4410");
    for (const page of [classic(), newBoard(), files, drop]) {
      const controls = Array.from(page.document.querySelectorAll("button, input[type=button], input[type=submit], a, form, input[type=checkbox]"));
      expect(controls.length).toBeGreaterThanOrEqual(2);
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

describe("custom and demographic questions", () => {
  const questions = () => openFixture("greenhouse-questions.html", "https://boards.greenhouse.io/vireohealth/jobs/4471077");
  const ids = {
    sponsorship: "job_application_answers_attributes_0_answer_selected_options_attributes_0_question_option_id",
    notice: "job_application_answers_attributes_1_text_value",
    relocate: "job_application[answers_attributes][2][boolean_value]",
    office: "job_application_answers_attributes_3_boolean_value",
    detection: "job_application_answers_attributes_4_text_value",
    salary: "job_application_answers_attributes_5_text_value",
  };

  it("reads a radio group as one question with its options, and the limits and voluntary section", () => {
    const r = createGreenhouseFiller().read(questions().document);

    expect(r.fields.map((f) => [f.id, f.label, f.kind, f.required])).toEqual([
      ["first_name", "First Name", "text", true],
      [ids.sponsorship, "Do you require visa sponsorship?", "select", true],
      [ids.notice, "What is your notice period?", "text", true],
      [ids.relocate, "Are you willing to relocate to Sofia?", "radio", true],
      [ids.office, "I can work from the Sofia office two days a week", "checkbox", false],
      [ids.detection, "Describe a detection rule you wrote that reduced false positives.", "textarea", true],
      [ids.salary, "Expected gross monthly salary (EUR)", "text", true],
      ["job_application_gender", "Gender", "select", false],
      ["job_application_hispanic_ethnicity", "Are you Hispanic/Latino?", "select", false],
      ["job_application_veteran_status", "Veteran Status", "select", false],
      ["job_application_data_compliance_gdpr_consent_given", "I agree to Vireo Health processing my data as described in the privacy notice.", "checkbox", true],
    ]);
    expect(r.fields.find((f) => f.id === ids.relocate)!.options).toEqual(["Yes", "No"]);
    expect(r.fields.find((f) => f.id === ids.detection)!.maxLength).toBe(1000);
    expect(r.fields.find((f) => f.id === ids.office)!.consent).toBe(false);
  });

  it("fills the questions it has answers for, skips the voluntary ones, marks what needs Kris, and leaves consent alone", async () => {
    const page = questions();
    const filler = createGreenhouseFiller();
    const bankFill = (fieldId: string, value: string): FieldAnswer => ({ fieldId, kind: "fill", value, source: "answer-bank", basis: null });

    const outcomes = await filler.fill(page.document, [
      bankFill(ids.sponsorship, "No"),
      { fieldId: ids.notice, kind: "fill", value: "1 month", source: "package", basis: "Approved screening answer in this package" },
      bankFill(ids.relocate, "No"),
      bankFill(ids.office, "checked"),
      { fieldId: ids.detection, kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
      { fieldId: ids.salary, kind: "needs-you", reason: "Your answer bank says: ask each time", basis: null, suggestion: "2000" },
      { fieldId: "job_application_gender", kind: "skip", reason: "Your rule leaves voluntary questions blank", byRule: true },
      { fieldId: "job_application_hispanic_ethnicity", kind: "skip", reason: "Your rule leaves voluntary questions blank", byRule: true },
      { fieldId: "job_application_veteran_status", kind: "skip", reason: "Your rule leaves voluntary questions blank", byRule: true },
      { fieldId: "job_application_data_compliance_gdpr_consent_given", kind: "skip", reason: "Consent boxes are yours to tick" },
    ]);

    expect(outcomes.map((o) => o.outcome)).toEqual(["filled", "filled", "filled", "filled", "needs-you", "needs-you", "skipped", "skipped", "skipped", "skipped"]);
    const doc = page.document;
    expect((doc.getElementById(ids.sponsorship) as HTMLSelectElement).value).toBe("202");
    expect(page.field(ids.notice).value).toBe("1 month");
    expect([page.field("relocate_yes").checked, page.field("relocate_no").checked]).toEqual([false, true]);
    expect(page.field(ids.office).checked).toBe(true);
    expect((doc.getElementById("job_application_gender") as HTMLSelectElement).value).toBe("");
    expect(page.field("job_application_data_compliance_gdpr_consent_given").checked).toBe(false);
    expect(marks(doc)).toEqual([`${ids.sponsorship}:filled`, `${ids.notice}:filled`, `${ids.relocate}:filled`, `${ids.office}:filled`, `${ids.detection}:needs-you`, `${ids.salary}:needs-you`]);
    expect(page.presses).toEqual([]);

    // Undo unticks and clears what it changed.
    filler.undo(doc);
    expect([page.field("relocate_no").checked, page.field(ids.office).checked, page.field(ids.notice).value]).toEqual([false, false, ""]);
  });
});
