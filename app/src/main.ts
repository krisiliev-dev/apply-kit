import { serve } from "@hono/node-server";
import { createEngine, createScheduler } from "@apply-kit/core";
import { loadEnv, readConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createServer } from "./server.ts";

loadEnv();
const config = readConfig();
const db = openDatabase(config.dbPath);

const clock = { now: () => new Date() };
const engine = createEngine({
  db,
  clock,
  fetch: globalThis.fetch,
  // Real extractor (OpenRouter) and IMAP mail reader arrive with their tickets.
  extractor: { extract: async () => { throw new Error("Extractor not configured yet"); } },
  mailReader: { fetchSince: async () => [] },
  // Sources read their keys (JOOBLE_API_KEY, REED_API_KEY) by name; values are never logged.
  settings: { get: (name) => process.env[name] },
});

// Sources from config are added on every start; adding one that exists changes nothing.
for (const source of config.sources) await engine.addSource(source);

// Checks due Sources inside the window; after the Mac wakes, the next tick (within a minute)
// catches up with one check if any were missed.
const scheduler = createScheduler({
  engine,
  clock,
  timers: { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as NodeJS.Timeout) },
  schedule: config.schedule,
});

const app = createServer({ engine, scheduler, uiDir: config.uiDir });

// localhost only: the extension and UI talk to this, nothing else should.
const server = serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  const { everyMinutes, window } = config.schedule;
  console.log(`apply-kit service on http://localhost:${info.port} · db ${config.dbPath}`);
  console.log(`checking sources every ${everyMinutes} min, ${window.start}-${window.end}`);
  scheduler.start();
});

const shutdown = async () => {
  scheduler.stop();
  server.close();
  await scheduler.settled();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
