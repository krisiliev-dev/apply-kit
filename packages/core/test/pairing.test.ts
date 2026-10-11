import { describe, expect, it } from "vitest";
import { createPairing } from "../src/index.ts";
import { fakeClock, memoryDb } from "./harness.ts";

const minute = 60_000;

function setup() {
  const clock = fakeClock();
  const db = memoryDb();
  return { pairing: createPairing({ db, clock }), clock, db };
}

describe("pairing the Chrome extension with the service", () => {
  it("trades the code shown in the app for a token the service then accepts", async () => {
    const { pairing } = setup();
    expect(pairing.verify("anything")).toBe(false);

    const { code, expiresAt } = pairing.startPairing();
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt).toBe("2026-10-12T07:40:00.000Z");

    const paired = pairing.pair(code, "Chrome on this Mac");
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    expect(pairing.verify(paired.token)).toBe(true);
    expect(pairing.verify(`${paired.token}x`)).toBe(false);
    expect(pairing.devices()).toEqual([{ id: paired.deviceId, name: "Chrome on this Mac", pairedAt: "2026-10-12T07:30:00.000Z", lastUsedAt: "2026-10-12T07:30:00.000Z" }]);
  });

  it("uses a code once, and only for 10 minutes", async () => {
    const { pairing, clock } = setup();
    const { code } = pairing.startPairing();
    expect(pairing.pair(code, "Chrome").ok).toBe(true);
    expect(pairing.pair(code, "Another")).toEqual({ ok: false, problem: "no-code" });

    const late = pairing.startPairing();
    await clock.advance(11 * minute);
    expect(pairing.pair(late.code, "Chrome")).toEqual({ ok: false, problem: "expired" });
  });

  it("throws a code away after 5 wrong tries, so it can't be guessed", async () => {
    const { pairing } = setup();
    const { code } = pairing.startPairing();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(pairing.pair(wrong, "Chrome")).toEqual({ ok: false, problem: "wrong-code" });

    expect(pairing.pair(code, "Chrome")).toEqual({ ok: false, problem: "no-code" });
  });

  it("forgets an unpaired extension: its token stops working", async () => {
    const { pairing } = setup();
    const paired = pairing.pair(pairing.startPairing().code, "Chrome");
    if (!paired.ok) throw new Error("pairing failed");

    pairing.unpair(paired.deviceId);

    expect(pairing.verify(paired.token)).toBe(false);
    expect(pairing.devices()).toEqual([]);
  });

  it("keeps pairings across restarts, without keeping the token itself", async () => {
    const { pairing, db, clock } = setup();
    const paired = pairing.pair(pairing.startPairing().code, "Chrome");
    if (!paired.ok) throw new Error("pairing failed");

    const restarted = createPairing({ db, clock });

    expect(restarted.verify(paired.token)).toBe(true);
    const stored = JSON.stringify(db.prepare("SELECT * FROM extension_device").all());
    expect(stored).not.toContain(paired.token);
  });
});
