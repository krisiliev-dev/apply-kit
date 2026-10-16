// The Workday filler at its interface (read, fill, pick, removeEntries, undo) on synthetic Workday
// pages in happy-dom, one per step of an application and the start screen. Workday's widgets are
// simulated by the fixture (list buttons, typeaheads with delayed suggestions, Add and Delete, its CV
// reading); the filler presses them only through the press it's given. Made-up company (Kestrel
// Payments) and person (Mira Petrova). No live sites.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldAnswer } from "@apply-kit/core";
import { openWorkday, type WorkdayOptions } from "./fixtures/workday.ts";
import type { FileToAttach } from "./greenhouse.ts";
import { widgetRefusal } from "./page-actions.ts";
import { createWorkdayFiller } from "./workday.ts";

/** What a click on a widget would be; apply-kit has none in the extension yet (see the report on #44). */
const press = (el: Element) => (el as HTMLElement).click();
const fill = (fieldId: string, value: string, source: "profile" | "answer-bank" | "cv-version" | "package" = "profile"): FieldAnswer => ({ fieldId, kind: "fill", value, source, basis: null });
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

describe("filling My Information", () => {
  const answers: FieldAnswer[] = [
    fill("country--country", "Bulgaria"),
    fill("legalName--firstName", "Mira"),
    fill("legalName--lastName", "Petrova"),
    { fieldId: "address--addressLine1", kind: "skip", reason: "Your profile has no street address" },
    fill("address--city", "Sofia"),
    { fieldId: "address--postalCode", kind: "skip", reason: "Your profile has no postal code" },
    fill("source--source", "LinkedIn", "answer-bank"),
    fill("candidateIsPreviousWorker", "No", "answer-bank"),
    fill("emailAddress", "mira.petrova@example.com"),
    fill("phoneNumber--phoneType", "Mobile", "answer-bank"),
    fill("phoneNumber--countryPhoneCode", "+359"),
    fill("phoneNumber--phoneNumber", "88 000 0175"),
    { fieldId: "phoneNumber--extension", kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" },
  ];

  it("fills list buttons and typeaheads with fake timers, and turns two plausible cities into a choice, leaving nothing half-typed", async () => {
    vi.useFakeTimers();
    const p = page("my-information");
    const filler = createWorkdayFiller({ press });
    filler.read(p.document);

    const filling = filler.fill(p.document, answers);
    await vi.advanceTimersByTimeAsync(20_000);
    const outcomes = await filling;

    expect(outcomes.map((o) => [o.fieldId, o.outcome])).toEqual([
      ["country--country", "filled"], ["legalName--firstName", "filled"], ["legalName--lastName", "filled"], ["address--addressLine1", "skipped"],
      ["address--city", "needs-you"], ["address--postalCode", "skipped"], ["source--source", "filled"], ["candidateIsPreviousWorker", "filled"],
      ["emailAddress", "filled"], ["phoneNumber--phoneType", "filled"], ["phoneNumber--countryPhoneCode", "filled"], ["phoneNumber--phoneNumber", "filled"],
      ["phoneNumber--extension", "skipped"],
    ]);
    expect(outcomes.find((o) => o.fieldId === "address--city")!.choices).toEqual(["Sofia, Sofia City, Bulgaria", "Sofia, Sofia Province, Bulgaria"]);
    expect(p.shown("country--country")).toBe("Bulgaria");
    expect(p.shown("phoneNumber--phoneType")).toBe("Mobile");
    expect(p.picked("phoneNumber--countryPhoneCode")).toEqual(["Bulgaria (+359)"]);
    expect(p.picked("source--source")).toEqual(["LinkedIn"]);
    // No partial selection: nothing picked, nothing left typed, no suggestion list open.
    expect(p.picked("address--city")).toEqual([]);
    expect(p.field("address--city").value).toBe("");
    expect(p.document.querySelectorAll("[role=listbox]")).toHaveLength(0);
    expect(p.field("candidateIsPreviousWorker-1").checked).toBe(true);
    expect(p.field("phoneNumber--phoneNumber").value).toBe("88 000 0175");
    expect(marks(p.document)).toContain("address--city:needs-you");
    expect(p.presses).toEqual([]);

    // Kris chooses the capital: apply-kit picks exactly that one.
    const picking = filler.pick!(p.document, "address--city", "Sofia, Sofia City, Bulgaria");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await picking).toBe("filled");
    expect(p.picked("address--city")).toEqual(["Sofia, Sofia City, Bulgaria"]);
    expect(p.presses).toEqual([]);
  });

  it("waits only so long for suggestions that never come, then leaves the field empty for Kris", async () => {
    vi.useFakeTimers();
    const p = page("my-information", { suggestMs: 60_000 });
    const filler = createWorkdayFiller({ press, waitMs: 2000 });
    filler.read(p.document);

    const filling = filler.fill(p.document, [fill("phoneNumber--countryPhoneCode", "+359")]);
    await vi.advanceTimersByTimeAsync(3000);
    const [o] = await filling;

    expect(o).toMatchObject({ outcome: "didnt-stick" });
    expect(p.field("phoneNumber--countryPhoneCode").value).toBe("");
    expect(p.picked("phoneNumber--countryPhoneCode")).toEqual([]);
  });

  it("without a press of its own, fills the typed fields and leaves Workday's lists to Kris", async () => {
    const p = page("my-information");
    const filler = createWorkdayFiller({ settleMs: 0 });
    filler.read(p.document);

    const outcomes = await filler.fill(p.document, answers);

    expect(outcomes.filter((o) => o.outcome === "needs-you").map((o) => o.fieldId)).toEqual(["country--country", "address--city", "source--source", "phoneNumber--phoneType", "phoneNumber--countryPhoneCode"]);
    expect(p.field("legalName--firstName").value).toBe("Mira");
    expect(p.field("address--city").value).toBe("");
    expect(p.shown("country--country")).toBe("Select One");
  });

  it("undo restores the typed values, unpicks what it picked, and removes its marks", async () => {
    vi.useFakeTimers();
    const p = page("my-information");
    const filler = createWorkdayFiller({ press });
    filler.read(p.document);
    const filling = filler.fill(p.document, [fill("legalName--firstName", "Mira"), fill("phoneNumber--countryPhoneCode", "+359"), fill("candidateIsPreviousWorker", "No")]);
    await vi.advanceTimersByTimeAsync(5000);
    await filling;

    expect(filler.undo(p.document)).toBe(3);
    expect(p.field("legalName--firstName").value).toBe("");
    expect(p.picked("phoneNumber--countryPhoneCode")).toEqual([]);
    expect(p.field("candidateIsPreviousWorker-1").checked).toBe(false);
    expect(marks(p.document)).toEqual([]);
  });
});

