// Apply on a form apply-kit doesn't know (#47) through the fill engine's public interface: a company's
// own careers site, often in Bulgarian. The page has no portal job reference, so the package is the
// one whose target posting is on this site, or the one Kris picks from her approved, unsubmitted
// packages. Made-up people and companies (Mira Petrova, Ostrava Bank); in-memory database, fake clock.
import { describe, expect, it } from "vitest";
import { createFillEngine, createTracker, type FillPage, type PackageJob, type PageReading, type ReadField } from "../src/index.ts";
import { fixtureFetch, memoryDb } from "./harness.ts";
import { approved, kestrelJob, mira, started } from "./package-fixtures.ts";

const questions = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs/4410?questions=true";

function setup() {
  const db = memoryDb();
  const t = mira({ db, fetch: fixtureFetch({ [questions]: "greenhouse-kestrel-4410-questions.json" }) });
  const tracker = createTracker({ db, clock: t.clock, discovery: t.discovery });
  const fill = createFillEngine({ db, clock: t.clock, prepare: t.preparation, track: tracker });
  return { ...t, fill, tracker };
}

/** A made-up Bulgarian bank's job, posted on its own careers site (no portal), with the package in Bulgarian. */
function ostravaJob(overrides: Partial<PackageJob> = {}): PackageJob {
  return kestrelJob({
    id: "job-ostrava",
    title: "IT Security Specialist",
    company: "Ostrava Bank",
    packageLanguage: "bg",
    screening: { salary: null },
    postings: [{
      id: "posting-ostrava", site: "careers.ostravabank.example", url: "https://careers.ostravabank.example/bg/kandidatstvai/it-security-specialist",
      firstSeenAt: "2026-10-09T08:00:00Z", source: { name: "Ostrava Bank", kind: "company", label: "Ostrava Bank careers", category: "company" },
    }],
    target: { postingId: "posting-ostrava" },
    ...overrides,
  });
}

/** Approves a package for any job: every step, answering what the answers step waits for. */
async function approvedFor(t: ReturnType<typeof setup>, job: PackageJob) {
  const pkg = await started(t, job);
  for (const step of ["target", "cv", "letter"] as const) {
    const r = t.preparation.approveStep(pkg.id, step);
    if (!r.approved) throw new Error(r.reason);
  }
  for (const q of (await t.preparation.packageSettled(pkg.id))!.answers!.questions.filter((q) => q.needsYou)) {
    const r = t.preparation.setScreeningAnswer(pkg.id, q.id, q.options[0] ?? "3400");
    if (!r.changed) throw new Error(r.reason);
  }
  const a = t.preparation.approveStep(pkg.id, "answers");
  if (!a.approved) throw new Error(a.reason);
  const r = await t.preparation.approvePackage(pkg.id);
  if (!r.approved) throw new Error(r.reason);
  return r.package;
}

const unknownPage = (host = "careers.ostravabank.example"): FillPage => ({ portal: "unknown", host, jobRef: null });

describe("matching a form apply-kit doesn't know to a package", () => {
  it("matches the package whose target posting is on this site, and starts a session on Fill", async () => {
    const t = setup();
    await approved(t);
    const ostrava = await approvedFor(t, ostravaJob());

    const peek = await t.fill.matchPage(unknownPage());
    const r = await t.fill.startFill(unknownPage());

    expect(peek).toMatchObject({ kind: "matched", why: "target-host", session: null, package: { id: ostrava.id, language: "bg", job: { company: "Ostrava Bank" } } });
    expect(r).toMatchObject({ kind: "matched", why: "target-host", session: { packageId: ostrava.id, portal: "unknown", host: "careers.ostravabank.example", jobRef: null } });
  });

  it("asks which application this is when nothing targets the site: approved, unsubmitted packages, newest first", async () => {
    const t = setup();
    const kestrel = await approved(t);
    await t.clock.advance(60_000);
    const ostrava = await approvedFor(t, ostravaJob());
    await t.clock.advance(60_000);
    const submitted = await approvedFor(t, ostravaJob({ id: "job-ostrava-2", title: "SOC Analyst" }));
    expect(t.preparation.markPackageSubmitted(submitted.id, { via: "app", portalUrl: null })).toMatchObject({ marked: true });

    const r = await t.fill.startFill(unknownPage("jobs.vireohealth.example"));

    expect(r.kind).toBe("choose");
    if (r.kind !== "choose") throw new Error(r.kind);
    expect(r.candidates.map((c) => c.id)).toEqual([ostrava.id, kestrel.id]);
  });

  it("starts the session on the package Kris chose, and keeps it on the next page of the same site", async () => {
    const t = setup();
    const kestrel = await approved(t);

    const chosen = await t.fill.startFill(unknownPage("jobs.vireohealth.example"), { packageId: kestrel.id });
    if (chosen.kind !== "matched") throw new Error(chosen.kind);
    const next = await t.fill.startFill(unknownPage("jobs.vireohealth.example"), { sessionId: chosen.session!.id });

    expect(chosen).toMatchObject({ kind: "matched", why: "chosen", session: { packageId: kestrel.id, portal: "unknown", host: "jobs.vireohealth.example" } });
    expect(next).toMatchObject({ kind: "matched", continued: true, session: { id: chosen.session!.id } });
  });

  it("says there's no package when there's nothing approved to choose from", async () => {
    const t = setup();

    expect(await t.fill.startFill(unknownPage())).toEqual({ kind: "no-package", job: null });
  });
});

