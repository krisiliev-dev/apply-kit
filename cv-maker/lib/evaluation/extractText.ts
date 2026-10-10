import type { CvDocument, TextNode } from "@/lib/doc/types";

// Traverse every text node in every page in reading order.
// Reading order is approximated as (y asc, x asc) — visually top-to-bottom,
// left-to-right. It's not perfect for multi-column CVs but matches how an ATS
// tends to flow-extract anyway.

export function collectTextNodes(doc: CvDocument): TextNode[] {
  const out: TextNode[] = [];
  for (const page of doc.pages) {
    const texts = page.nodes.filter(
      (n): n is TextNode => n.type === "text" && !n.hidden,
    );
    texts.sort((a, b) => {
      // Bucket by y at 4mm resolution so side-by-side blocks stay together.
      const ayBucket = Math.floor(a.y / 4);
      const byBucket = Math.floor(b.y / 4);
      if (ayBucket !== byBucket) return ayBucket - byBucket;
      return a.x - b.x;
    });
    out.push(...texts);
  }
  return out;
}

export function extractPlainText(doc: CvDocument): string {
  return collectTextNodes(doc)
    .map((n) => n.content)
    .filter((s) => s && s.trim().length > 0)
    .join("\n");
}
