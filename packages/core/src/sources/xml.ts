// XML parsing shared by the feed-based adapters (Personio XML, Teamtailor RSS).
import { XMLParser } from "fast-xml-parser";

/**
 * Parses an XML document into plain objects. Text stays text (no number guessing), HTML entities are
 * decoded, CDATA is kept as is, and the named elements are always arrays even when there is only one.
 */
export function parseXml(text: string, arrays: string[]): Record<string, unknown> {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    htmlEntities: true,
    isArray: (name) => arrays.includes(name),
  });
  return parser.parse(text) as Record<string, unknown>;
}

/** Text of a parsed element: "" for absent or empty elements. */
export function textOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}
