// One "Fill this page" from the panel's side: read the page, ask apply-kit for the answers, fill them,
// record the page. Here the app stops answering between the answers and the record: what's filled
// stays filled, the panel can say how many, and Undo this page still restores them (the previous
// values live in the page). Synthetic Greenhouse page, made-up person (Mira Petrova).
import { describe, expect, it } from "vitest";
import type { FieldAnswer } from "@apply-kit/core";
import { stoppedMidFill } from "../fill-report.ts";
import { createClient, type Store } from "../service.ts";
import { openFixture } from "./fixtures/load.ts";
import { createGreenhouseFiller } from "./greenhouse.ts";
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