describe("filling My Experience", () => {
  const cvName = "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf";
  const cv: FileToAttach = { which: "cv", fileName: cvName, type: "application/pdf", base64: "JVBERi1mYWtlIENW" };
  const attachCv: FieldAnswer = { fieldId: "resume", kind: "file", which: "cv", fileName: cvName, size: 12, source: "package", basis: "Your package's CV, v1" };
  const entries = (add: number, duplicates: { index: number; words: string }[] = []): FieldAnswer =>
    ({ fieldId: "workExperience", kind: "entries", section: "work", add, duplicates, source: "cv-version", basis: "2 roles on the CV in your package" });
  const role = (n: number, title: string, company: string, from: string): FieldAnswer[] => [
    fill(`workExperience-${n}/jobTitle`, title, "cv-version"), fill(`workExperience-${n}/companyName`, company, "cv-version"), fill(`workExperience-${n}/startDate`, from, "cv-version"),
  ];

  it("adds exactly as many entries as asked with Workday's Add, then fills them, dates in the month and year inputs", async () => {
    vi.useFakeTimers();
    const p = page("my-experience");
    const filler = createWorkdayFiller({ press });
    filler.read(p.document);

    const first = filler.fill(p.document, [entries(2)]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await first).toEqual([{ fieldId: "workExperience", outcome: "filled", source: "cv-version" }]);
    expect(p.entries("workExperience")).toEqual(["Work Experience 1", "Work Experience 2"]);

    // The panel reads the page again and fills the new entries.
    const r = filler.read(p.document);
    expect(r.fields.filter((f) => f.entry?.index === 2).map((f) => [f.id, f.label, f.kind, f.hint])).toEqual([
      ["workExperience-2/jobTitle", "Job Title", "text", null],
      ["workExperience-2/companyName", "Company", "text", null],
      ["workExperience-2/location", "Location", "text", null],
      ["workExperience-2/currentlyWorkHere", "I currently work here", "checkbox", null],
      ["workExperience-2/startDate", "From", "date", "month-year"],
      ["workExperience-2/endDate", "To", "date", "month-year"],
      ["workExperience-2/roleDescription", "Role Description", "textarea", null],
    ]);
    const second = filler.fill(p.document, [entries(0), ...role(1, "Security Analyst", "Northwind Bank", "2022-03"), ...role(2, "SOC Intern", "Varna Telecom", "2021-06")]);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await second).every((o) => o.outcome === "filled")).toBe(true);
    expect(p.entries("workExperience")).toHaveLength(2);
    const month = p.document.querySelector<HTMLInputElement>("[data-automation-id=workExperience-2] [data-automation-id=dateSectionMonth-input]")!;
    const year = p.document.querySelector<HTMLInputElement>("[data-automation-id=workExperience-2] [data-automation-id=dateSectionYear-input]")!;
    expect([month.value, year.value]).toEqual(["06", "2021"]);
    expect(filler.read(p.document).fields.find((f) => f.id === "workExperience-1/startDate")!.value).toBe("2022-03");
    expect(p.presses).toEqual([]);
  });

  it("attaches the CV first; entries Workday adds while reading it are left for a fresh read, not added on top", async () => {
    vi.useFakeTimers();
    const p = page("my-experience", { cvReads: { delayMs: 800, entries: [{ title: "Security Analyst", company: "Northwind Bank", from: "2021-03" }, { title: "Security Analyst (SOC)", company: "Northwind Bank", from: "2023-01" }] } });
    const filler = createWorkdayFiller({ press, settleMs: 1500 });
    filler.read(p.document);

    const filling = filler.fill(p.document, [entries(2), attachCv], [cv]);
    await vi.advanceTimersByTimeAsync(5000);
    const outcomes = await filling;

    expect(outcomes).toEqual([{ fieldId: "workExperience", outcome: "skipped", source: null }, { fieldId: "resume", outcome: "filled", source: "package" }]);
    // Only Workday's own two: nothing added on top of them.
    expect(p.entries("workExperience")).toEqual(["Work Experience 1", "Work Experience 2"]);
  });

  it("leaves the duplicates until Remove, then removes them with Workday's own Delete; Keep leaves them", async () => {
    vi.useFakeTimers();
    const work = [
      { title: "Security Analyst", company: "Northwind Bank", from: "2021-03" },
      { title: "Security Analyst (SOC)", company: "Northwind Bank", from: "2023-01" },
      { title: "SOC Intern", company: "Varna Telecom", from: "2021-06" },
      { title: "SOC intern", company: "Varna Telecom", from: "2020-01" },
    ];
    const p = page("my-experience", { work });
    const filler = createWorkdayFiller({ press });
    filler.read(p.document);
    const dupes = [{ index: 2, words: "Security Analyst (SOC), Northwind Bank, from 2023" }, { index: 4, words: "SOC intern, Varna Telecom, from 2020" }];

    const filling = filler.fill(p.document, [entries(0, dupes)]);
    await vi.advanceTimersByTimeAsync(5000);
    await filling;
    // Reported, untouched: "Keep them" is simply not pressing Remove.
    expect(p.entries("workExperience")).toHaveLength(4);

    const removing = filler.removeEntries!(p.document, "work", [2, 4]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await removing).toBe(2);

    expect(filler.read(p.document).fields.filter((f) => f.id.endsWith("/companyName")).map((f) => f.value)).toEqual(["Northwind Bank", "Varna Telecom"]);
    expect(filler.read(p.document).fields.filter((f) => f.id.endsWith("/jobTitle")).map((f) => f.value)).toEqual(["Security Analyst", "SOC Intern"]);
    expect(p.entries("workExperience")).toEqual(["Work Experience 1", "Work Experience 2"]);
    expect(p.presses).toEqual([]);
  });

  it("fills skills one typeahead pick at a time, the exact match over a longer one", async () => {
    vi.useFakeTimers();
    const p = page("my-experience");
    const filler = createWorkdayFiller({ press });
    filler.read(p.document);

    const filling = filler.fill(p.document, [fill("skills--skills", "Wazuh\nSplunk\nIncident Response", "cv-version")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await filling).toEqual([{ fieldId: "skills--skills", outcome: "filled", source: "cv-version" }]);
    expect(p.picked("skills--skills")).toEqual(["Wazuh", "Splunk", "Incident Response"]);
    expect(p.field("skills--skills").value).toBe("");
  });

  it("undo takes off the entries it added", async () => {
    vi.useFakeTimers();
    const p = page("my-experience");
    const filler = createWorkdayFiller({ press });
    filler.read(p.document);
    const filling = filler.fill(p.document, [entries(2)]);
    await vi.advanceTimersByTimeAsync(5000);
    await filling;

    filler.undo(p.document);
    expect(p.entries("workExperience")).toEqual([]);
  });
});

