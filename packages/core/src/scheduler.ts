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

/**
 * Reads schedule settings as text (the service passes APPLY_KIT_CHECK_EVERY_MINUTES and
 * APPLY_KIT_CHECK_WINDOW). Blank or missing settings fall back to the defaults.
 * `every` is whole minutes; `window` is "HH:MM-HH:MM" on the same day.
 */
export function parseSchedule(settings: { every?: string; window?: string }): Schedule {
  const every = settings.every?.trim();
  const window = settings.window?.trim();
  let everyMinutes = defaultSchedule.everyMinutes;
  if (every) {
    everyMinutes = Number(every);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 1) {
      throw new Error(`Check interval must be a whole number of minutes (1 or more), got "${every}"`);
    }
  }
  if (!window) return { everyMinutes, window: { ...defaultSchedule.window } };
  const m = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/.exec(window);
  const valid = (h: string, min: string) => Number(h) <= 24 && Number(min) < 60;
  if (!m || !valid(m[1]!, m[2]!) || !valid(m[3]!, m[4]!)) {
    throw new Error(`Check window must look like "07:00-23:00", got "${window}"`);
  }
  const pad = (h: string, min: string) => `${h.padStart(2, "0")}:${min}`;
  const result = { start: pad(m[1]!, m[2]!), end: pad(m[3]!, m[4]!) };
  if (toMinutes(result.start) >= toMinutes(result.end)) {
    throw new Error(`Check window must start before it ends on the same day, got "${window}"`);
  }
  return { everyMinutes, window: result };
}

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
