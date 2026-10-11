// Small helpers the Source adapters share. Nothing here touches the database or the clock.
import type { AdapterContext } from "./adapter.ts";

/** Upper bound on postings one search-type Source returns per check (newest first). */
export const searchCap = 100;

/**
 * Reads a JSON body or throws a readable error naming the Source. Error text never includes the
 * request URL, because some Sources (Jooble) put the API key in it.
 */
export async function readJson<T>(res: Response, sourceName: string): Promise<T> {
  if (!res.ok) throw new Error(`${sourceName} answered ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${sourceName} sent a response that isn't JSON`);
  }
}

/** A setting the Source can't work without, or a readable error naming it (never its value). */
export function requireSetting(ctx: AdapterContext, name: string, sourceName: string): string {
  const value = ctx.setting(name);
  if (!value) throw new Error(`${sourceName} needs the ${name} setting. Add it to .env and restart apply-kit`);
  return value;
}

/**
 * Splits a config shorthand like "security engineer|Bulgaria" into trimmed parts. Missing parts
 * come back as "".
 */
export function splitShorthand(raw: string, parts: number): string[] {
  const out = raw.split("|").map((s) => s.trim());
  while (out.length < parts) out.push("");
  return out.slice(0, parts);
}

/** The value of a string field on a config object, or undefined. */
export function field(raw: unknown, name: string): string | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const v = (raw as Record<string, unknown>)[name];
  return typeof v === "string" ? v.trim() : undefined;
}

/** A stable, readable key segment: lower case, spaces collapsed. */
export function keyPart(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A date-only value as midnight UTC (ISO 8601), or null if the parts don't make a real date. */
export function utcDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString();
}
