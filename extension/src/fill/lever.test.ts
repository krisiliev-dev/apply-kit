// The Lever filler at its interface (read, fill, undo) on synthetic Lever pages in happy-dom: the
// apply page, the posting, /thanks, and a company page embedding the form. Made-up company
// (Larkspur Logistics); the values are a made-up person's (Mira Petrova). No live sites.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldAnswer } from "@apply-kit/core";
import { openFixture, type FixtureOptions } from "./fixtures/load.ts";
import { createLeverFiller } from "./lever.ts";
import type { FileToAttach } from "./greenhouse.ts";
import { choiceRefusal, choose, refusal } from "./page-actions.ts";

const jobId = "3f6c2a1e-8b4d-4c7a-9e21-5d0b7a6c4f18";
const applyUrl = `https://jobs.lever.co/larkspur/${jobId}/apply`;
const apply = (options: FixtureOptions = {}) => openFixture("lever-apply.html", applyUrl, { controlled: true, ...options });
const card = (n: number) => `cards[5b1d9e2a-0c3f-4e6b-a7d8-1f2e3d4c5b6a][field${n}]`;

const fill = (fieldId: string, value: string, source: "profile" | "answer-bank" | "package" = "profile"): FieldAnswer => ({ fieldId, kind: "fill", value, source, basis: null });
const marks = (doc: Document) => Array.from(doc.querySelectorAll("[data-apply-kit-mark]")).map((m) => `${m.getAttribute("data-for")}:${m.getAttribute("data-apply-kit-mark")}`);
const cvName = "Mira_Petrova_CV_Larkspur_Logistics_Security_Engineer.pdf";
const cv: FileToAttach = { which: "cv", fileName: cvName, type: "application/pdf", base64: "JVBERi1mYWtlIENW" };
const attachCv: FieldAnswer = { fieldId: "resume-upload-input", kind: "file", which: "cv", fileName: cvName, size: 12, source: "package", basis: "Your package's CV, v1" };

afterEach(() => { vi.useRealTimers(); });

describe("reading a Lever page", () => {
  it("finds the apply page's fields in the portal's order: the CV first, one full-name field, links, the questions, Additional information, the EEO block", () => {
    const r = createLeverFiller().read(apply().document);

    expect(r).toMatchObject({ pageKind: "form", jobRef: { portal: "lever", board: "larkspur", jobId }, stepLabel: null, stepCount: null });
    expect(r.fields.map((f) => [f.id, f.label, f.kind, f.required])).toEqual([
      ["resume-upload-input", "Resume/CV", "file", true],
      ["name", "Full name", "text", true],
      ["email", "Email", "email", true],
      ["phone", "Phone", "text", false],
      ["location-input", "Current location", "typeahead", false],
      ["org", "Current company", "text", false],
      ["urls[LinkedIn]", "LinkedIn URL", "text", false],
      ["urls[GitHub]", "GitHub URL", "text", false],
      ["urls[Portfolio]", "Portfolio URL", "text", false],
      [card(0), "What is your notice period?", "text", true],
      [card(1), "Are you willing to relocate to Sofia?", "radio", true],
      [card(2), "Which languages can you work in?", "checkbox", false],
      [card(3), "How did you hear about us?", "select", false],
      [card(4), "Describe a detection rule you wrote that reduced false positives.", "textarea", true],
      ["comments", "Additional information", "textarea", false],
      ["eeo[gender]", "Gender", "select", false],
      ["eeo[race]", "Race", "select", false],
      ["eeo[veteran]", "Veteran status", "select", false],
      ["consent[store]", "I agree to Larkspur Logistics storing my data for future openings, as described in the privacy notice.", "checkbox", false],
    ]);
    const field = (id: string) => r.fields.find((f) => f.id === id)!;
    expect(field(card(1)).options).toEqual(["Yes", "No"]);
    expect(field(card(2)).options).toEqual(["English", "Bulgarian", "German"]);
    expect(field(card(3)).options).toEqual(["LinkedIn", "Company website", "Referral"]);
    expect(field(card(4)).maxLength).toBe(2000);
    expect(field("consent[store]")).toMatchObject({ consent: true, password: false });
    expect(field(card(2)).consent).toBe(false);
  });

  it("reads the posting without its form as a posting, and /thanks as a confirmation of the job", () => {
    const posting = openFixture("lever-posting.html", `https://jobs.lever.co/larkspur/${jobId}`);
    const thanks = openFixture("lever-thanks.html", `https://jobs.lever.co/larkspur/${jobId}/thanks`);

    expect(createLeverFiller().read(posting.document)).toEqual({ pageKind: "posting", jobRef: { portal: "lever", board: "larkspur", jobId }, stepLabel: null, stepCount: null, fields: [] });
    expect(createLeverFiller().read(thanks.document)).toEqual({ pageKind: "confirmation", jobRef: { portal: "lever", board: "larkspur", jobId }, stepLabel: null, stepCount: null, fields: [] });
    expect([...posting.presses, ...thanks.presses]).toEqual([]);
  });

  it("reads the form inside a company page's frame with the job from the frame's address", () => {
    const company = openFixture("company-lever-embed.html", "https://larkspur-logistics.example/careers/security-engineer");
    expect(createLeverFiller().read(company.document)).toMatchObject({ pageKind: "other", jobRef: null, fields: [] });

    // The frame's own document, at the frame's address.
    const src = company.document.getElementById("lever-frame")!.getAttribute("src")!;
    const frame = openFixture("lever-apply.html", src);
    const r = createLeverFiller().read(frame.document);
    expect(r.jobRef).toEqual({ portal: "lever", board: "larkspur", jobId });
    expect(r.fields).toHaveLength(19);
  });
});

