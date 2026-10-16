// The Workable filler at its interface (read, fill, undo) on a synthetic Workable application in
// happy-dom: a React-style form whose inputs ignore direct value writes. Made-up company; the values
// are a made-up person's (Mira Petrova). No live sites.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldAnswer } from "@apply-kit/core";
import { openFixture } from "./fixtures/load.ts";
import type { FileToAttach } from "./greenhouse.ts";
import { createWorkableFiller } from "./workable.ts";

const url = "https://apply.workable.com/dreamwire/j/A1B2C3D4E5/apply/";
const workable = (options: Parameters<typeof openFixture>[2] = {}) => openFixture("workable-apply.html", url, { controlled: true, ...options });
const fill = (fieldId: string, value: string, source: "profile" | "answer-bank" | "package" = "profile"): FieldAnswer => ({ fieldId, kind: "fill", value, source, basis: null });
const needsYou = (fieldId: string): FieldAnswer => ({ fieldId, kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null });
const marks = (doc: Document) => Array.from(doc.querySelectorAll("[data-apply-kit-mark]")).map((m) => `${m.getAttribute("data-for")}:${m.getAttribute("data-apply-kit-mark")}`);
const cvName = "Mira_Petrova_CV_Dreamwire_Detection_Engineer.pdf";
const cv: FileToAttach = { which: "cv", fileName: cvName, type: "application/pdf", base64: "JVBERi1mYWtlIENW" };
const attach: FieldAnswer = { fieldId: "resume", kind: "file", which: "cv", fileName: cvName, size: 12, source: "package", basis: "Your package's CV, v1" };

describe("reading a Workable application", () => {
  it("finds every standard field, the entries and the QA_ questions in the portal's order; \"Optional\" in the label means not required", () => {
    const r = createWorkableFiller().read(workable().document);

    expect(r).toMatchObject({ pageKind: "form", jobRef: { portal: "workable", board: "dreamwire", jobId: "A1B2C3D4E5" }, stepLabel: null, stepCount: null });
    expect(r.fields.map((f) => [f.id, f.label, f.kind, f.required])).toEqual([
      ["firstname", "First name", "text", true],
      ["lastname", "Last name", "text", true],
      ["email", "Email", "email", true],
      ["headline", "Headline", "text", false],
      ["phone", "Phone", "tel", true],
      ["address", "Address", "text", false],
      ["resume", "Resume", "file", true],
      ["cover_letter", "Cover letter", "textarea", false],
      ["summary", "Summary", "textarea", false],
      ["education_0_school", "Education 1 › School", "text", true],
      ["education_0_field_of_study", "Education 1 › Field of study", "text", false],
      ["education_0_degree", "Education 1 › Degree", "text", false],
      ["QA_6110201", "What is your notice period?", "text", true],
      ["QA_6110202", "Do you require visa sponsorship to work in Bulgaria?", "radio", true],
      ["QA_6110203", "Which SIEM have you used the most?", "radio", false],
      ["QA_6110204", "When can you start?", "date", true],
      ["gdpr", "I have read and agree to the Privacy Policy", "checkbox", true],
    ]);
    expect(r.fields.find((f) => f.id === "QA_6110203")!.options).toEqual(["Splunk", "Microsoft Sentinel", "Elastic"]);
    expect(r.fields.at(-1)!.consent).toBe(true);
  });

  it("reads the thank-you that replaces the form as a confirmation of the job", () => {
    const page = openFixture("workable-confirmation.html", url);

    expect(createWorkableFiller().read(page.document)).toEqual({ pageKind: "confirmation", jobRef: { portal: "workable", board: "dreamwire", jobId: "A1B2C3D4E5" }, stepLabel: null, stepCount: null, fields: [] });
    expect(page.presses).toEqual([]);
  });
});

