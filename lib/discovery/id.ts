// Stable, deterministic ids for JobPosting rows.
// We don't need cryptographic strength — just a short, collision-resistant
// digest of (source kind + url + postedAt) so the same posting fetched twice
// maps to the same id (and so we can key UI state by it).

export function stableId(parts: Array<string | number | undefined>): string {
  const joined = parts
    .map((p) => (p === undefined || p === null ? "" : String(p)))
    .join("|");
  // FNV-1a 32-bit, base36 — small, fast, good enough for dedupe.
  let hash = 2166136261;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Convert to unsigned, base36.
  return (hash >>> 0).toString(36);
}