describe("filling a Lever page", () => {
  it("fills the full name, contact and links into React-style inputs, and the cover letter into Additional information", async () => {
    const page = apply();
    const outcomes = await createLeverFiller({ settleMs: 0 }).fill(page.document, [
      fill("name", "Mira Petrova"), fill("email", "mira.petrova@example.com"), fill("phone", "+359 88 000 0175"),
      fill("urls[LinkedIn]", "https://www.linkedin.com/in/mira-petrova-example"),
      { fieldId: "urls[GitHub]", kind: "skip", reason: "Your profile has no GitHub link" },
      { fieldId: "comments", kind: "fill", value: "Dear Larkspur Logistics team,", source: "package", basis: "Your package's letter, v1" },
    ]);

    expect(outcomes.map((o) => [o.fieldId, o.outcome, o.source])).toEqual([
      ["name", "filled", "profile"], ["email", "filled", "profile"], ["phone", "filled", "profile"], ["urls[LinkedIn]", "filled", "profile"],
      ["urls[GitHub]", "skipped", null], ["comments", "filled", "package"],
    ]);
    expect(["name", "email", "comments"].map((id) => page.field(id).value)).toEqual(["Mira Petrova", "mira.petrova@example.com", "Dear Larkspur Logistics team,"]);
    expect(page.presses).toEqual([]);
  });

  it("attaches the CV first; what Lever read from it is kept and reported, never overwritten", async () => {
    vi.useFakeTimers();
    const page = apply({ cvParser: { delayMs: 800, values: { name: "MIRA PETROVA", email: "mira.p@example.com", org: "Northwind Bank" } } });

    const filling = createLeverFiller({ settleMs: 1500 }).fill(page.document, [
      attachCv, fill("name", "Mira Petrova"), fill("email", "mira.petrova@example.com"), fill("phone", "+359 88 000 0175"),
    ], [cv]);
    await vi.advanceTimersByTimeAsync(1500);
    const outcomes = await filling;

    expect(outcomes).toEqual([
      { fieldId: "resume-upload-input", outcome: "filled", source: "package" },
      { fieldId: "name", outcome: "kept", source: null },
      { fieldId: "email", outcome: "kept", source: null },
      { fieldId: "phone", outcome: "filled", source: "profile" },
    ]);
    expect(["name", "email", "org", "phone"].map((id) => page.field(id).value)).toEqual(["MIRA PETROVA", "mira.p@example.com", "Northwind Bank", "+359 88 000 0175"]);
    expect(marks(page.document)).toEqual(["resume-upload-input:filled", "name:kept", "email:kept", "phone:filled"]);
  });

  it("answers the custom questions: text, a radio, a tick box among several, a dropdown; leaves the EEO block by rule and consent alone", async () => {
    const page = apply();
    const filler = createLeverFiller({ settleMs: 0 });

    const outcomes = await filler.fill(page.document, [
      fill(card(0), "1 month", "package"), fill(card(1), "Yes", "answer-bank"), fill(card(2), "Bulgarian", "answer-bank"), fill(card(3), "Company website", "answer-bank"),
      { fieldId: card(4), kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
      { fieldId: "eeo[gender]", kind: "skip", reason: "Your rule leaves voluntary questions blank", byRule: true },
      { fieldId: "consent[store]", kind: "skip", reason: "Consent boxes are yours to tick" },
    ]);

    expect(outcomes.map((o) => o.outcome)).toEqual(["filled", "filled", "filled", "filled", "needs-you", "skipped", "skipped"]);
    const ticks = (name: string) => Array.from(page.document.querySelectorAll<HTMLInputElement>("input")).filter((i) => i.getAttribute("name") === name).map((i) => i.checked);
    expect(page.field(card(0)).value).toBe("1 month");
    expect(ticks(card(1))).toEqual([true, false]);
    expect(ticks(card(2))).toEqual([false, true, false]);
    expect((page.field(card(3)) as unknown as HTMLSelectElement).value).toBe("Company website");
    expect((page.field("eeo[gender]") as unknown as HTMLSelectElement).value).toBe("");
    expect(ticks("consent[store]")).toEqual([false]);
    expect(marks(page.document)).toEqual([`${card(0)}:filled`, `${card(1)}:filled`, `${card(2)}:filled`, `${card(3)}:filled`, `${card(4)}:needs-you`]);

    expect(filler.undo(page.document)).toBe(4);
    expect([page.field(card(0)).value, ...ticks(card(1)), ...ticks(card(2))]).toEqual(["", false, false, false, false, false]);
    expect(marks(page.document)).toEqual([]);
  });

  it("types the location and picks Lever's suggestion when it shows; keeps what was typed when none does", async () => {
    vi.useFakeTimers();
    const page = apply({ places: { delayMs: 300, names: ["Sofia, Bulgaria", "Plovdiv, Bulgaria"] } });

    const filling = createLeverFiller({ settleMs: 0 }).fill(page.document, [fill("location-input", "Sofia, Bulgaria")]);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await filling).toEqual([{ fieldId: "location-input", outcome: "filled", source: "profile" }]);
    expect(page.field("location-input").value).toBe("Sofia, Bulgaria");
    expect(page.choices).toEqual(["location-input: Sofia, Bulgaria"]);

    const quiet = apply();
    const typed = createLeverFiller({ settleMs: 0, optionWaitMs: 400 }).fill(quiet.document, [fill("location-input", "Sofia, Bulgaria")]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await typed).toEqual([{ fieldId: "location-input", outcome: "filled", source: "profile" }]);
    expect(quiet.field("location-input").value).toBe("Sofia, Bulgaria");
  });

  it("turns two plausible places into a choice for Kris, never picking one", async () => {
    vi.useFakeTimers();
    const page = apply({ places: { delayMs: 300, names: ["Sofia, Sofia City, Bulgaria", "Sofia, Sofia Province, Bulgaria"] } });

    const filling = createLeverFiller({ settleMs: 0 }).fill(page.document, [fill("location-input", "Sofia, Bulgaria")]);
    await vi.advanceTimersByTimeAsync(2500);

    expect(await filling).toEqual([{ fieldId: "location-input", outcome: "needs-you", source: null, choices: ["Sofia, Sofia City, Bulgaria", "Sofia, Sofia Province, Bulgaria"] }]);
    expect(page.field("location-input").value).toBe("");
    expect(page.choices).toEqual([]);
    expect(marks(page.document)).toEqual(["location-input:needs-you"]);
  });
});

