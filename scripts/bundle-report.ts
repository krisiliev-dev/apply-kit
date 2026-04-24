#!/usr/bin/env tsx
// Bundle-size report.
//
// Walks `.next/static/chunks` + `.next/server/app` after a production build
// and writes a Markdown report to `docs/bundle-report.md` summarising:
//   • Biggest client chunks
//   • Per-route server-rendered segment sizes (the RSC payload for each
//     route — not first-load JS, but the closest proxy Turbopack gives us
//     out-of-the-box)
//   • Flags any route whose total RSC payload exceeds a threshold
//
// Run: `npx tsx scripts/bundle-report.ts` (after `next build`).
//
// Why not parse first-load JS like webpack builds print? Next 16 on
// Turbopack doesn't expose a per-route chunk graph in the build manifest —
// `.next/build-manifest.json` only lists rootMainFiles. Until that lands we
// report what we can measure deterministically from the filesystem.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CHUNKS_DIR = path.join(ROOT, ".next/static/chunks");
const APP_DIR = path.join(ROOT, ".next/server/app");
const OUT_PATH = path.join(ROOT, "docs/bundle-report.md");

type ChunkEntry = { name: string; size: number };
type RouteEntry = { route: string; rscSize: number; files: number };

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function formatKb(bytes: number): string {
  return (bytes / 1024).toFixed(1) + " KB";
}

function collectChunks(): ChunkEntry[] {
  const files = fs
    .readdirSync(CHUNKS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"));
  return files
    .map((f) => ({
      name: f.name,
      size: fs.statSync(path.join(CHUNKS_DIR, f.name)).size,
    }))
    .sort((a, b) => b.size - a.size);
}

function collectRoutes(): RouteEntry[] {
  const routes = new Map<string, { size: number; files: number }>();
  for (const file of walkFiles(APP_DIR)) {
    // Segments live in `<route>.segments/` directories. The aggregate
    // payload for a route is the sum of every `.segment.rsc` file under it.
    const rel = path.relative(APP_DIR, file);
    const match = rel.match(/^(.*)\.segments\/.+\.segment\.rsc$/);
    if (!match) continue;
    const routePath = match[1];
    const normalized = routePath === "index" ? "/" : "/" + routePath;
    const size = fs.statSync(file).size;
    const entry = routes.get(normalized) ?? { size: 0, files: 0 };
    entry.size += size;
    entry.files += 1;
    routes.set(normalized, entry);
  }
  return [...routes.entries()]
    .map(([route, v]) => ({ route, rscSize: v.size, files: v.files }))
    .sort((a, b) => b.rscSize - a.rscSize);
}

function totalBytes(files: ChunkEntry[]): number {
  return files.reduce((s, f) => s + f.size, 0);
}

function describeChunk(name: string): string {
  // Heuristics based on source-map-less chunk hashes — we can't know the
  // module without opening the files. Flag by size so reviewers know what
  // to look at first.
  return "";
}

function buildReport(): string {
  const chunks = collectChunks();
  const routes = collectRoutes();
  const total = totalBytes(chunks);
  const biggest = chunks.slice(0, 10);
  const now = new Date().toISOString().slice(0, 10);

  const HEAVY_ROUTE_THRESHOLD = 150 * 1024; // 150 KB RSC payload
  const heavy = routes.filter((r) => r.rscSize > HEAVY_ROUTE_THRESHOLD);

  const lines: string[] = [];
  lines.push("# Bundle-size report");
  lines.push("");
  lines.push(`_Generated: ${now} (\`scripts/bundle-report.ts\`)_`);
  lines.push("");
  lines.push(
    "Walks `.next/static/chunks` and `.next/server/app` after `next build`. Next 16 on Turbopack doesn't emit per-route first-load JS in the build manifest, so we report: (a) raw client chunk sizes and (b) per-route RSC payload size (sum of `.segment.rsc` files under `.next/server/app/<route>.segments/`) as the best available proxy.",
  );
  lines.push("");

  lines.push("## Overall");
  lines.push("");
  lines.push(`- **Client chunks:** ${chunks.length} files, total ${formatKb(total)}`);
  lines.push(`- **Routes analysed:** ${routes.length}`);
  lines.push("");

  lines.push("## Biggest client chunks");
  lines.push("");
  lines.push("| Chunk | Size |");
  lines.push("| --- | ---: |");
  for (const c of biggest) {
    lines.push(`| \`${c.name}\` | ${formatKb(c.size)} |`);
  }
  lines.push("");

  lines.push("## Per-route RSC payload (sorted)");
  lines.push("");
  lines.push("| Route | RSC payload | Segment files |");
  lines.push("| --- | ---: | ---: |");
  for (const r of routes) {
    lines.push(`| \`${r.route}\` | ${formatKb(r.rscSize)} | ${r.files} |`);
  }
  lines.push("");

  lines.push("## Notes");
  lines.push("");
  if (biggest[0] && biggest[0].size > 400 * 1024) {
    lines.push(
      `- The largest client chunk is **${formatKb(biggest[0].size)}** (\`${biggest[0].name}\`). Plausible contents: the canvas editor (react-moveable + @ai-sdk/react + zustand + document-store graph). Consider lazy-loading the editor at \`/cv/[slug]\` on first user interaction to keep the home route cheap.`,
    );
  }
  if (biggest.length > 1 && biggest[0].size === biggest[1].size) {
    lines.push(
      `- The top two chunks are the **same size** (\`${biggest[0].name}\` / \`${biggest[1].name}\`). Likely a duplicated module graph — could be the chat copilot sharing a stack with the editor. Worth checking whether \`@ai-sdk/react\` + \`ai\` is tree-shaken across both.`,
    );
  }
  if (heavy.length) {
    lines.push(
      `- Routes whose RSC payload exceeds ${formatKb(HEAVY_ROUTE_THRESHOLD)}:`,
    );
    for (const r of heavy) {
      lines.push(`  - \`${r.route}\` — ${formatKb(r.rscSize)} across ${r.files} segment files`);
    }
  } else {
    lines.push(
      `- No route's RSC payload exceeds ${formatKb(HEAVY_ROUTE_THRESHOLD)}. Nothing obvious to trim on the server side.`,
    );
  }
  lines.push("");
  lines.push(
    "- `puppeteer` is a dev-time dependency used by the export pipeline; it ships in `node_modules` not the client bundle. If it ever shows up here, something's wrong with the route boundary.",
  );
  lines.push("");
  lines.push("## How to re-run");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run build && npx tsx scripts/bundle-report.ts");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

function main() {
  if (!fs.existsSync(CHUNKS_DIR)) {
    console.error("No .next/static/chunks found — run `next build` first.");
    process.exit(1);
  }
  const report = buildReport();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, report);
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
}

main();