describe("Application Questions, the voluntary steps and the review", () => {
  it("answers yes/no and option dropdowns, leaves what needs Kris marked, and fills the text question", async () => {
    vi.useFakeTimers();
    const p = page("questions");
    const filler = createWorkdayFiller({ press });
    filler.read(p.document);

    const filling = filler.fill(p.document, [
      fill("question-rightToWork", "Yes", "answer-bank"),
      fill("question-noticePeriod", "1 month", "package"),
      fill("question-relocate", "No", "answer-bank"),
      { fieldId: "question-detectionRule", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
      { fieldId: "question-salary", kind: "needs-you", reason: "Your answer bank says: ask each time", basis: null, suggestion: "3300" },
    ]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect((await filling).map((o) => o.outcome)).toEqual(["filled", "filled", "filled", "needs-you", "needs-you"]);
    expect([p.shown("question-rightToWork"), p.shown("question-noticePeriod"), p.shown("question-relocate")]).toEqual(["Yes", "1 month", "No"]);
    expect(p.field("question-salary").value).toBe("");
    expect(marks(p.document)).toEqual(["question-rightToWork:filled", "question-noticePeriod:filled", "question-relocate:filled", "question-detectionRule:needs-you", "question-salary:needs-you"]);
    expect(p.presses).toEqual([]);
  });

  it("skips voluntary disclosures and self-identification by rule, and never ticks the consent box", async () => {
    vi.useFakeTimers();
    for (const name of ["voluntary", "self-identify"]) {
      const p = page(name);
      const filler = createWorkdayFiller({ press });
      const r = filler.read(p.document);
      const byRule = r.fields.map((f): FieldAnswer => (f.consent ? { fieldId: f.id, kind: "skip", reason: "Consent boxes are yours to tick" } : { fieldId: f.id, kind: "skip", reason: "Your rule leaves voluntary questions blank", byRule: true }));

      const filling = filler.fill(p.document, byRule);
      await vi.advanceTimersByTimeAsync(5000);

      expect((await filling).every((o) => o.outcome === "skipped")).toBe(true);
      expect(filler.read(p.document).fields.every((f) => f.value === "")).toBe(true);
      expect(p.presses).toEqual([]);
    }
    const consent = createWorkdayFiller().read(page("voluntary").document).fields.find((f) => f.id === "termsAndConditions--acceptTermsAndAgreements")!;
    expect(consent).toMatchObject({ kind: "checkbox", consent: true });
  });

  it("on the review step, rings Submit and presses nothing", async () => {
    const p = page("review");
    const filler = createWorkdayFiller({ press });
    expect(filler.read(p.document).fields).toEqual([]);

    expect(await filler.fill(p.document, [])).toEqual([]);

    const ring = p.document.querySelector<HTMLElement>("[data-apply-kit-mark=submit]")!;
    expect(ring.style.outline).toContain("dashed");
    expect(ring.style.pointerEvents).toBe("none");
    expect(p.presses).toEqual([]);
  });
});

describe("what filling Workday never does", () => {
  const all = ["start", "my-information", "my-experience", "questions", "voluntary", "self-identify", "review", "confirmation"];

  it("never presses Save and Continue, Next, Back, Submit or the start screen's choices, even when told to fill every field", async () => {
    vi.useFakeTimers();
    for (const name of all) {
      const p = page(name, { work: name === "my-experience" ? [{ title: "Security Analyst", company: "Northwind Bank" }] : [] });
      const filler = createWorkdayFiller({ press });
      const r = filler.read(p.document);
      const filling = filler.fill(p.document, r.fields.map((f): FieldAnswer => f.kind === "repeating"
        ? { fieldId: f.id, kind: "entries", section: f.entry!.section, add: 1, duplicates: [{ index: 1, words: "" }], source: "cv-version", basis: "" }
        : fill(f.id, f.kind === "checkbox" ? "checked" : f.options[0] ?? "Yes")));
      await vi.advanceTimersByTimeAsync(30_000);
      await filling;
      const removing = filler.removeEntries!(p.document, "work", [1]);
      await vi.advanceTimersByTimeAsync(5000);
      await removing;
      filler.undo(p.document);

      expect(p.presses, name).toEqual([]);
    }
    const consent = page("voluntary");
    const f = createWorkdayFiller({ press });
    await f.fill(consent.document, [fill("termsAndConditions--acceptTermsAndAgreements", "checked")]);
    expect(consent.field("termsAndConditions--acceptTermsAndAgreements").checked).toBe(false);
  });

  it("refuses to press every navigation control and link on the fixtures", () => {
    for (const name of all) {
      const doc = page(name).document;
      const nav = Array.from(doc.querySelectorAll("[data-automation-id=pageFooterNextButton], [data-automation-id=pageFooterBackButton], a, [data-automation-id=closeButton], [data-automation-id=select-files]"));
      for (const el of nav) expect(widgetRefusal(el), `${name}: ${el.outerHTML.slice(0, 80)}`).not.toBeNull();
    }
    const doc = page("my-experience").document;
    expect(widgetRefusal(doc.querySelector("[data-automation-id=add-button]")!)).toBeNull();
  });
});
