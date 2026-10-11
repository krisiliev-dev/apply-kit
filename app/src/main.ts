import { serve } from "@hono/node-server";
import { createEngine } from "@apply-kit/core";
import { loadEnv, readConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
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

const engine = createEngine({
  db,
  clock: { now: () => new Date() },
  fetch: globalThis.fetch,
  extractor,
  aiMonthlyCapUsd: config.ai.monthlyCapUsd,
  // The IMAP mail reader arrives with its ticket.
  mailReader: { fetchSince: async () => [] },
});

// Sources from config are added on every start; adding one that exists changes nothing.
for (const source of config.sources) await engine.addSource(source);

const app = createServer({ engine, uiDir: config.uiDir });

// localhost only: the extension and UI talk to this, nothing else should.
const server = serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`apply-kit service on http://localhost:${info.port} · db ${config.dbPath}`);
});

const shutdown = () => { server.close(); db.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
