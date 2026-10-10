// Location normalization + matching, shared by scoring (work-auth hard filter
// and the preferred-location soft boost). The key job: make Cyrillic
// Bulgarian place names match Latin ones — postings from dev.bg / A1 say
// "София", but the user's prefs say "Sofia".

const CYRILLIC_TO_LATIN: Record<string, string> = {
  софия: "sofia",
  пловдив: "plovdiv",
  варна: "varna",
  бургас: "burgas",
  русе: "ruse",
  българия: "bulgaria",
  българиа: "bulgaria",
  дистанционно: "remote",
  хибрид: "hybrid",
  белград: "belgrade",
};

export function normalizeLoc(s: string | undefined): string {
  let n = (s ?? "").toLowerCase();
  for (const [cyr, lat] of Object.entries(CYRILLIC_TO_LATIN)) {
    if (n.includes(cyr)) n = n.split(cyr).join(lat);
  }
  return n;
}

/** True if `loc` mentions any of `terms` (both normalized to Latin/lowercase). */
export function locationMatches(
  loc: string | undefined,
  terms: string[],
): boolean {
  const n = normalizeLoc(loc);
  if (!n) return false;
  return terms.some((t) => {
    const nt = normalizeLoc(t);
    return nt.length > 0 && n.includes(nt);
  });
}
