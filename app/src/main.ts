import { serve } from "@hono/node-server";
import { createEngine, createPairing, createScheduler } from "@apply-kit/core";
import { loadEnv, readConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createImapMailReader, readMailSettings } from "./mail.ts";
import { createServer } from "./server.ts";
import { createOpenRouterExtractor } from "./extraction/openrouter.ts";
import type { Extractor } from "@apply-kit/core";

loadEnv();
const config = readConfig();
const db = openDatabase(config.dbPath);

const extractor: Extractor = config.ai.openRouterApiKey
  ? createOpenRouterExtractor({ apiKey: config.ai.openRouterApiKey, model: config.ai.model, providers: config.ai.providers })
  : {
      estimateCostUsd: () => 0,
      extract: async () => { throw new Error("The OpenRouter key isn't set: add OPENROUTER_API_KEY to .env and restart"); },
    };

const clock = { now: () => new Date() };
const engine = createEngine({
  db,
  clock,
  fetch: globalThis.fetch,
  extractor,
  aiMonthlyCapUsd: config.ai.monthlyCapUsd,
  // The Gmail job mailbox, read-only. Only read when an email-alert Source exists, during checks
  // the scheduler runs; missing settings show on Sources as "not configured" with how to fix it.
  mailReader: createImapMailReader(readMailSettings(process.env)),
  // Sources read their keys (JOOBLE_API_KEY, REED_API_KEY) by name; values are never logged.
  settings: { get: (name) => process.env[name] },
});

// Sources from config seed the watchlist on each start, but only ones never added before: a Source
// paused or removed on the Sources screen stays paused or removed (add it again there to bring it back).
for (const source of config.sources) await engine.addSource(source, { onlyIfNew: true });

// Reads unread postings in the background, within the monthly budget: once at start (postings
// left unread when the service stopped) and after every check. Rows show "Reading" meanwhile.
const readInBackground = () => {
  engine.readPending().catch((err: unknown) => console.error("Reading postings failed:", err));
};
readInBackground();

// Checks due Sources inside the window; after the Mac wakes, the next tick (within a minute)
// catches up with one check if any were missed. Each finished check is followed by a read.
const scheduler = createScheduler({
  engine: { ...engine, checkAll: (options) => engine.checkAll(options).finally(readInBackground) },
  clock,
  timers: { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as NodeJS.Timeout) },
  schedule: config.schedule,
});

// The Chrome extension pairs once with a code shown in the app; only paired extensions are answered.
const pairing = createPairing({ db, clock });

const app = createServer({ engine, scheduler, pairing, uiDir: config.uiDir });

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