function field(id: string, label: string, more: Partial<ReadField> = {}): ReadField {
  return { id, label, kind: "text", required: false, value: "", options: [], maxLength: null, consent: false, password: false, hint: null, ...more };
}
const reading = (fields: ReadField[]): PageReading => ({ pageKind: "form", jobRef: null, stepLabel: null, stepCount: null, fields });

/** Ostrava Bank's own form as the generic filler reads it: Bulgarian labels, in the form's order. */
const ostravaForm = reading([
  field("full_name", "Име и фамилия", { required: true }),
  field("phone", "Телефон", { kind: "tel", required: true }),
  field("email", "E-mail", { kind: "email", required: true }),
  field("position", "Желана позиция"),
  field("cv", "Прикачи CV (PDF, до 5 MB)", { kind: "file", required: true }),
  field("letter", "Мотивационно писмо", { kind: "textarea" }),
  field("city", "Град"),
  field("source", "Откъде научихте за позицията?", { kind: "select", options: ["Сайт за работа", "Препоръка", "Друго"] }),
  field("salary", "Очаквано брутно месечно възнаграждение", { required: true }),
  field("gdpr", "Съгласен съм с обработката на личните ми данни", { kind: "checkbox", required: true, consent: true }),
]);

async function onOstravaForm() {
  const t = setup();
  const pkg = await approvedFor(t, ostravaJob());
  const r = await t.fill.startFill(unknownPage());
  if (r.kind !== "matched") throw new Error(r.kind);
  return { ...t, pkg, sessionId: r.session!.id };
}

describe("the copy list on a form apply-kit doesn't know", () => {
  it("lists each value under the form's own label with its meaning in English, in the form's order", async () => {
    const t = await onOstravaForm();
    const letter = t.pkg.approved!.letter!;

    const list = t.fill.copyList(t.sessionId, ostravaForm);

    expect(list.rows.map((r) => [r.fieldId, r.label, r.meaning, r.kind === "value" ? r.value : r.fileName])).toEqual([
      ["full_name", "Име и фамилия", "full name", "Mira Petrova"],
      ["phone", "Телефон", "phone", "+359 88 000 0175"],
      ["email", "E-mail", "email", "mira.petrova@example.com"],
      ["position", "Желана позиция", "the job you're applying for", "IT Security Specialist"],
      ["cv", "Прикачи CV (PDF, до 5 MB)", "CV, Bulgarian version", t.pkg.approved!.cv.file.fileName],
      ["letter", "Мотивационно писмо", `cover letter, Bulgarian, ${letter.text.length.toLocaleString("en-GB")} characters`, letter.text],
      ["city", "Град", "city", "Sofia"],
    ]);
    expect(list.rows.find((r) => r.fieldId === "cv")).toMatchObject({ kind: "file", which: "cv" });
  });

  it("leaves out the fields it can't map and counts them; consent boxes are Kris's and aren't counted", async () => {
    const t = await onOstravaForm();

    expect(t.fill.copyList(t.sessionId, ostravaForm).unmapped).toBe(2);
  });

  it("maps the same fields labelled in English", async () => {
    const t = await onOstravaForm();

    const list = t.fill.copyList(t.sessionId, reading([field("n", "Full name"), field("p", "Phone number"), field("e", "Email address"), field("j", "Position applied for"), field("q", "Notice period")]));

    expect(list.rows.map((r) => [r.meaning, r.kind === "value" ? r.value : r.fileName])).toEqual([
      ["full name", "Mira Petrova"], ["phone", "+359 88 000 0175"], ["email", "mira.petrova@example.com"], ["the job you're applying for", "IT Security Specialist"], ["Notice period", "1 месец"],
    ]);
    expect(list.unmapped).toBe(0);
  });
});
