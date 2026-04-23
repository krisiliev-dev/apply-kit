import type { JobPosting } from "../types";
import { stableId } from "../id";

// "Ask HN: Who is hiring?" — public Firebase API.
// Strategy:
//   1. Hit the user page for `whoishiring` and pick the newest submitted
//      "Ask HN: Who is hiring?" thread.
//   2. Fetch the thread item and iterate `kids` (top-level comments).
//   3. Each top-level comment is one "post" — we best-effort parse the first
//      line as "Company | Role(s) | Location | ..." and keep the rest as
//      description.
//
// The format is loose — we extract what we can and capture everything else
// verbatim so keyword matching still works.

const HN_USER_PAGE = "https://news.ycombinator.com/submitted?id=whoishiring";
const HN_API_ITEM = (id: number | string) =>
  `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

type HnItem = {
  id: number;
  by?: string;
  deleted?: boolean;
  dead?: boolean;
  kids?: number[];
  text?: string;
  title?: string;
  time?: number; // unix seconds
  url?: string;
};

/**
 * Find the latest "Ask HN: Who is hiring?" thread id by scraping the
 * submitted-by page. We parse HTML naively (no scraper lib) because the page
 * is tiny, the cost is capped by the 15-minute fetch cache, and it's the only
 * documented way to reach the monthly thread.
 *
 * Falls back to `null` if we can't find a match (e.g. HN layout change or
 * offline).
 */
export async function resolveLatestHiringThreadId(): Promise<string | null> {
  const res = await fetch(HN_USER_PAGE, {
    headers: { accept: "text/html" },
  });
  if (!res.ok) return null;
  const html = await res.text();

  // HN submission rows include: <a href="item?id=12345">Ask HN: Who is hiring? (Month Year)</a>
  // We iterate all `item?id=N` links and return the first one whose nearby
  // title text starts with "Ask HN: Who is hiring".
  const regex =
    /<a href="item\?id=(\d+)"[^>]*class="titlelink"[^>]*>([^<]+)<\/a>/gi;
  // Also try the newer markup: titleline class on an outer <span>.
  const altRegex =
    /<span class="titleline"><a href="item\?id=(\d+)"[^>]*>([^<]+)<\/a>/gi;

  const scan = (re: RegExp): string | null => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const id = m[1];
      const title = (m[2] || "").toLowerCase();
      if (title.startsWith("ask hn: who is hiring")) return id;
    }
    return null;
  };

  return scan(regex) ?? scan(altRegex);
}

export async function fetchPostings(
  threadIdInput?: string,
): Promise<JobPosting[]> {
  const threadId = threadIdInput ?? (await resolveLatestHiringThreadId());
  if (!threadId) return [];

  const threadRes = await fetch(HN_API_ITEM(threadId), {
    headers: { accept: "application/json" },
  });
  if (!threadRes.ok) return [];

  let thread: HnItem;
  try {
    thread = (await threadRes.json()) as HnItem;
  } catch {
    return [];
  }
  const kids = Array.isArray(thread.kids) ? thread.kids : [];
  if (kids.length === 0) return [];

  // Cap to 120 comments per thread to keep first-load responsive. HN threads
  // routinely have 500+ kids; past the top ~100 the signal tails off.
  const capped = kids.slice(0, 120);

  const results = await Promise.all(
    capped.map(async (id): Promise<JobPosting | null> => {
      try {
        const r = await fetch(HN_API_ITEM(id), {
          headers: { accept: "application/json" },
        });
        if (!r.ok) return null;
        const item = (await r.json()) as HnItem;
        if (!item || item.deleted || item.dead || !item.text) return null;
        return commentToPosting(threadId, item);
      } catch {
        return null;
      }
    }),
  );

  return results.filter((p): p is JobPosting => p !== null);
}

function commentToPosting(threadId: string, item: HnItem): JobPosting {
  const rawText = decodeEntities(item.text ?? "");
  const plain = rawText
    .replace(/<p>/gi, "\n\n")
    .replace(/<\/p>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();

  const firstLine = plain.split(/\n/).map((s) => s.trim()).find(Boolean) || "";
  const { company, title, location } = parseHeader(firstLine);
  const postedAt =
    typeof item.time === "number" ? item.time * 1000 : undefined;
  const url = `https://news.ycombinator.com/item?id=${item.id}`;

  return {
    id: stableId(["hn-hiring", url, postedAt ?? ""]),
    source: { kind: "hn-hiring", threadId },
    url,
    title: title || firstLine.slice(0, 120) || `HN Hiring #${item.id}`,
    company: company || "Unknown",
    location,
    description: plain,
    postedAt,
    fetchedAt: Date.now(),
  };
}

function parseHeader(line: string): {
  company: string;
  title?: string;
  location?: string;
} {
  // Typical separators: "|" (canonical), "-", "—", ":" — we handle all.
  const parts = line
    .split(/\s*[|—–\-:]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { company: "" };
  const [company, second, third, ...rest] = parts;
  // Heuristic: if the second segment mentions Remote/Onsite/Hybrid or a US
  // state/country-like token, treat it as location; otherwise title.
  const looksLikeLocation = (s: string) =>
    /\b(remote|onsite|on-site|hybrid|wfh|anywhere)\b/i.test(s) ||
    /\b[A-Z]{2}\b/.test(s);
  let title: string | undefined;
  let location: string | undefined;
  if (second && looksLikeLocation(second)) {
    location = second;
    title = third;
  } else {
    title = second;
    location = third && looksLikeLocation(third) ? third : undefined;
  }
  if (!location) {
    const tail = rest.find(looksLikeLocation);
    if (tail) location = tail;
  }
  return { company, title, location };
}

function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
