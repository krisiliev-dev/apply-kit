# Bundle-size report

_Generated: 2026-04-24 (`scripts/bundle-report.ts`)_

Walks `.next/static/chunks` and `.next/server/app` after `next build`. Next 16 on Turbopack doesn't emit per-route first-load JS in the build manifest, so we report: (a) raw client chunk sizes and (b) per-route RSC payload size (sum of `.segment.rsc` files under `.next/server/app/<route>.segments/`) as the best available proxy.

## Overall

- **Client chunks:** 32 files, total 2677.6 KB
- **Routes analysed:** 17

## Biggest client chunks

| Chunk | Size |
| --- | ---: |
| `0e22-__7q3cpm.js` | 463.2 KB |
| `0g8ii4b.du280.js` | 463.2 KB |
| `0tbxmd5c18qkh.js` | 322.1 KB |
| `12dx9nwn5bfp8.js` | 232.9 KB |
| `0o1gx2eln-dt..js` | 222.2 KB |
| `0wpjg_uuznl4w.js` | 146.0 KB |
| `03~yq9q893hmn.js` | 110.0 KB |
| `0d3shmwh5_nmn.js` | 53.4 KB |
| `01_1_nexa1zep.js` | 52.0 KB |
| `02snzepww28d9.js` | 46.6 KB |

## Per-route RSC payload (sorted)

| Route | RSC payload | Segment files |
| --- | ---: | ---: |
| `/` | 23.5 KB | 5 |
| `/discover/preferences` | 15.1 KB | 7 |
| `/applications/review` | 15.1 KB | 7 |
| `/advisor/decisions` | 15.1 KB | 7 |
| `/advisor/narrative` | 15.1 KB | 7 |
| `/applications/new` | 15.1 KB | 7 |
| `/advisor/ceiling` | 15.1 KB | 7 |
| `/advisor/skills` | 15.1 KB | 7 |
| `/cv/compare` | 15.1 KB | 7 |
| `/pair` | 14.5 KB | 6 |
| `/applications` | 14.2 KB | 6 |
| `/discover` | 14.2 KB | 6 |
| `/settings` | 14.2 KB | 6 |
| `/advisor` | 14.2 KB | 6 |
| `/jobs` | 14.2 KB | 6 |
| `/_not-found` | 12.4 KB | 6 |
| `/_global-error` | 9.5 KB | 5 |

## Notes

- The largest client chunk is **463.2 KB** (`0e22-__7q3cpm.js`). Plausible contents: the canvas editor (react-moveable + @ai-sdk/react + zustand + document-store graph). Consider lazy-loading the editor at `/cv/[slug]` on first user interaction to keep the home route cheap.
- The top two chunks are the **same size** (`0e22-__7q3cpm.js` / `0g8ii4b.du280.js`). Likely a duplicated module graph — could be the chat copilot sharing a stack with the editor. Worth checking whether `@ai-sdk/react` + `ai` is tree-shaken across both.
- No route's RSC payload exceeds 150.0 KB. Nothing obvious to trim on the server side.

- `puppeteer` is a dev-time dependency used by the export pipeline; it ships in `node_modules` not the client bundle. If it ever shows up here, something's wrong with the route boundary.

## How to re-run

```bash
npm run build && npx tsx scripts/bundle-report.ts
```
