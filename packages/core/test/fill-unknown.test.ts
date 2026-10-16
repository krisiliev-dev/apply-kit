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
