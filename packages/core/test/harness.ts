// Test harness for the discovery engine: fake clock, in-memory database, fixture loader,
// and fakes for every injected dependency. Tests drive the engine only through its public interface.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createEngine, type EngineDeps, type Clock, type Timers, type MailReader } from "../src/index.ts";

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** Reads a recorded response, alert email or captured page from test/fixtures. */
export function loadFixture(name: string): string {
  return readFileSync(fixturesDir + name, "utf8");
}

/**
 * A clock whose time only moves when the test says so, with timers that follow it.
 * `advance` moves time forward, firing every interval when it falls due and letting the work it
 * starts settle before moving on. `sleep` is the laptop lid closing: time passes, nothing fires,
 * and timers that fell due fire once on the next `advance` (as macOS does on wake).
 */
export interface FakeClock extends Clock, Timers {
  advance(ms: number): Promise<void>;
  sleep(ms: number): void;
  set(iso: string): void;
}

export function fakeClock(startIso = "2026-10-12T07:30:00Z"): FakeClock {
  let t = new Date(startIso).getTime();
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; every: number; due: number }>();
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  return {
    now: () => new Date(t),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        const [, timer] = next;
        t = Math.max(t, timer.due);
        timer.due = t + timer.every;
        timer.fn();
        await settle();
      }
      t = end;
      await settle();
    },
    sleep: (ms) => { t += ms; },
    set: (iso) => { t = new Date(iso).getTime(); },
    setInterval(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, every: ms, due: t + ms });
      return id;
    },
    clearInterval(id) { timers.delete(id as number); },
  };
}

export function memoryDb(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

/** A fetch that answers only from the given URL → fixture map and fails loudly on anything else. */
export function fixtureFetch(routes: Record<string, string> = {}): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const fixture = routes[url];
    if (!fixture) throw new Error(`fixtureFetch: no fixture for ${url}`);
    return new Response(loadFixture(fixture), { status: 200 });
  };
}

export type AlertEmail = Awaited<ReturnType<MailReader["fetchSince"]>>[number];

/**
 * A job mailbox held in memory. `deliver` puts an email in it; `fail` makes every read throw
 * (an expired app password, say) until `recover`. Reads return the emails received since the asked time;
 * with a clock, emails dated in its future haven't arrived yet, so they can be delivered up front.
 */
export interface FakeMailbox extends MailReader {
  deliver(email: AlertEmail): void;
  fail(err: Error): void;
  recover(): void;
  reads: Date[];
}

export function fakeMailbox(clock?: Clock): FakeMailbox {
  const emails: AlertEmail[] = [];
  let failure: Error | null = null;
  const reads: Date[] = [];
  return {
    reads,
    deliver: (email) => { emails.push(email); },
    fail: (err) => { failure = err; },
    recover: () => { failure = null; },
    async fetchSince(since) {
      reads.push(since);
      if (failure) throw failure;
      const now = clock?.now().getTime() ?? Infinity;
      return emails.filter((e) => e.receivedAt.getTime() >= since.getTime() && e.receivedAt.getTime() <= now);
    },
  };
}

/** An alert email whose HTML body is a fixture in test/fixtures (synthetic, no personal data). */
export function alertEmail(fixture: string, fields: { id: string; from: string; subject: string; receivedAt: string }): AlertEmail {
  return { ...fields, receivedAt: new Date(fields.receivedAt), html: loadFixture(fixture), text: "" };
}

export function createTestEngine(overrides: Partial<EngineDeps> = {}) {
  const clock = fakeClock();
  const deps: EngineDeps = {
    db: memoryDb(),
    clock,
    fetch: fixtureFetch(),
    extractor: { extract: async () => { throw new Error("fake extractor: no canned facts set"); } },
    mailReader: { fetchSince: async () => [] },
    ...overrides,
  };
  return { engine: createEngine(deps), clock, deps };
}
