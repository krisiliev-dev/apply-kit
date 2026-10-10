# Models

CV-maker calls a language model for most of its heavy lifting — drafting, evaluation, cover letters, advisor, rejection triage. By default that's Anthropic's hosted Claude Sonnet 4.6. You can switch to a local model through Settings → Models.

## Providers

Two providers ship today:

- **`anthropic`** — Claude via `@ai-sdk/anthropic`. Requires `ANTHROPIC_API_KEY` in `.env.local`.
- **`ollama-openai-compat`** — Any local Ollama server reached through its OpenAI-compatible endpoint (default `http://localhost:11434/v1`). No API key required.

Per-feature routing: each feature class (`chat`, `draft`, `evaluator`, `narrative`, `paraphrase`) can pick a different model. Anything unset falls through to `default`. Configure from Settings → Models.

## Running a local model with Ollama

```bash
# 1. Install Ollama (macOS)
brew install --cask ollama

# 2. Start the server (runs in the background)
ollama serve

# 3. Pull a capable model
ollama pull qwen2.5-coder:32b        # strong general / coding
# or
ollama pull llama3.2:3b              # small + fast, fine for paraphrase/chat
```

Once the server is up, go to **Settings → Models** in the app, choose the feature you want to route locally (start with `paraphrase` — cheap to test), flip its provider to `ollama-openai-compat`, set the model tag (e.g. `qwen2.5-coder:32b`), and save. The `probeOllama` check in the settings UI verifies the server is reachable and lists available models.

### When Ollama isn't running

Every route surfaces a clear 502 with the base URL in the message:

```
Ollama server not reachable at http://localhost:11434/v1.
Start it with `ollama serve` or switch this feature back to Anthropic
under Settings → Models.
```

No routes silently fall through. If Ollama is down you'll know immediately.

## Cost shapes

Per million tokens (list prices; actual bills may be lower with caching / batch):

| Model                | Input (\$/Mtok) | Output (\$/Mtok) |
| -------------------- | --------------- | ---------------- |
| `claude-sonnet-4-6`  | 3.00            | 15.00            |
| `claude-haiku-4-5`   | 0.80            | 4.00             |
| `claude-opus-4-7`    | 15.00           | 75.00            |
| `ollama-*`           | 0.00            | 0.00             |

Rates live in [`lib/ai/pricing.ts`](../lib/ai/pricing.ts). Update there when Anthropic publishes new prices.

Typical cost per flow on Sonnet 4.6:

- Parse a job posting: ~$0.01
- Draft + evaluate a tailored CV: ~$0.05–$0.10
- Cover letter: ~$0.01
- Advisor/skills analysis across a batch of postings: ~$0.05–$0.15

On Haiku 4.5 divide by ~4. On Ollama it's zero (plus your electricity bill).

## The cost pill

Enable `Settings → UI → showCostPill` (default on). The pill shows up in the top-right once this session has landed at least one AI call, formatted as:

```
$0.032 · 12.4k tok
```

Click it for a modal with a per-feature breakdown and the last 20 calls. **Clear ledger** wipes the running total — there's a 500-entry cap, so oldest entries drop automatically.

The pill reads from `localStorage['cv-maker:token-ledger']`. Data source is the `x-cv-usage` response header every AI route stamps. Streaming routes can't resolve usage before headers flush, so their entries land with zero tokens — the pill still ticks "one call" but doesn't accumulate cost for those. Non-streaming routes (`/jobs/parse`, `/cv-evaluate`, advisor endpoints) carry accurate counts.

## Switching feature-by-feature (recommended flow)

1. **Paraphrase** — flip this to Ollama first; it's a small prompt with forgiving output.
2. **Chat** — if your local model handles tool calls reliably, move chat next. Some smaller Ollama models don't; test before committing.
3. **Draft / Evaluator / Narrative** — keep these on Claude until you've evaluated a local model on the fixture suite (`npm run eval:fixtures`). These are the quality-sensitive surfaces.
4. **Default** — only flip this once you trust your local model across all the flows.

Each feature is independent. Mixed routing (e.g. Claude for draft, Ollama for paraphrase) is the expected setup, not a workaround.

## Debugging

- `npm run smoke` — hits every route with a stub payload. Verifies 400s when `ANTHROPIC_API_KEY` is missing and 2xx on non-AI routes.
- `npm run eval:fixtures` — runs the 7 fictional postings through parse → draft → evaluate and writes a Markdown report with score / cost / keyword coverage.
- `npm run test` — vitest unit suite covering the provider factory, pricing math, and the token ledger.
