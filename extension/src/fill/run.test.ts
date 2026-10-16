// One "Fill this page" from the panel's side: read the page, ask apply-kit for the answers, fill them,
// record the page. Here the app stops answering between the answers and the record: what's filled
// stays filled, the panel can say how many, and Undo this page still restores them (the previous
// values live in the page). Synthetic Greenhouse page, made-up person (Mira Petrova).
import { describe, expect, it, vi } from "vitest";
import type { FieldAnswer, PageReading } from "@apply-kit/core";
import { stoppedMidFill } from "../fill-report.ts";
import { createClient, type Store } from "../service.ts";
import { openFixture } from "./fixtures/load.ts";
import { openWorkday } from "./fixtures/workday.ts";
import { createGreenhouseFiller } from "./greenhouse.ts";
import { createWorkdayFiller } from "./workday.ts";
import { runFill } from "./run.ts";

const store: Store = { get: async () => ({ token: "t0k3n" }), set: async () => {}, remove: async () => {} };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const answers: FieldAnswer[] = [
  { fieldId: "first_name", kind: "fill", value: "Mira", source: "profile", basis: null },
  { fieldId: "last_name", kind: "fill", value: "Petrova", source: "profile", basis: null },
  { fieldId: "job_application_answers_attributes_0_text_value", kind: "needs-you", reason: "Your profile has no LinkedIn link", basis: null },
];

/** The app answers the page's fields, then goes away before the page is recorded. */
function appStopsAfterAnswering() {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === "/api/ext/fill/answer") return json(answers);
    throw new TypeError("Failed to fetch");
  };
  return { client: createClient({ fetch, store }), calls };
}

describe("when apply-kit stops answering mid-fill", () => {
  it("keeps what's filled, says how many fields, and Undo this page still restores them", async () => {
    const page = openFixture("greenhouse-classic.html", "https://boards.greenhouse.io/vireohealth/jobs/4471029");
    const filler = createGreenhouseFiller({ settleMs: 0 });
    const { client, calls } = appStopsAfterAnswering();

    const run = await runFill({
      client: client.fill, sessionId: "s1", stopRequested: () => false,
      page: { read: async () => filler.read(page.document), fill: (a, files) => filler.fill(page.document, a, files) },
    });

    expect(calls).toEqual(["/api/ext/fill/answer", "/api/ext/fill/record"]);
    expect(run).toMatchObject({ state: "stopped-mid-fill", problem: { ok: false, state: "not-running" } });
    if (run.state !== "stopped-mid-fill") throw new Error(run.state);
    expect(stoppedMidFill(run.outcomes)).toBe("apply-kit stopped answering after filling 2 fields on this page. They stay filled, and Undo this page still puts them back.");
    expect([page.field("first_name").value, page.field("last_name").value]).toEqual(["Mira", "Petrova"]);

    expect(filler.undo(page.document)).toBe(2);
    expect([page.field("first_name").value, page.field("last_name").value]).toEqual(["", ""]);
    expect(page.presses).toEqual([]);
  });

  it("touches nothing when the app stops before answering", async () => {
    const page = openFixture("greenhouse-classic.html", "https://boards.greenhouse.io/vireohealth/jobs/4471029");
    const filler = createGreenhouseFiller({ settleMs: 0 });
    const client = createClient({ fetch: async () => { throw new TypeError("Failed to fetch"); }, store });

    const run = await runFill({
      client: client.fill, sessionId: "s1", stopRequested: () => false,
      page: { read: async () => filler.read(page.document), fill: (a, files) => filler.fill(page.document, a, files) },
    });

    expect(run).toMatchObject({ state: "no-answer", problem: { ok: false, state: "not-running" } });
    expect(page.field("first_name").value).toBe("");
  });
});

describe("a Workday page that changes as it's filled", () => {
  /** apply-kit's answers for each reading: as many work entries as the CV's two roles, then their titles. */
  function app() {
    const readings: PageReading[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/ext/fill/answer") {
        const reading = (JSON.parse(String(init!.body)) as { reading: PageReading }).reading;
        readings.push(reading);
        return json(reading.fields.map((f): FieldAnswer => f.kind === "repeating"
          ? { fieldId: f.id, kind: "entries", section: f.entry!.section, add: f.entry!.section === "work" ? Math.max(0, 2 - Number(f.value)) : 0, duplicates: [], source: "cv-version", basis: "2 roles on the CV in your package" }
          : f.id.endsWith("/jobTitle") ? { fieldId: f.id, kind: "fill", value: f.id.startsWith("workExperience-1") ? "Security Analyst" : "SOC Intern", source: "cv-version", basis: null }
          : { fieldId: f.id, kind: "skip", reason: "Not in this test" }));
      }
      if (path === "/api/ext/fill/record") return json({ filledAt: "2026-10-16T11:02:00.000Z" });
      throw new TypeError("Failed to fetch");
    };
    return { client: createClient({ fetch, store }), readings };
  }

  it("reads the page again after Workday adds entries, and fills them in the same click", async () => {
    vi.useFakeTimers();
    const page = openWorkday("workday-my-experience.html");
    const filler = createWorkdayFiller({ press: (el) => (el as HTMLElement).click() });
    const { client, readings } = app();

    const running = runFill({
      client: client.fill, sessionId: "s1", stopRequested: () => false,
      page: { read: async () => filler.read(page.document), fill: (a, files) => filler.fill(page.document, a, files) },
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const run = await running;
    vi.useRealTimers();

    expect(readings).toHaveLength(2);
    expect(run.state).toBe("filled");
    expect(page.entries("workExperience")).toEqual(["Work Experience 1", "Work Experience 2"]);
    expect(filler.read(page.document).fields.filter((f) => f.id.endsWith("/jobTitle")).map((f) => f.value)).toEqual(["Security Analyst", "SOC Intern"]);
    if (run.state === "filled") expect(run.outcomes.filter((o) => o.fieldId.endsWith("/jobTitle")).map((o) => o.outcome)).toEqual(["filled", "filled"]);
    expect(page.presses).toEqual([]);
  });

  it("stops on Workday's start screen, filling nothing", async () => {
    const page = openWorkday("workday-start.html");
    const { client, readings } = app();
    const run = await runFill({ client: client.fill, sessionId: "s1", stopRequested: () => false, page: { read: async () => createWorkdayFiller().read(page.document), fill: async () => [] } });
    expect(run.state).toBe("start");
    expect(readings).toEqual([]);
  });
});
