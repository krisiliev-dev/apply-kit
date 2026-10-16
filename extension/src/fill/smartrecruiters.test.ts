// The SmartRecruiters filler at its interface (read, fill, undo) on synthetic OneClick pages in
// happy-dom, whose spl-* components keep their controls in shadow roots the test setup builds. Made-up
// company; the values are a made-up person's (Mira Petrova). No live sites.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldAnswer } from "@apply-kit/core";
import { openSmartRecruiters } from "./fixtures/smartrecruiters.ts";
import type { FileToAttach } from "./greenhouse.ts";
import { createSmartRecruitersFiller } from "./smartrecruiters.ts";

const oneClick = (options: Parameters<typeof openSmartRecruiters>[1] = {}) => openSmartRecruiters("smartrecruiters-oneclick.html", options);
const fill = (fieldId: string, value: string): FieldAnswer => ({ fieldId, kind: "fill", value, source: "profile", basis: null });
const marks = (doc: Document) => Array.from(doc.querySelectorAll("[data-apply-kit-mark]")).map((m) => `${m.getAttribute("data-for")}:${m.getAttribute("data-apply-kit-mark")}`);
const publication = "9b1c4e2a-7d3f-4a8b-b5c6-1e2f3a4b5c6d";

describe("reading a SmartRecruiters OneClick page", () => {
  it("finds the fields inside the components' open shadow roots, with their labels, in the portal's order", () => {
    const r = createSmartRecruitersFiller().read(oneClick().document);

    expect(r).toMatchObject({ pageKind: "form", jobRef: { portal: "smartrecruiters", board: "NordlichtBank", jobId: publication }, stepLabel: null, stepCount: null });
    expect(r.fields.filter((f) => f.kind !== "repeating").map((f) => [f.id, f.label, f.kind, f.required])).toEqual([
      ["first-name-input", "First name", "text", true],
      ["last-name-input", "Last name", "text", true],
      ["email-input", "Email", "email", true],
      ["confirm-email-input", "Confirm your email", "email", true],
      ["location-input", "Location", "typeahead", false],
      ["phone-number", "Phone number", "tel", true],
      ["linkedin-input", "LinkedIn profile", "url", false],
      ["resume-input", "Upload CV", "file", true],
      ["experience-0-title-input", "Experience 1 › Title", "text", true],
      ["experience-0-company-input", "Experience 1 › Company", "text", true],
      ["hiring-manager-message-input", "Your message to the hiring manager", "textarea", false],
      ["privacy-consent-input", "I agree to Nordlicht Bank's Privacy Policy", "checkbox", true],
    ]);
    expect(r.fields.find((f) => f.id === "first-name-input")).toMatchObject({ hint: "given-name", maxLength: 100 });
    expect(r.fields.at(-1)!.consent).toBe(true);
  });
});

