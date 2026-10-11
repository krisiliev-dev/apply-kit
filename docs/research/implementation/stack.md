# Stack notes for apply-kit (checked 2026-10-11)

> **Reality check (added after ticket #2 merged on `discover`, commit 060f386):** the skeleton already exists. It uses `packageManager: pnpm@10.33.0`, TypeScript ^5.9.3, `engines.node >=22.13`, hono ^4.13.13, @hono/node-server ^2.1.4, vite ^8.3.4, vitest ^5.0.3 (several of these are under 2 weeks old; fine to keep, but don't go newer casually). It uses **`node:sqlite` (`DatabaseSync`)** behind a port in `packages/core/src/ports.ts` (`app/src/db.ts`, `packages/core/test/harness.ts`). Given that, the cheapest path is to **keep node:sqlite** (no native build, works in tests, isolated by the port), and switch to better-sqlite3 only if its experimental status bites (warnings, API change on a Node upgrade, or missing features like online backup). §4 below is the trade-off. With pnpm 10 the build allowlist is `onlyBuiltDependencies: [...]` in `pnpm-workspace.yaml`. `allowBuilds` applies only after a move to pnpm ≥11.

Rule used for pins: the newest stable release published on or before 2026-09-27 (at least 2 weeks old). Dates come from `npm view <pkg> time`. Newer releases exist for most packages; bump them later on purpose, not by accident.

## Version pins

| Package | Pin | Released | Latest today | Notes |
|---|---|---|---|---|
| Node | **22.23.3** (LTS "Jod") | 2026-09-23 | 22.23.3 / 24.21.0 LTS | `"engines": {"node": ">=22.12 <23"}` + `.nvmrc`/`.node-version` = `22.23.3`. **This Mac currently has Node v20.20.2 and pnpm 10.33.0**, so Node 22 has to be installed by the user (nvm/fnm/Homebrew). Several pins below need Node ≥22. |
| pnpm | **12.7.0** | 2026-09-25 | 12.11.2 | Pin via `"packageManager": "pnpm@12.7.0"` in the root package.json (Corepack). |
| typescript | 7.0.2 | 2026-07-08 | 7.0.2 | TS 7 is the native (Go) compiler. If a tool breaks on it (some plugins still expect the JS API), drop to the last 5.9.x for that package only. |
| tsx | 4.23.15 | 2026-09-20 | same | Run the service in dev (`tsx watch app/src/main.ts`). |
| hono | **4.13.9** | 2026-09-24 | 4.13.13 | |
| @hono/node-server | **2.1.1** | 2026-08-14 | 2.1.4 | peer `hono ^4`, node ≥20. |
| vite | **8.3.1** | 2026-09-24 | 8.3.4 | node `^20.19 \|\| >=22.12`. |
| @vitejs/plugin-react | 6.1.1 | 2026-08-28 | 6.1.2 | |
| react / react-dom | 19.3.0 | 2026-09-09 | same | |
| better-sqlite3 | **13.0.3** | 2026-08-05 | same | engines node ≥22. Types: `@types/better-sqlite3` 9.6.0. |
| vitest | **5.0.2** | 2026-09-25 | 5.0.3 | node `^22.12 \|\| ^24`. Use `jsdom` only for extension DOM tests. |
| wxt | **0.21.4** | 2026-08-11 | same | node ≥22; peer vite ^6–8, typescript ≥5.4. |
| ai (Vercel AI SDK) | **7.0.116** | 2026-09-25 | 7.0.137 | node ≥22; peer zod `^3.25.76 \|\| ^4.1.8`. |
| @openrouter/ai-sdk-provider | **3.1.0** | 2026-09-19 | same | peer `ai ^7`. |
| zod | 4.6.5 | 2026-09-13 | same | |
| imapflow | **2.0.7** | 2026-09-25 | 2.4.0 | major 2 (the archive used 1.3.x). |
| mailparser | 3.9.28 | 2026-09-15 | 3.9.38 | |
| playwright | 1.63.0 | 2026-09-04 | 1.64.0 | PDF step, not Discover. |
| cheerio | (archive used ^1.2.0) | — | — | Re-check before adding; needed for dev.bg + alert-email HTML parsing. `fast-xml-parser` (archive ^5.7.1) for Personio XML / Teamtailor RSS. |

## 1. Node 22 + pnpm workspaces

`pnpm-workspace.yaml` (pnpm 11+ moved most settings here; `onlyBuiltDependencies` was **removed in v11** and replaced by `allowBuilds`):

```yaml
packages:
  - app
  - app/ui          # or keep ui inside app as its own package
  - extension
  - packages/*
allowBuilds:
  better-sqlite3: true   # native addon: prebuilt download / node-gyp fallback
  esbuild: true          # pulled in by vite/wxt/tsx
catalog:                 # optional: one place for shared versions
  zod: 4.6.5
  typescript: 7.0.2
  vitest: 5.0.2
```

- Without `allowBuilds`, pnpm's `strictDepBuilds` (default true) fails install with `ERR_PNPM_IGNORED_BUILDS`; `pnpm approve-builds` writes the entries for you. Docs: https://pnpm.io/settings/build
- Reference internal packages as `"@apply-kit/core": "workspace:*"`. Catalogs: https://pnpm.io/catalogs
- Use `"type": "module"` everywhere. For `packages/core` either ship TS source (`"exports": {".": "./src/index.ts"}`) and let tsx/vite/vitest compile it, or build with `tsc`. Shipping source is simplest for a private monorepo.
- Root scripts: `pnpm -r --parallel dev`, `pnpm -r test`, `pnpm --filter app dev`.

## 2. Hono on Node

```ts
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { streamSSE } from "hono/streaming";

const app = new Hono();
app.use("/api/ext/*", bearerAuth({ verifyToken: async (t, c) => checkPairToken(t) }));
app.get("/api/checks/stream", (c) => streamSSE(c, async (s) => { /* write per-source results */ }));
app.use("/*", serveStatic({ root: "./ui/dist" }));   // built UI in prod

serve({ fetch: app.fetch, port: 4317, hostname: "127.0.0.1" });  // bind loopback only
```

- `serve(options, listener)`; options include `port`, `hostname` (verified in 2.1.1 typings). **Always bind `127.0.0.1`**, never `0.0.0.0`.
- SSE (`hono/streaming` → `streamSSE`) fits "results stream as each source finishes".
- In dev, run Vite on its own port and proxy `/api` to the service (`server.proxy` in `vite.config.ts`). In prod the service serves `ui/dist`.
- Extension requests come from `chrome-extension://<id>`: allow that origin with `hono/cors` only on `/api/ext/*`, plus the pairing bearer token. No `*` CORS (old bug #6).
- Docs: https://hono.dev/docs/getting-started/nodejs , https://hono.dev/docs/helpers/streaming , https://hono.dev/docs/middleware/builtin/bearer-auth

## 3. Vite + React

`pnpm create vite ui --template react-ts`, then pin as above. Import `docs/design/tokens.css` (copy or `@import`) as the only styling base. Docs: https://vite.dev/guide/

## 4. SQLite: better-sqlite3 vs node:sqlite (written before I saw the skeleton; it already chose node:sqlite, see the top note)

| | better-sqlite3 13.0.3 | node:sqlite (Node 22) |
|---|---|---|
| Status | Stable, widely used | **Stability 1.1 "Active development"**; unflagged since 22.13 but still experimental |
| Transactions | `db.transaction(fn)` wrapper (nested savepoints, auto-rollback on throw) | Manual `BEGIN/COMMIT/ROLLBACK` via `exec` |
| Install | Native addon: needs `allowBuilds` (prebuilt binaries for Node 22 macOS arm64 normally download; otherwise Xcode CLT compiles) | Built-in, zero deps |
| In-memory tests | `new Database(":memory:")` | `new DatabaseSync(":memory:")` |

Choose better-sqlite3: stable API, a real transaction helper (the engine does multi-row merges and closes that must be atomic), and it's what most examples use. Revisit node:sqlite when the project moves to Node 24+ and it is marked stable. Keep all SQL behind a small `Db` port in `packages/core` so the engine tests can inject `:memory:`.

Setup on open:

```ts
import Database from "better-sqlite3";
const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
```

**Migrations (lightweight, no tool):** numbered files `app/migrations/0001_init.sql`, `0002_….sql`; on start read `PRAGMA user_version`, run each newer file inside `db.transaction`, then `PRAGMA user_version = N`. Forward-only, about 25 lines, and works the same on `:memory:` in tests. (ARCHITECTURE.md lists "migration tool" as open; this is the minimal answer. A query builder like Kysely can be added later without changing it.)

Backups: `db.backup(destPath)` (async online backup API) for the nightly copy.

Docs: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md , https://nodejs.org/docs/latest-v22.x/api/sqlite.html

## 5. Vitest

- One root `vitest.config.ts` with `test.projects: ["packages/*", "app", "extension"]`, or a config per package. Node environment by default; `environment: "jsdom"` only for extension DOM extraction tests.
- Fake clock: `vi.useFakeTimers(); vi.setSystemTime(...)`. Better: inject a `Clock` into the engine (the spec already says so) and avoid global fakes.
- Fixtures: load recorded responses from `packages/core/test/fixtures/<adapter>.json|xml` and inject a fake `fetch` that maps URL → fixture. No network in tests.
- Docs: https://vitest.dev/guide/ , https://vitest.dev/guide/projects

## 6. WXT (Chrome MV3)

- `pnpm dlx wxt@0.21.4 init extension` (pick React or vanilla). Entry points are files: `entrypoints/background.ts` (`export default defineBackground(() => {...})`), `entrypoints/capture.content.ts` (`defineContentScript({ matches, main })`), `entrypoints/popup/` (HTML+TSX). WXT builds MV3 for Chrome.
- Click-only capture (spec story 75, old grey-area bug): avoid a broad always-on content script. Prefer `permissions: ["activeTab", "scripting", "storage"]` and inject the extractor with `browser.scripting.executeScript` when the user clicks the action/pill. Then no host permission on LinkedIn etc. is needed at all.
- `host_permissions: ["http://127.0.0.1:4317/*", "http://localhost:4317/*"]` so the background worker can call the service.
- Store the pairing token in `browser.storage.local` (the old extension used `chrome.storage.sync`, which syncs it to the Google account; avoid that).
- Config: `wxt.config.ts` → `export default defineConfig({ manifest: { permissions, host_permissions } })`. `wxt` dev opens a Chrome with the extension loaded; `wxt build` → `.output/chrome-mv3` for "Load unpacked".
- Docs: https://wxt.dev/guide/essentials/config/manifest.html , https://wxt.dev/guide/essentials/entrypoints.html , https://developer.chrome.com/docs/extensions/reference/api/scripting

## 7. Vercel AI SDK 7 + OpenRouter

Verified against the published typings of `ai@7.0.116` and `@openrouter/ai-sdk-provider@3.1.0`:
- `generateObject` is **deprecated** in v7: "Use `generateText` with an `output` setting instead." Use `Output.object({ schema })`; the result is on `result.output`.
- The OpenRouter chat model settings accept `provider: { order, allow_fallbacks, require_parameters, data_collection, only, ignore, quantizations, sort, max_price, zdr }`, plus `structuredOutputs: { strict }`, `usage: { include: true }` and `extraBody`.

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

const extractor = openrouter("deepseek/<exact model id from openrouter.ai/models>", {
  provider: {
    // Non-China hosts only. Fill `only` with the slugs listed on the model's
    // OpenRouter page (copy button), e.g. ["deepinfra", "fireworks", "together"].
    only: ["<host-slug-1>", "<host-slug-2>"],
    ignore: ["deepseek"],          // belt and braces: never the first-party (China) API
    data_collection: "deny",       // only providers that don't store/train on prompts
    allow_fallbacks: false,        // don't wander outside `only`
    require_parameters: true,      // only hosts that support response_format json_schema
    zdr: true,                     // optional: zero-data-retention endpoints only
  },
  usage: { include: true },        // cost per call → budget ledger
});

const Facts = z.object({
  requirements: z.array(z.object({
    text: z.string(), kind: z.enum(["required", "preferred"]),
    sourceLine: z.string(), confidence: z.number().min(0).max(1),
  })),
  salary: z.object({ amount: z.number().nullable(), currency: z.string().nullable(),
    period: z.enum(["year", "month", "hour"]).nullable(), stated: z.boolean(),
    sourceLine: z.string().nullable() }),
  // …
});

const res = await generateText({
  model: extractor,
  output: Output.object({ schema: Facts, name: "posting_facts" }),
  prompt,
});
const facts = res.output;                                     // typed, schema-validated
const cost = res.providerMetadata?.openrouter?.usage?.cost;   // USD, for the monthly cap
```

- Provider slugs are lowercase; a base slug (`google-vertex`) matches every region of that provider; a full slug (`google-vertex/us-east5`, `deepinfra/turbo`) targets one endpoint. There is **no country field** in `provider`; region pinning is done by slug choice (or the `eu.openrouter.ai` endpoint on Business/Enterprise plans). So pinning to non-China hosts means an explicit `only` list plus `ignore: ["deepseek"]`.
- Get the exact model id and provider slugs from the model page or `GET https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints`. Don't guess them.
- Also set the OpenRouter key's own credit limit (ARCHITECTURE.md), and in the account's privacy settings turn off providers that train on data, as a second guard.
- Per-call override: `providerOptions: { openrouter: { provider: {...} } }` on `generateText`.
- The engine depends on an `Extractor` interface; tests use a fake. Only the adapter imports `ai`.
- Docs: https://openrouter.ai/docs/guides/routing/provider-selection , https://github.com/OpenRouterTeam/ai-sdk-provider , https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data

## 8. imapflow + mailparser (read-only)

```ts
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true,
  auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_APP_PASSWORD! }, logger: false });
