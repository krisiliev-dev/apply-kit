// The Ashby filler at its interface (read, fill, undo) on synthetic Ashby pages in happy-dom: the
// application page, its inline thank-you, and a company page embedding the board on one job. Made-up
// company (Quillfeather Labs); the values are a made-up person's (Mira Petrova). No live sites.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldAnswer } from "@apply-kit/core";
import { openFixture, type FixtureOptions } from "./fixtures/load.ts";
import { createAshbyFiller } from "./ashby.ts";
import type { FileToAttach } from "./greenhouse.ts";
import { choiceRefusal, choose, refusal } from "./page-actions.ts";

const jobId = "a2b4c6d8-1e3f-4a5b-8c7d-9e0f1a2b3c4d";
const url = `https://jobs.ashbyhq.com/quillfeather/${jobId}/application`;
const application = (options: FixtureOptions = {}) => openFixture("ashby-application.html", url, { controlled: true, ...options });
const linkedin = "7c1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

const fill = (fieldId: string, value: string, source: "profile" | "answer-bank" | "package" = "profile"): FieldAnswer => ({ fieldId, kind: "fill", value, source, basis: null });
const marks = (doc: Document) => Array.from(doc.querySelectorAll("[data-apply-kit-mark]")).map((m) => `${m.getAttribute("data-for")}:${m.getAttribute("data-apply-kit-mark")}`);
const pressed = (doc: Document, group: string) => Array.from(doc.getElementById(group)!.querySelectorAll("button")).filter((b) => b.classList.contains("_active")).map((b) => b.textContent);
const cvName = "Mira_Petrova_CV_Quillfeather_Labs_Platform_Engineer.pdf";
const cv: FileToAttach = { which: "cv", fileName: cvName, type: "application/pdf", base64: "JVBERi1mYWtlIENW" };

afterEach(() => { vi.useRealTimers(); });

describe("reading an Ashby page", () => {
  it("finds the system fields, the questions and the survey in the portal's order, leaving out Autofill from resume", () => {
    const r = createAshbyFiller().read(application().document);

    expect(r).toMatchObject({ pageKind: "form", jobRef: { portal: "ashby", board: "quillfeather", jobId }, stepLabel: null, stepCount: null });
    expect(r.fields.map((f) => [f.id, f.label, f.kind, f.required])).toEqual([
      ["_systemfield_name", "Name", "text", true],
      ["_systemfield_email", "Email", "email", true],
      ["_systemfield_phone", "Phone", "tel", false],
      ["_systemfield_location", "Location", "typeahead", true],
      ["_systemfield_resume", "Resume", "file", true],
      [linkedin, "LinkedIn", "text", false],
      ["q-eu", "Are you authorized to work in the EU?", "yes-no", true],
      ["q-sponsor", "Will you now or in the future require visa sponsorship?", "yes-no", true],
      ["b2c3d4e5-tools", "Which of these have you run in production?", "checkbox", false],
      ["d4e5f6a7-start", "Earliest start date", "date", true],
      ["e5f6a7b8-why", "Why Quillfeather Labs?", "textarea", true],
      ["consent-retain", "I consent to Quillfeather Labs keeping my application for 12 months.", "checkbox", false],
      ["survey-gender", "What is your gender identity?", "radio", false],
    ]);
    const field = (id: string) => r.fields.find((f) => f.id === id)!;
    expect(field("q-eu").options).toEqual(["Yes", "No"]);
    expect(field("b2c3d4e5-tools").options).toEqual(["Kubernetes", "Terraform", "Kafka"]);
    expect(field("survey-gender").options).toEqual(["Woman", "Man", "Non-binary", "I prefer not to answer"]);
    expect(field("consent-retain").consent).toBe(true);
  });

  it("reads Ashby's inline thank-you as a confirmation of the job", () => {
    const page = openFixture("ashby-confirmation.html", url);
    expect(createAshbyFiller().read(page.document)).toEqual({ pageKind: "confirmation", jobRef: { portal: "ashby", board: "quillfeather", jobId }, stepLabel: null, stepCount: null, fields: [] });
    expect(page.presses).toEqual([]);
  });

  it("reads the form inside a company page's embed with the job from the frame's address", () => {
    const company = openFixture("company-ashby-embed.html", `https://quillfeather.example/careers?ashby_jid=${jobId}`);
    expect(createAshbyFiller().read(company.document)).toMatchObject({ pageKind: "other", fields: [] });

    const src = company.document.getElementById("ashby_embed_iframe")!.getAttribute("src")!;
    const r = createAshbyFiller().read(openFixture("ashby-application.html", src).document);
    expect(r.jobRef).toEqual({ portal: "ashby", board: "quillfeather", jobId });
    expect(r.fields).toHaveLength(13);
  });
});

