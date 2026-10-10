import puppeteer, { type Browser } from "puppeteer";
import type {
  CvDocument,
  ImageNode,
  Node,
  Page,
  ShapeNode,
  TextNode,
  Theme,
  TextStyle,
} from "@/lib/doc/types";

// ————————————————————————————————————————————————
// Layer 1b — Render the CvDocument to PDF with Puppeteer.
//
// Implementation choice: Option 2 (standalone HTML). We build self-contained
// HTML that mirrors the editor's mm-based layout (see components/editor/
// PageView.tsx and NodeView.tsx) and feed it to Puppeteer via `setContent`.
//
// Why not Option 1 (drive the running dev server)? The editor pulls its doc
// from localStorage per-slug, which Puppeteer can't easily populate without
// extra plumbing, and SSR would not have the doc until hydration. Standalone
// HTML is deterministic, testable offline, and matches what an ATS sees —
// which is the whole point of this layer.
//
// The DOM we emit is intentionally near-identical to PageView:
//   • Absolute-positioned divs in mm
//   • Text-align, colors, font tokens from the theme
//   • A4 page size, printBackground: true
// ————————————————————————————————————————————————

let sharedBrowser: Browser | null = null;
let browserLoading: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
  if (browserLoading) return browserLoading;

  browserLoading = puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });

  try {
    sharedBrowser = await browserLoading;
    return sharedBrowser;
  } finally {
    browserLoading = null;
  }
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    const b = sharedBrowser;
    sharedBrowser = null;
    try {
      await b.close();
    } catch {
      // ignore
    }
  }
}

export async function renderCvToPdf(
  doc: CvDocument,
  theme: Theme = doc.theme,
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    const html = buildHtml(doc, theme);
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
    const result = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(result);
  } finally {
    await page.close();
  }
}

// ————————————————————————————————————————————————
// HTML generation
// ————————————————————————————————————————————————

function buildHtml(doc: CvDocument, theme: Theme): string {
  const pagesHtml = doc.pages.map((p) => renderPage(p, theme)).join("\n");

  return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${theme.colors.paper}; color: ${theme.colors.ink}; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cv-page {
    position: relative;
    page-break-after: always;
    overflow: hidden;
  }
  .cv-page:last-child { page-break-after: auto; }
  .node {
    position: absolute;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .node img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

function renderPage(page: Page, theme: Theme): string {
  const bg = page.background ?? theme.colors.paper;
  const nodesHtml = [...page.nodes]
    .filter((n) => !n.hidden)
    .sort((a, b) => a.z - b.z)
    .map((n) => renderNode(n, theme))
    .join("\n");

  return `<div class="cv-page" style="width:${page.width}mm;height:${page.height}mm;background:${escapeAttr(bg)};">
${nodesHtml}
</div>`;
}

function renderNode(node: Node, theme: Theme): string {
  const base = `position:absolute;left:${node.x}mm;top:${node.y}mm;width:${node.w}mm;height:${node.h}mm;z-index:${node.z};`;
  const rotation = node.rotation
    ? `transform:rotate(${node.rotation}deg);transform-origin:center center;`
    : "";
  const opacity = node.opacity !== undefined ? `opacity:${node.opacity};` : "";

  if (node.type === "text") {
    return renderTextNode(node, theme, base + rotation + opacity);
  }
  if (node.type === "image") {
    return renderImageNode(node, base + rotation + opacity);
  }
  if (node.type === "shape") {
    return renderShapeNode(node, base + rotation + opacity);
  }
  return "";
}

function renderTextNode(node: TextNode, theme: Theme, base: string): string {
  const css = textStyleToCss(node.style, theme);
  const style = base + css;
  return `<div class="node" style="${style}">${escapeHtml(node.content)}</div>`;
}

function renderImageNode(node: ImageNode, base: string): string {
  const radius = node.borderRadius ? `border-radius:${node.borderRadius}px;` : "";
  const overflow = "overflow:hidden;";
  if (!node.src) {
    return `<div class="node" style="${base + overflow + radius}background:#eee;"></div>`;
  }
  const fit = node.objectFit ?? "cover";
  return `<div class="node" style="${base + overflow + radius}"><img src="${escapeAttr(node.src)}" alt="${escapeAttr(node.alt ?? "")}" style="object-fit:${fit};" /></div>`;
}

function renderShapeNode(node: ShapeNode, base: string): string {
  if (node.shape === "line") {
    const bg = node.stroke ?? "#111";
    return `<div class="node" style="${base}background:${escapeAttr(bg)};"></div>`;
  }
  const fill = node.fill ?? "transparent";
  const border = node.stroke
    ? `border:${node.strokeWidth ?? 1}px solid ${escapeAttr(node.stroke)};`
    : "";
  return `<div class="node" style="${base}background:${escapeAttr(fill)};${border}"></div>`;
}

function textStyleToCss(style: TextStyle, theme: Theme): string {
  const family = resolveFont(style, theme);
  const parts: string[] = [];
  parts.push(`font-family:${escapeAttr(family)};`);
  parts.push(`font-size:${style.fontSize}px;`);
  parts.push(`font-weight:${style.fontWeight};`);
  if (style.italic) parts.push(`font-style:italic;`);
  parts.push(`color:${escapeAttr(style.color)};`);
  if (style.lineHeight !== undefined) parts.push(`line-height:${style.lineHeight};`);
  if (style.letterSpacing !== undefined) {
    parts.push(`letter-spacing:${style.letterSpacing}em;`);
  }
  if (style.textTransform) parts.push(`text-transform:${style.textTransform};`);
  if (style.textAlign) parts.push(`text-align:${style.textAlign};`);
  return parts.join("");
}

// Strip the CSS-variable wrappers that only make sense inside the Next app.
// The PDF renderer has no CSS vars for fonts; translate to vanilla names.
function resolveFont(style: TextStyle, theme: Theme): string {
  if (style.fontFamily) return cleanFontFamily(style.fontFamily);
  const token = style.fontToken ?? "sans";
  return cleanFontFamily(theme.fonts[token]);
}

function cleanFontFamily(value: string): string {
  // Replace var(--font-*) with sensible fallbacks.
  const withoutVar = value.replace(/var\(--font-[a-z-]+\)/g, (m) => {
    if (m.includes("serif") || m.includes("instrument")) {
      return `"Instrument Serif", Georgia, serif`;
    }
    if (m.includes("mono") || m.includes("jetbrains")) {
      return `"JetBrains Mono", "SF Mono", Menlo, monospace`;
    }
    return `"Inter", -apple-system, "Helvetica Neue", Arial, sans-serif`;
  });
  return withoutVar || `"Inter", sans-serif`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