await client.connect();
const lock = await client.getMailboxLock("INBOX", { readOnly: true });   // EXAMINE, not SELECT
try {
  const box = client.mailbox;                        // has uidValidity, uidNext
  // checkpoint: if box.uidValidity changed → reset lastUid to 0
  for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, envelope: true, source: true }, { uid: true })) {
    if (msg.uid <= lastUid) continue;                // "N:*" always returns at least the last message
    const mail = await simpleParser(msg.source!);
    // mail.from?.value[0].address, mail.subject, mail.date, mail.html || mail.textAsHtml, mail.messageId
  }
} finally { lock.release(); await client.logout(); }
```

- `readOnly: true` exists on both `MailboxLockOptions` and `MailboxOpenOptions` in imapflow 2.0.7 typings. It opens the mailbox with EXAMINE, so the server can't set `\Seen` or change anything. The archive used `getMailboxLock(mailbox)` **without** `readOnly` (`cv-maker/lib/discovery/email/imap.ts:51`); fix that.
- Checkpoint by `(uidValidity, lastUid)` stored in SQLite instead of rescanning 14 days. Key postings by canonical job URL, not `capturedAt`.
- Gmail: IMAP on, app password (needs 2FA). Gmail labels show up as IMAP folders; the job mailbox is dedicated, so `INBOX` (or `[Gmail]/All Mail`) works.
- Docs: https://imapflow.com/docs/api/imapflow-client , https://nodemailer.com/extras/mailparser/

## 9. launchd LaunchAgent (start at login)

`~/Library/LaunchAgents/dev.krisiliev.apply-kit.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.krisiliev.apply-kit</string>
  <key>ProgramArguments</key>
  <array>
    <string>/ABSOLUTE/PATH/TO/node22/bin/node</string> <!-- e.g. output of `which node` under Node 22; launchd has no shell PATH -->
    <string>/Users/kristiyaniliev/code/apply-kit/app/dist/main.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/kristiyaniliev/code/apply-kit</string>
  <key>EnvironmentVariables</key>
  <dict><key>NODE_ENV</key><string>production</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>  <!-- restart on crash, not on clean stop -->
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/Users/kristiyaniliev/Library/Logs/apply-kit/service.log</string>
  <key>StandardErrorPath</key><string>/Users/kristiyaniliev/Library/Logs/apply-kit/service.err.log</string>
</dict>
</plist>
```

- Load: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.krisiliev.apply-kit.plist`; restart: `launchctl kickstart -k gui/$(id -u)/dev.krisiliev.apply-kit`; unload: `launchctl bootout gui/$(id -u)/dev.krisiliev.apply-kit`; check: `launchctl print gui/$(id -u)/dev.krisiliev.apply-kit`. Validate with `plutil -lint`.
- The node path must be absolute (nvm/fnm paths change on upgrade; a stable symlink or Homebrew `node@22` path is easier). The log directory must exist first.
- `.env` is read by the app itself (e.g. `process.loadEnvFile()`, built into Node ≥21.7), not by launchd. Secrets don't go in the plist.
- **Wake catch-up:** launchd doesn't notify a process on wake. Run a 60 s `setInterval` tick that compares `Date.now()` with the last tick; a jump of more than 2 minutes means the Mac slept, so run due checks (inside 07:00–23:00) right away. `StartCalendarInterval` isn't needed because the service is long-running.
- Install/uninstall should be a script in the repo (`scripts/launchagent.sh install|uninstall`) that writes the plist from a template. Ask the user before running it; it changes login items.
- Docs: `man launchd.plist`, `man launchctl`; https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
