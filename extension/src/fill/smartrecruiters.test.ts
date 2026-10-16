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
    expect(r.fields.map((f) => [f.id, f.label, f.kind, f.required])).toEqual([
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
