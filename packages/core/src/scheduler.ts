// The scheduler: decides when the discovery engine checks its Sources. It runs inside the
// long-lived service. Time and timers are injected, so tests drive it with a fake clock.
import type { DiscoveryEngine } from "./engine.ts";
import type { Clock, Timers } from "./ports.ts";

export interface Schedule {
  /** Minutes between checks while inside the window. */
  everyMinutes: number;
  /** Local wall-clock times ("HH:MM"); checks start at or after `start` and before `end`. */
  window: { start: string; end: string };
}

export const defaultSchedule: Schedule = { everyMinutes: 30, window: { start: "07:00", end: "23:00" } };

export interface SchedulerOptions {
  engine: DiscoveryEngine;
  clock: Clock;
  timers: Timers;
  schedule?: Schedule;
  /** IANA time zone the window is read in. Defaults to the system's. */
  timeZone?: string;
}

export interface Scheduler {
  /** Starts ticking and runs a check straight away if one is due. */
  start(): void;
  stop(): void;
}

/** How often the scheduler looks at the clock. A check is never more than this late. */
const tickMs = 60_000;

export function createScheduler(options: SchedulerOptions): Scheduler {
  const { engine, clock, timers } = options;
  const schedule = options.schedule ?? defaultSchedule;
  const start = toMinutes(schedule.window.start);
  const end = toMinutes(schedule.window.end);
  const minuteOfDay = localMinuteOfDay(options.timeZone);
  let handle: unknown = null;
  let running: Promise<unknown> | null = null;
  let lastStartedAt: number | null = null;

  function due(now: Date): boolean {
    const m = minuteOfDay(now);
    if (m < start || m >= end) return false;
    return lastStartedAt === null || now.getTime() - lastStartedAt >= schedule.everyMinutes * 60_000;
  }

  function tick() {
    const now = clock.now();
    if (running || !due(now)) return;
    lastStartedAt = now.getTime();
    running = engine.checkAll().finally(() => { running = null; });
  }

  return {
    start() {
      if (handle !== null) return;
      handle = timers.setInterval(tick, tickMs);
      tick();
    },
    stop() {
      if (handle === null) return;
      timers.clearInterval(handle);
      handle = null;
    },
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

function localMinuteOfDay(timeZone: string | undefined): (d: Date) => number {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (d) => {
    const parts = fmt.formatToParts(d);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return get("hour") * 60 + get("minute");
  };
}
