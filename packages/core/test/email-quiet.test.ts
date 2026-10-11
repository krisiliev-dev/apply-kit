import { describe, expect, it } from "vitest";
import { alertEmail, createTestEngine, fakeClock, fakeMailbox } from "./harness.ts";

const days = 24 * 60 * 60_000;

/** A Google Careers alert (synthetic sample) arriving at the given time. */
const googleAlert = (receivedAt: Date) => alertEmail("email-google.html", {
  id: `<alert-${receivedAt.getTime()}@google.example>`, receivedAt: receivedAt.toISOString(),
  from: "Google Careers <careers-noreply@google.com>", subject: "New jobs that match your alert: security",
});

/**
 * A Google Careers alert source that has sent an email every 2 days from 20 Sep to 4 Oct at 09:00,
 * checked every 6 hours from 20 Sep 07:00. (The service checks through the scheduler; days of
 * one-minute scheduler ticks are too slow for a unit test, so checks run here at the engine seam.)
 */
async function everyTwoDays() {
  const clock = fakeClock("2026-09-20T07:00:00Z");
  const mailbox = fakeMailbox(clock);
  for (let t = Date.parse("2026-09-20T09:00:00Z"); t <= Date.parse("2026-10-04T09:00:00Z"); t += 2 * days) {
    mailbox.deliver(googleAlert(new Date(t)));
  }
  const { engine } = createTestEngine({ clock, mailReader: mailbox });
  await engine.addSource({ kind: "email", config: "google" });
  /** Checks every 6 hours until the given time, then once more at it. */
  const runUntil = async (iso: string) => {
    const end = Date.parse(iso);
    while (clock.now().getTime() + 6 * 60 * 60_000 < end) {
      await engine.checkAll();
      clock.sleep(6 * 60 * 60_000);
    }
    clock.set(iso);
    await engine.checkAll();
  };
  return { engine, clock, mailbox, runUntil };
}

describe("email alerts: quiet longer than usual", () => {
  it("learns the usual gap between an alert's emails", async () => {
    const { engine, runUntil } = await everyTwoDays();
    await runUntil("2026-10-05T10:00:00Z");

    const [google] = (await engine.sourceHealth()).sources;

    expect(google).toMatchObject({
      status: "working",
      alerts: { lastEmailAt: "2026-10-04T09:00:00.000Z", usualGapHours: 48, warnAfterHours: 144, quietSince: null },
    });
  });

  it("isn't quiet while the silence is within 3× the usual gap", async () => {
    const { engine, runUntil } = await everyTwoDays();
    // 5 days 23 hours after the last email: just under 3 × 2 days.
    await runUntil("2026-10-10T08:00:00Z");

    const health = await engine.sourceHealth();

    expect(health.sources[0]!.status).toBe("working");
    expect(health.summary.quiet).toEqual([]);
  });

  it("flags 'quiet longer than usual' after more than 3× the usual gap, and counts it in the health summary", async () => {
    const { engine, runUntil } = await everyTwoDays();
    // 8 days without an email; it usually sends one every 2 days.
    await runUntil("2026-10-12T09:00:00Z");

    const health = await engine.sourceHealth();

    expect(health.sources[0]).toMatchObject({
      status: "quiet",
      alerts: { lastEmailAt: "2026-10-04T09:00:00.000Z", usualGapHours: 48, warnAfterHours: 144, quietSince: "2026-10-10T09:00:00.000Z" },
    });
    expect(health.summary.quiet).toEqual([
      { sourceId: "email:google", name: "Google Careers alerts", lastEmailAt: "2026-10-04T09:00:00.000Z", usualGapHours: 48, silentHours: 192 },
    ]);
  });

  it("is no longer quiet once an email arrives", async () => {
    const { engine, mailbox, runUntil } = await everyTwoDays();
    await runUntil("2026-10-12T09:00:00Z");
    mailbox.deliver(googleAlert(new Date("2026-10-12T11:00:00Z")));
    await runUntil("2026-10-12T12:00:00Z");

    const health = await engine.sourceHealth();

    expect(health.sources[0]).toMatchObject({ status: "working", alerts: { lastEmailAt: "2026-10-12T11:00:00.000Z", quietSince: null } });
    expect(health.summary.quiet).toEqual([]);
  });

  it("doesn't judge an alert before it has a rhythm (fewer than 4 emails)", async () => {
    const clock = fakeClock("2026-10-01T07:00:00Z");
    const mailbox = fakeMailbox(clock);
    mailbox.deliver(googleAlert(new Date("2026-10-01T09:00:00Z")));
    mailbox.deliver(googleAlert(new Date("2026-10-02T09:00:00Z")));
    const { engine } = createTestEngine({ clock, mailReader: mailbox });
    await engine.addSource({ kind: "email", config: "google" });
    clock.set("2026-10-02T10:00:00Z");
    await engine.checkAll();
    clock.set("2026-10-12T10:00:00Z");
    await engine.checkAll();

    const [google] = (await engine.sourceHealth()).sources;

    expect(google).toMatchObject({ status: "working", alerts: { lastEmailAt: "2026-10-02T09:00:00.000Z", usualGapHours: null, quietSince: null } });
  });
});