describe("filling a SmartRecruiters OneClick page", () => {
  it("sets the inner inputs so each component registers the value, and the confirm-email field gets the same job address", async () => {
    const page = oneClick();
    // The components ignore a direct write to their inner input, as SmartRecruiters' do.
    page.inner("first-name").value = "Mimi";
    expect(page.registered("first-name")).toBe("");

    const outcomes = await createSmartRecruitersFiller({ settleMs: 0 }).fill(page.document, [
      fill("first-name-input", "Mira"), fill("last-name-input", "Petrova"),
      { fieldId: "email-input", kind: "fill", value: "mira.petrova@example.com", source: "profile", basis: "Your job address" },
      { fieldId: "confirm-email-input", kind: "fill", value: "mira.petrova@example.com", source: "profile", basis: "Your job address" },
      fill("location-input", "Sofia, Bulgaria"),
      { fieldId: "privacy-consent-input", kind: "skip", reason: "Consent boxes are yours to tick" },
    ]);

    expect(outcomes.map((o) => o.outcome)).toEqual(["filled", "filled", "filled", "filled", "filled", "skipped"]);
    expect(["first-name", "last-name", "email", "confirm-email", "location"].map(page.registered)).toEqual(["Mira", "Petrova", "mira.petrova@example.com", "mira.petrova@example.com", "Sofia, Bulgaria"]);
    expect(page.inner("privacy-consent").checked).toBe(false);
    expect(marks(page.document)).toEqual(["first-name-input:filled", "last-name-input:filled", "email-input:filled", "confirm-email-input:filled", "location-input:filled"]);
    expect(page.presses).toEqual([]);
  });

  it("lists a field in a closed shadow root as needs-you, marked on its component, and never guesses into it", async () => {
    const page = oneClick();

    const [phone] = await createSmartRecruitersFiller({ settleMs: 0 }).fill(page.document, [fill("phone-number", "+359 88 000 0175")]);

    expect(phone).toEqual({ fieldId: "phone-number", outcome: "needs-you", source: null });
    expect(page.inner("phone-number").value).toBe("");
    expect(marks(page.document)).toEqual(["phone-number:needs-you"]);
  });

  it("undo restores what it changed inside the shadow roots", async () => {
    const page = oneClick();
    const filler = createSmartRecruitersFiller({ settleMs: 0 });
    await filler.fill(page.document, [fill("first-name-input", "Mira"), fill("linkedin-input", "https://www.linkedin.com/in/mira-petrova-example")]);

    expect(filler.undo(page.document)).toBe(2);
    expect([page.registered("first-name"), page.registered("linkedin")]).toEqual(["", ""]);
    expect(marks(page.document)).toEqual([]);
  });
});

