import { serve } from "@hono/node-server";
import { createEngine, createPairing, createScheduler, createTracker } from "@apply-kit/core";
import { loadEnv, readConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createImapMailReader, readMailSettings } from "./mail.ts";
import { createServer } from "./server.ts";
import { createOpenRouterExtractor } from "./extraction/openrouter.ts";
import { createOpenRouterTrackAssistant } from "./extraction/track-assistant.ts";
import type { Extractor, Tracker } from "@apply-kit/core";

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
const mailSettings = readMailSettings(process.env);
// Track matches what each mailbox read stored (made below, beside the engine it reads Jobs through).
let tracker: Tracker | null = null;
const engine = createEngine({
  db,
  clock,
  fetch: globalThis.fetch,
  extractor,
  aiMonthlyCapUsd: config.ai.monthlyCapUsd,
  // The Gmail job mailbox, read-only, during checks the scheduler runs. With Track, every check reads
  // it once (alerts and application mail alike) and hands what it stored to email matching; missing
  // settings show on Applications and Sources as "not connected" with how to fix it.
  mailReader: createImapMailReader(mailSettings),
  onMailStored: (emails) => tracker?.processMail(emails).catch((err: unknown) => console.error("Matching emails failed:", err)),
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

// Track: Applications, beside the discovery engine on the same database, clock and AI budget.
// Emails are classified through the same OpenRouter setup; without a key, matching runs on rules alone.
tracker = createTracker({
  db, clock, discovery: engine,
  assistant: config.ai.openRouterApiKey
    ? createOpenRouterTrackAssistant({ apiKey: config.ai.openRouterApiKey, model: config.ai.model, providers: config.ai.providers })
    : undefined,
  aiMonthlyCapUsd: config.ai.monthlyCapUsd,
  // Mail from the job mailbox's own address, or from the addresses you send from, is never an
  // employer's; a copy of yours BCC'd there marks the follow-up it answers as sent.
  ownAddresses: [...(mailSettings ? [mailSettings.address] : []), ...config.myAddresses],
});

const app = createServer({ engine, tracker, scheduler, pairing, uiDir: config.uiDir, port: config.port });

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
