---
name: project-icloud-tmp-build
description: "Run topology — iCloud source of truth, stable run clone at ~/code/cv-maker, shared store, and the MCP bridge"
metadata: 
  node_type: memory
  type: project
  originSessionId: 24c9f673-f290-4f2b-9f82-33c3ee4e31bc
---

The working dir lives under iCloud Drive and has **no `node_modules`** — npm/next/vitest/tsc do not run there.

**Why:** iCloud sync is slow/flaky for the huge `node_modules` tree and triggers git `index.lock` / mmap timeouts and conflict-rename dupes (`foo 2.ts`).

**Run topology (set up 2026-05-28):**
- **Source of truth:** the iCloud project (edit here).
- **Stable run clone:** `~/code/cv-maker` — has `node_modules` (incl. `@modelcontextprotocol/sdk`). The web app runs here: `npm run dev` on **port 3000**, reading `.env.local` (`ANTHROPIC_API_KEY`).
- **Shared file store:** `~/.cv-maker/data/` (`base.json`, `docs/<slug>.json`, `variants.json`, `discovery-prefs.json`, `discovery-sources.json`, `discovery-postings.json`) via `lib/doc/serverStore.ts`. Default path; override with `CV_MAKER_DATA_DIR`.
- **MCP bridge:** `.mcp.json` at the iCloud project root (gitignored — absolute path) launches `~/code/cv-maker/mcp/server.mjs`. **14 tools** — CVs: `list_cvs`, `read_cv`, `write_cv`, `read_base`, `write_base`, `tailor_cv`; discovery: `get/set_discovery_prefs`, `list/add/remove_source`, `list_postings`, `ingest_postings`, `run_discovery`. The MCP server is a thin HTTP client to the app's `/api/docs*`, `/api/base`, `/api/discover/*` routes, so **the web app must be running** and a Claude Code **restart** is needed after editing `server.mjs` or first-adding `.mcp.json`.

**How to apply:** Edit in iCloud, then `rsync -a --exclude node_modules --exclude .next --exclude .git "$SRC/" ~/code/cv-maker/` and run typecheck (`node node_modules/typescript/bin/tsc --noEmit`) + `npx vitest run` + `npm run build` there. The clone is verify/run-only — edits live in iCloud, so nothing merges back. If a new dep is added in the clone, copy `package.json`+`package-lock.json` back to iCloud. Tests live under `tests/**` (vitest include glob); colocated `*.test.ts` are NOT collected. See [[feedback-no-personal-data]].