describe("filling an Ashby page", () => {
  it("attaches the CV to the Resume field, never to Autofill from resume, and fills the system fields", async () => {
    const page = application();
    const outcomes = await createAshbyFiller({ settleMs: 0 }).fill(page.document, [
      fill("_systemfield_name", "Mira Petrova"), fill("_systemfield_email", "mira.petrova@example.com"),
      { fieldId: "_systemfield_resume", kind: "file", which: "cv", fileName: cvName, size: 12, source: "package", basis: "Your package's CV, v1" },
      fill(linkedin, "https://www.linkedin.com/in/mira-petrova-example"),
    ], [cv]);

    expect(outcomes.map((o) => o.outcome)).toEqual(["filled", "filled", "filled", "filled"]);
    expect(page.field("_systemfield_resume").files![0]!.name).toBe(cvName);
    expect(page.field("autofill-resume").files ?? []).toHaveLength(0);
    expect(page.field("_systemfield_name").value).toBe("Mira Petrova");
    expect(page.presses).toEqual([]);
  });

  it("chooses the yes/no buttons as a form control, ticks a box among several, types the date in the picker's format", async () => {
    const page = application();
    const filler = createAshbyFiller({ settleMs: 0 });

    const outcomes = await filler.fill(page.document, [
      fill("q-eu", "Yes", "answer-bank"), fill("q-sponsor", "No", "answer-bank"), fill("b2c3d4e5-tools", "Terraform", "answer-bank"),
      fill("d4e5f6a7-start", "2026-11-16", "answer-bank"),
      { fieldId: "e5f6a7b8-why", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
      { fieldId: "consent-retain", kind: "skip", reason: "Consent boxes are yours to tick" },
      { fieldId: "survey-gender", kind: "skip", reason: "Your rule leaves voluntary questions blank", byRule: true },
    ]);

    expect(outcomes.map((o) => o.outcome)).toEqual(["filled", "filled", "filled", "filled", "needs-you", "skipped", "skipped"]);
    expect([pressed(page.document, "q-eu"), pressed(page.document, "q-sponsor")]).toEqual([["Yes"], ["No"]]);
    expect(page.choices).toEqual(["q-eu: Yes", "q-sponsor: No"]);
    expect(page.field("d4e5f6a7-start").value).toBe("11/16/2026");
    expect(page.field("consent-retain").checked).toBe(false);
    expect(marks(page.document)).toEqual(["q-eu:filled", "q-sponsor:filled", "b2c3d4e5-tools:filled", "d4e5f6a7-start:filled", "e5f6a7b8-why:needs-you"]);
    expect(page.presses).toEqual([]);

    // Undo clears the answers it chose, unticks and empties.
    expect(filler.undo(page.document)).toBe(4);
    expect([pressed(page.document, "q-eu"), pressed(page.document, "q-sponsor"), page.field("d4e5f6a7-start").value]).toEqual([[], [], ""]);
  });

  it("keeps a yes/no Kris already answered", async () => {
    const page = application();
    choose(page.document.getElementById("q-eu")!.querySelectorAll("button")[1]!);

    const [o] = await createAshbyFiller({ settleMs: 0 }).fill(page.document, [fill("q-eu", "Yes", "answer-bank")]);

    expect(o).toEqual({ fieldId: "q-eu", outcome: "kept", source: null });
    expect(pressed(page.document, "q-eu")).toEqual(["No"]);
  });

  it("picks the location only from Ashby's suggestions: the one that fits, or none when nothing shows", async () => {
    vi.useFakeTimers();
    const page = application({ places: { delayMs: 400, names: ["Sofia, Bulgaria", "Sofia Antipolis, France"] } });
    const filling = createAshbyFiller({ settleMs: 0 }).fill(page.document, [fill("_systemfield_location", "Sofia, Bulgaria")]);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await filling).toEqual([{ fieldId: "_systemfield_location", outcome: "filled", source: "profile" }]);
    expect(page.field("_systemfield_location").value).toBe("Sofia, Bulgaria");

    const quiet = application();
    const typed = createAshbyFiller({ settleMs: 0, optionWaitMs: 500 }).fill(quiet.document, [fill("_systemfield_location", "Sofia, Bulgaria")]);
    await vi.advanceTimersByTimeAsync(600);
    expect(await typed).toEqual([{ fieldId: "_systemfield_location", outcome: "didnt-stick", source: null }]);
    expect(quiet.field("_systemfield_location").value).toBe("");
  });
});

