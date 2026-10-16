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
