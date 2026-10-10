import { XMLParser } from "fast-xml-parser";
import type { JobPosting } from "../types";
import { stableId } from "../id";

// Generic RSS / Atom reader for company career pages that expose a feed.
// We keep the parsing forgiving: some feeds use <item>, others <entry>, and
// they disagree on where the URL/date live. We normalize what we can.

type RssItem = {
  title?: string | { "#text"?: string };
  link?: string | { "@_href"?: string; "#text"?: string };
  description?: string;
  summary?: string;
  "content:encoded"?: string;
  pubDate?: string;
  published?: string;
  updated?: string;
  "dc:creator"?: string;
  author?: string | { name?: string };
  category?: string | string[];
};

type RssChannel = {
  title?: string;
  link?: string;
  item?: RssItem | RssItem[];
  entry?: RssItem | RssItem[];
};

type RssRoot = {
  rss?: { channel?: RssChannel };
  feed?: RssChannel;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

export async function fetchPostings(feedUrl: string): Promise<JobPosting[]> {
  let res: Response;
  try {
    res = await fetch(feedUrl, {
      headers: {
        accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const xml = await res.text();

  let parsed: RssRoot;
  try {
    parsed = parser.parse(xml) as RssRoot;
  } catch {
    return [];
  }

  const channel = parsed.rss?.channel ?? parsed.feed;
  if (!channel) return [];
  const rawItems = channel.item ?? channel.entry ?? [];
  const items: RssItem[] = Array.isArray(rawItems) ? rawItems : [rawItems];

  const feedCompany = textOf(channel.title) || domainOf(feedUrl);
  const now = Date.now();

  return items
    .map<JobPosting | null>((item) => {
      const url = resolveLink(item.link);
      const title = textOf(item.title);
      if (!url || !title) return null;
      const postedAt = parseDate(item.pubDate ?? item.published ?? item.updated);
      const description =
        textOf(item["content:encoded"]) ??
        textOf(item.description) ??
        textOf(item.summary);
      const location = extractLocationHint(description);
      return {
        id: stableId(["rss", url, postedAt ?? ""]),
        source: { kind: "rss", feedUrl },
        url,
        title,
        company: feedCompany,
        location,
        description: description ? stripHtml(description) : undefined,
        postedAt,
        fetchedAt: now,
      };
    })
    .filter((p): p is JobPosting => p !== null);
}

function resolveLink(link: RssItem["link"]): string | undefined {
  if (typeof link === "string") return link.trim() || undefined;
  if (link && typeof link === "object") {
    if (link["@_href"]) return link["@_href"];
    if (link["#text"]) return link["#text"];
  }
  return undefined;
}

function textOf(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (v && typeof v === "object" && "#text" in v) {
    const t = (v as { "#text"?: unknown })["#text"];
    return typeof t === "string" ? t.trim() || undefined : undefined;
  }
  return undefined;
}

function parseDate(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const ts = Date.parse(s);
  return Number.isFinite(ts) ? ts : undefined;
}

function domainOf(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return "rss";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLocationHint(desc: string | undefined): string | undefined {
  if (!desc) return undefined;
  const m = desc.match(/\b(remote|hybrid|on[- ]site)\b/i);
  return m ? m[1].toLowerCase() : undefined;
}