describe("filling a Workable application", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("attaches the CV first, keeps what Workable read from it, fills the rest and each question kind, and marks what needs Kris", async () => {
    vi.useFakeTimers();
    const page = workable({ cvParser: { delayMs: 800, values: { lastname: "Petrova", headline: "Detection Engineer at Orbital Bank", education_0_school: "Technical University of Sofia" } } });

    const filling = createWorkableFiller({ settleMs: 1500 }).fill(page.document, [
      fill("firstname", "Mira"), fill("lastname", "Petrova"), { fieldId: "email", kind: "fill", value: "mira.petrova@example.com", source: "profile", basis: "Your job address" },
      { fieldId: "headline", kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" },
      fill("phone", "+359 88 000 0175"),
      { fieldId: "address", kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" },
      attach,
      { fieldId: "cover_letter", kind: "fill", value: "Dear Dreamwire team,", source: "package", basis: "Your package's letter, v1" },
      { fieldId: "summary", kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" },
      needsYou("education_0_school"),
      { fieldId: "education_0_field_of_study", kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" },
      { fieldId: "education_0_degree", kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" },
      { fieldId: "QA_6110201", kind: "fill", value: "1 month", source: "package", basis: "Approved screening answer in this package" },
      fill("QA_6110202", "No", "answer-bank"),
      fill("QA_6110203", "Microsoft Sentinel", "answer-bank"),
      fill("QA_6110204", "2026-12-01", "answer-bank"),
      { fieldId: "gdpr", kind: "skip", reason: "Consent boxes are yours to tick" },
    ], [cv]);
    await vi.advanceTimersByTimeAsync(5000);
    const outcomes = await filling;

    expect(Object.fromEntries(outcomes.map((o) => [o.fieldId, o.outcome]))).toEqual({
      firstname: "filled", lastname: "kept", email: "filled", headline: "skipped", phone: "filled", address: "skipped", resume: "filled", cover_letter: "filled",
      summary: "skipped", education_0_school: "kept", education_0_field_of_study: "skipped", education_0_degree: "skipped",
      QA_6110201: "filled", QA_6110202: "filled", QA_6110203: "filled", QA_6110204: "filled", gdpr: "skipped",
    });
    const value = (id: string) => (page.document.getElementById(id) as HTMLInputElement).value;
    expect(["firstname", "lastname", "phone", "cover_letter", "QA_6110201", "QA_6110204", "headline", "education_0_school"].map(value))
      .toEqual(["Mira", "Petrova", "+359 88 000 0175", "Dear Dreamwire team,", "1 month", "2026-12-01", "Detection Engineer at Orbital Bank", "Technical University of Sofia"]);
    expect([page.field("QA_6110202_false").checked, page.field("QA_6110203_1").checked, page.field("gdpr").checked]).toEqual([true, true, false]);
    expect(page.presses).toEqual([]);
  });

  it("marks a required question it has no answer for as needs-you, and undo restores what it changed", async () => {
    const page = workable();
    const filler = createWorkableFiller({ settleMs: 0 });

    const outcomes = await filler.fill(page.document, [fill("firstname", "Mira"), fill("QA_6110202", "No", "answer-bank"), needsYou("QA_6110201")]);

    expect(outcomes.map((o) => o.outcome)).toEqual(["filled", "filled", "needs-you"]);
    expect(marks(page.document)).toEqual(["firstname:filled", "QA_6110202:filled", "QA_6110201:needs-you"]);
    expect(filler.undo(page.document)).toBe(2);
    expect([page.field("firstname").value, page.field("QA_6110202_false").checked]).toEqual(["", false]);
    expect(marks(page.document)).toEqual([]);
  });

  it("never presses Submit application, + Add or the country picker, nor ticks the consent box", async () => {
    const page = workable();
    const filler = createWorkableFiller({ settleMs: 0 });
    const fields = filler.read(page.document).fields;

    await filler.fill(page.document, fields.filter((f) => f.kind !== "file").map((f) => fill(f.id, f.kind === "checkbox" ? "checked" : "Mira")));

    expect(page.presses).toEqual([]);
    expect(page.field("gdpr").checked).toBe(false);
  });
});
