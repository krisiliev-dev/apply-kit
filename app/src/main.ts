import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { createAiBudget, createEngine, createPairing, createPreparationEngine, createScheduler, createTracker, trackPortsFrom } from "@apply-kit/core";
import { loadEnv, readConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createImapMailReader, readMailSettings } from "./mail.ts";
import { createServer } from "./server.ts";
import { createOpenRouterExtractor } from "./extraction/openrouter.ts";
import { createOpenRouterWriter } from "./writing/openrouter.ts";
import { createFileStore } from "./files.ts";
import { createChromiumRenderer } from "./documents/chromium.ts";
import { createPdfJsReader } from "./documents/pdf-text.ts";
import { createPackageFolder } from "./packages.ts";
import { createVisionRecognizer } from "./import/recognise.ts";
import { createOpenRouterTrackAssistant } from "./extraction/track-assistant.ts";
import type { Extractor, Tracker, Writer } from "@apply-kit/core";

loadEnv();
const config = readConfig();
const db = openDatabase(config.dbPath);

const noKey = () => new Error("The OpenRouter key isn't set: add OPENROUTER_API_KEY to .env and restart");
const extractor: Extractor = config.ai.openRouterApiKey
  ? createOpenRouterExtractor({ apiKey: config.ai.openRouterApiKey, model: config.ai.model, providers: config.ai.providers })
  : {
      estimateCostUsd: () => 0,
      extract: async () => { throw noKey(); },
    };

const writer: Writer = config.ai.openRouterApiKey
  ? createOpenRouterWriter({ apiKey: config.ai.openRouterApiKey, model: config.ai.model, providers: config.ai.providers })
  : { estimateCostUsd: () => 0, draftPieces: async () => { throw noKey(); }, learnVoice: async () => { throw noKey(); }, tailorCv: async () => { throw noKey(); }, coachTurn: async () => { throw noKey(); }, writeLetter: async () => { throw noKey(); }, draftAnswer: async () => { throw noKey(); } };

// PDFs: the fixed templates printed by headless Chromium (started on first use) and read back with
// pdf.js, both on this laptop (ADR 0003).
const renderer = createChromiumRenderer();

const clock = { now: () => new Date() };
// Named settings from .env, read by name; values are never logged.
const settings = { get: (name: string) => process.env[name] };
// One monthly cap (AI_MONTHLY_CAP_USD) over everything that calls the model: extraction and writing.
const budget = createAiBudget({ db, clock, capUsd: config.ai.monthlyCapUsd });
const mailSettings = readMailSettings(process.env);
// Track matches what each mailbox read stored (made below, beside the engine it reads Jobs through).
let tracker: Tracker | null = null;
const engine = createEngine({
  db,
  clock,
  fetch: globalThis.fetch,
  extractor,
  budget,
  // The Gmail job mailbox, read-only, during checks the scheduler runs. With Track, every check reads
  // it once (alerts and application mail alike) and hands what it stored to email matching; missing
  // settings show on Applications and Sources as "not connected" with how to fix it.
  mailReader: createImapMailReader(mailSettings),
  onMailStored: (emails) => tracker?.processMail(emails).catch((err: unknown) => console.error("Matching emails failed:", err)),
  // Sources read their keys (JOOBLE_API_KEY, REED_API_KEY) by name; values are never logged.
  settings,
});

// Prepare: shares the database, clock, settings and AI budget with Discover. Files Kris brings are
// kept as hash-named copies in files/ beside the database, generated PDFs in packages/ (ADR 0003).
const preparation = createPreparationEngine({
  db,
  clock,
  budget,
  writer,
  renderer,
  pdfReader: createPdfJsReader(),
  files: createFileStore(join(dirname(config.dbPath), "files")),
  packages: createPackageFolder(dirname(config.dbPath), config.packagesDir),
  settings,
  // Import reads the public GitHub API and a portfolio page; scans are read by text recognition on
  // this laptop (macOS Vision).
  fetch: globalThis.fetch,
  recognizer: createVisionRecognizer(),
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

// The voice learns from new samples and edits to drafts periodically (and once at start), within
// the monthly budget; adding samples on Profile › Voice starts it too.
const learnVoice = () => {
  preparation.learnVoice()
    .then((r) => { if (r.stopped === "failed") console.error(r.message); })
    .catch((err: unknown) => console.error("Learning the voice failed:", err));
};
learnVoice();
const voiceTimer = setInterval(learnVoice, 60 * 60 * 1000);

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
  // Prepare's master profile (evidence for drafts, stories for the prep sheet) and voice, through PrepareForTrack.
  ...trackPortsFrom(preparation),
});

const app = createServer({ engine, preparation, tracker, scheduler, pairing, uiDir: config.uiDir, port: config.port });

// localhost only: the extension and UI talk to this, nothing else should.
const server = serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  const { everyMinutes, window } = config.schedule;
  console.log(`apply-kit service on http://localhost:${info.port} · db ${config.dbPath}`);
  console.log(`checking sources every ${everyMinutes} min, ${window.start}-${window.end}`);
  const ai = preparation.budget();
  console.log(`AI budget ${ai.month}: $${ai.spentUsd} of $${ai.capUsd} spent (extraction and writing share it)`);
  scheduler.start();
});

const shutdown = async () => {
  scheduler.stop();
  clearInterval(voiceTimer);
  server.close();
  await renderer.close();
  await scheduler.settled();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