describe("what filling a Lever page never does", () => {
  it("never presses Submit application or ticks the consent box, even when told to fill everything", async () => {
    const page = apply();
    const filler = createLeverFiller({ settleMs: 0, optionWaitMs: 0 });
    const reading = filler.read(page.document);

    const outcomes = await filler.fill(page.document, reading.fields.filter((f) => f.kind !== "file").map((f) => fill(f.id, f.kind === "checkbox" && !f.options.length ? "checked" : f.options[0] ?? "Mira")));

    expect(page.presses).toEqual([]);
    expect(page.field("consent[store]").checked).toBe(false);
    expect(outcomes.find((o) => o.fieldId === "consent[store]")!.outcome).toBe("skipped");
  });

  it("refuses every submit, link and consent control on the Lever pages, and chooses none of them", () => {
    const company = openFixture("company-lever-embed.html", "https://larkspur-logistics.example/careers/security-engineer");
    const thanks = openFixture("lever-thanks.html", `https://jobs.lever.co/larkspur/${jobId}/thanks`);
    for (const page of [apply(), thanks, company]) {
      const controls = Array.from(page.document.querySelectorAll("button, input[type=submit], a, form, input[name^=consent]"));
      expect(controls.length).toBeGreaterThanOrEqual(1);
      for (const el of controls) {
        expect(refusal(el, el.closest("label")?.textContent ?? ""), el.outerHTML.slice(0, 80)).not.toBeNull();
        expect(choiceRefusal(el), el.outerHTML.slice(0, 80)).not.toBeNull();
        expect(choose(el)).toBe(false);
      }
      expect(page.presses).toEqual([]);
    }
  });
});