describe("what filling an Ashby page never does", () => {
  it("never presses Submit Application, Upload file or Autofill from resume, and chooses only yes/no buttons", () => {
    const company = openFixture("company-ashby-embed.html", `https://quillfeather.example/careers?ashby_jid=${jobId}`);
    for (const page of [application(), openFixture("ashby-confirmation.html", url), company]) {
      for (const el of Array.from(page.document.querySelectorAll("button, a, #consent-retain"))) {
        const yesNo = !!el.closest("._yesno");
        expect(choiceRefusal(el) === null, el.outerHTML.slice(0, 80)).toBe(yesNo);
        if (!yesNo) {
          expect(refusal(el, el.closest("label")?.textContent ?? ""), el.outerHTML.slice(0, 80)).not.toBeNull();
          expect(choose(el)).toBe(false);
        }
      }
      expect(page.presses).toEqual([]);
    }
  });
});

describe("recovery on an Ashby page (#48)", () => {
  it("reads a value back once after a settle: a field the page cleared didn't stick, and Try once more puts it in once", async () => {
    vi.useFakeTimers();
    const page = application({ clears: { id: "_systemfield_phone", afterMs: 200, times: 1 } });
    const filler = createAshbyFiller({ settleMs: 500 });

    const filling = filler.fill(page.document, [fill("_systemfield_phone", "+359 88 000 0175"), fill("_systemfield_name", "Mira Petrova")]);
    await vi.advanceTimersByTimeAsync(600);
    expect((await filling).map((o) => o.outcome)).toEqual(["didnt-stick", "filled"]);

    const again = filler.retry(page.document, "_systemfield_phone", "+359 88 000 0175");
    await vi.advanceTimersByTimeAsync(600);
    expect(await again).toBe("filled");
    expect(page.field("_systemfield_phone").value).toBe("+359 88 000 0175");
  });

  it("describes a yes/no question for a field report by its structure, never its value", async () => {
    const page = application();
    const filler = createAshbyFiller({ settleMs: 0 });
    await filler.fill(page.document, [fill(linkedin, "https://www.linkedin.com/in/mira-petrova-example")]);

    const yesNo = filler.describe(page.document, "q-eu")!;
    expect(yesNo).toMatchObject({ tag: "div", role: "group", kind: "yes-no", options: ["Yes", "No"] });
    expect(yesNo.labelChain[0]).toEqual({ from: "group aria-labelledby", text: "Are you authorized to work in the EU?" });
    expect(JSON.stringify(filler.describe(page.document, linkedin))).not.toContain("mira-petrova");
  });
});