describe("the CV drop zone", () => {
  const cvName = "Mira_Petrova_CV_Nordlicht_Bank_Application_Security_Engineer.pdf";
  const cv: FileToAttach = { which: "cv", fileName: cvName, type: "application/pdf", base64: "JVBERi1mYWtlIENW" };
  const attach: FieldAnswer = { fieldId: "resume-input", kind: "file", which: "cv", fileName: cvName, size: 12, source: "package", basis: "Your package's CV, v1" };

  afterEach(() => { vi.useRealTimers(); });

  it("drops the CV on a zone that ignores the input's change, and the zone shows it", async () => {
    const page = oneClick({ uploads: "drop-only" });

    const outcomes = await createSmartRecruitersFiller({ settleMs: 0 }).fill(page.document, [attach], [cv]);

    expect(outcomes).toEqual([{ fieldId: "resume-input", outcome: "filled", source: "package" }]);
    expect(page.shownFile()).toBe(cvName);
    expect(marks(page.document)).toEqual(["resume-input:filled"]);
    expect(page.presses).toEqual([]);
  });

  it("says the CV didn't attach when the zone rejects it, and fills the rest", async () => {
    const page = oneClick({ uploads: "reject" });

    const outcomes = await createSmartRecruitersFiller({ settleMs: 0 }).fill(page.document, [fill("first-name-input", "Mira"), attach], [cv]);

    expect(outcomes).toEqual([{ fieldId: "first-name-input", outcome: "filled", source: "profile" }, { fieldId: "resume-input", outcome: "didnt-stick", source: null }]);
    expect(page.shownFile()).toBe("");
    expect(marks(page.document)).toEqual(["resume-input:didnt-stick", "first-name-input:filled"]);
  });

  it("attaches the CV first and lets SmartRecruiters read it: what it filled is kept and reported", async () => {
    vi.useFakeTimers();
    const page = oneClick({ cvParser: { delayMs: 800, values: { "first-name": "MIRA", "experience-0-title": "Security Engineer" } } });

    const filling = createSmartRecruitersFiller({ settleMs: 1500 }).fill(page.document, [
      fill("first-name-input", "Mira"), fill("last-name-input", "Petrova"), attach,
      { fieldId: "experience-0-title-input", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
      { fieldId: "experience-0-company-input", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
    ], [cv]);
    await vi.advanceTimersByTimeAsync(3000);

    expect(await filling).toEqual([
      { fieldId: "first-name-input", outcome: "kept", source: null },
      { fieldId: "last-name-input", outcome: "filled", source: "profile" },
      { fieldId: "resume-input", outcome: "filled", source: "package" },
      { fieldId: "experience-0-title-input", outcome: "kept", source: null },
      { fieldId: "experience-0-company-input", outcome: "needs-you", source: null },
    ]);
    expect(["first-name", "last-name", "experience-0-title"].map(page.registered)).toEqual(["MIRA", "Petrova", "Security Engineer"]);
  });
});

describe("the screening questions step and the confirmation", () => {
  it("reads the second step's questions with its step label, and fills them without pressing Back or Submit", async () => {
    const page = openSmartRecruiters("smartrecruiters-questions.html");
    const filler = createSmartRecruitersFiller({ settleMs: 0 });

    const r = filler.read(page.document);
    expect(r).toMatchObject({ pageKind: "form", stepLabel: "Screening questions", stepCount: null });
    expect(r.fields.filter((f) => f.kind !== "repeating").map((f) => [f.id, f.label, f.kind, f.required, f.options])).toEqual([
      ["q-right-to-work", "Do you have the right to work in Bulgaria?", "radio", true, ["Yes", "No"]],
      ["q-notice-select", "What is your notice period?", "select", true, ["Immediately", "1 month", "2 months or more"]],
      ["q-why-input", "Why are you interested in this role?", "textarea", true, []],
    ]);

    const outcomes = await filler.fill(page.document, [
      { fieldId: "q-right-to-work", kind: "fill", value: "Yes", source: "answer-bank", basis: null },
      { fieldId: "q-notice-select", kind: "fill", value: "1 month", source: "answer-bank", basis: null },
      { fieldId: "q-why-input", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
    ]);
    expect(outcomes.map((o) => o.outcome)).toEqual(["filled", "filled", "needs-you"]);
    expect([page.inner("q-right-to-work").checked, page.registered("q-notice")]).toEqual([true, "1"]);
    expect(page.presses).toEqual([]);
  });

  it("reads the page after Submit as a confirmation of the publication, pressing nothing", () => {
    const page = openSmartRecruiters("smartrecruiters-confirmation.html");

    expect(createSmartRecruitersFiller().read(page.document)).toEqual({
      pageKind: "confirmation", jobRef: { portal: "smartrecruiters", board: "NordlichtBank", jobId: publication }, stepLabel: null, stepCount: null, fields: [],
    });
    expect(page.presses).toEqual([]);
  });
});

describe("what filling a SmartRecruiters page never does", () => {
  it("never presses Next, Submit, Add or Apply with LinkedIn, nor ticks the consent box, even when told to fill everything", async () => {
    const page = oneClick();
    const filler = createSmartRecruitersFiller({ settleMs: 0 });
    const fields = filler.read(page.document).fields;

    await filler.fill(page.document, fields.filter((f) => f.kind !== "file").map((f) => fill(f.id, f.kind === "checkbox" ? "checked" : "Mira")));
    filler.undo(page.document);

    expect(page.presses).toEqual([]);
    expect(page.inner("privacy-consent").checked).toBe(false);
  });

  it("describes a field inside a shadow root by its structure, never its value", async () => {
    const page = oneClick();
    const filler = createSmartRecruitersFiller({ settleMs: 0 });
    await filler.fill(page.document, [fill("first-name-input", "Mira")]);

    expect(filler.describe(page.document, "first-name-input")).toEqual({
      tag: "input", type: "text", role: null, kind: "text",
      attributes: { id: "first-name-input", type: "text", required: "", autocomplete: "given-name", maxlength: "100" },
      labelChain: [{ from: "label[for]", text: "First name" }],
      options: [],
    });
    expect(filler.describe(page.document, "phone-number")).toMatchObject({ tag: "spl-phone-field", kind: "tel", labelChain: [{ from: "component label", text: "Phone number" }] });
  });
});
