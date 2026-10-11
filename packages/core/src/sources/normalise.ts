// Shared normalisation so every adapter states titles, locations, salaries and dates the same way.
// Locations read "Place; Other place · Remote|Hybrid": places as the Source states them ("City,
// Country" where it gives both), then how the job is worked when the Source says so.

/** How a job is worked, when the Source says so. On-site is the default and isn't shown. */
export type Workplace = "remote" | "hybrid" | null;

/** Collapses whitespace (titles, names). */
export function cleanText(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Joins the stated places (deduplicated) and appends the workplace, or null if nothing is stated. */
export function formatLocation(places: (string | null | undefined)[], workplace: Workplace = null): string | null {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of places) {
    const p = cleanText(raw);
    if (p && !seen.has(p.toLowerCase())) {
      seen.add(p.toLowerCase());
      kept.push(p);
    }
  }
  const text = kept.join("; ");
  if (!workplace) return text || null;
  const word = workplace === "remote" ? "Remote" : "Hybrid";
  if (!text) return word;
  return new RegExp(`\\b${word}\\b`, "i").test(text) ? text : `${text} · ${word}`;
}

/** "City, Country" from parts, skipping empty or repeated parts. */
export function place(...parts: (string | null | undefined)[]): string | null {
  const out: string[] = [];
  for (const raw of parts) {
    const p = cleanText(raw);
    if (p && !out.some((o) => o.toLowerCase().includes(p.toLowerCase()))) out.push(p);
  }
  return out.length ? out.join(", ") : null;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** English country name for an ISO 3166 alpha-2 code ("BG" → "Bulgaria"), or null. */
export function countryName(code: string | null | undefined): string | null {
  if (!code || !/^[a-z]{2}$/i.test(code)) return null;
  try {
    const name = regionNames.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

/**
 * ISO 8601 UTC from what Sources send: epoch milliseconds, ISO strings, RFC 822 dates
 * ("Fri, 07 Aug 2026 17:58:39 +0300") or "2026-08-04 07:35:25 UTC". Null if absent or unreadable.
 */
export function toIsoUtc(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const v = typeof value === "string" ? value.trim().replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d(?::\d\d)?) UTC$/, "$1T$2Z") : value;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface SalaryRange {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  /** "year", "month", "hour", ... */
  period?: string | null;
}

/** "EUR 40,000–50,000 / year", "from EUR 40,000", or null when no amount is stated. */
export function formatSalary({ min, max, currency, period }: SalaryRange): string | null {
  const n = (x: number) => x.toLocaleString("en-US");
  const cur = currency ? `${currency.toUpperCase()} ` : "";
  const amount = min != null && max != null
    ? min === max ? `${cur}${n(min)}` : `${cur}${n(min)}–${n(max)}`
    : min != null ? `from ${cur}${n(min)}` : max != null ? `up to ${cur}${n(max)}` : null;
  if (!amount) return null;
  return period ? `${amount} / ${period}` : amount;
}

/** "dext-careers" → "Dext Careers": a company name until the user gives a better one. */
export function humanizeSlug(slug: string): string {
  return slug.split(/[-_.\s]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

/** Joins HTML fragments into one body, or null if they are all empty. */
export function joinHtml(parts: (string | null | undefined)[]): string | null {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => !!p);
  return kept.length ? kept.join("\n") : null;
}

