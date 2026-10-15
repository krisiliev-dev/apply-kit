import { describe, expect, it } from "vitest";
import { createTabSessions, type SessionStore } from "./sessions.ts";

/** browser.storage.session held in memory. */
function memoryStore() {
  const data: Record<string, unknown> = {};
  const store: SessionStore = {
    async get(keys) { return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])); },
    async set(items) { Object.assign(data, items); },
    async remove(keys) { for (const k of keys) delete data[k]; },
  };
  return { store, data };
}

describe("the tab's fill session in the browser", () => {
  it("keeps only tab → fill session id, nothing about the page, the package or Kris", async () => {
    const { store, data } = memoryStore();
    const sessions = createTabSessions(store);

    await sessions.set(12, "3f1c9a2e-0000-4000-8000-000000000001");
    await sessions.set(14, "3f1c9a2e-0000-4000-8000-000000000002");

    expect(data).toEqual({ "fill-session:12": "3f1c9a2e-0000-4000-8000-000000000001", "fill-session:14": "3f1c9a2e-0000-4000-8000-000000000002" });
    expect(await sessions.get(12)).toBe("3f1c9a2e-0000-4000-8000-000000000001");
    expect(await sessions.get(13)).toBeNull();
  });

  it("forgets a tab's session when it ends", async () => {
    const { store, data } = memoryStore();
    const sessions = createTabSessions(store);
    await sessions.set(12, "s-1");

    await sessions.clear(12);

    expect(data).toEqual({});
    expect(await sessions.get(12)).toBeNull();
  });
});
