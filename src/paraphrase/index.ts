// Paraphrase interface. Stubbed for now.
//
// TODO: wire to CV-maker paraphrase API. Expected behavior: given an answer
// the user previously gave plus the new field's context (the surrounding
// job/company/role), return a varied phrasing so the same bullet point doesn't
// appear verbatim across N applications. Must preserve factual content.

export interface ParaphraseContext {
  jobTitle?: string;
  companyName?: string;
  fieldLabel: string;
}

export async function paraphrase(
  text: string,
  _context: ParaphraseContext,
): Promise<string> {
  // Stub: return input unchanged. Keeps the pipeline shape stable so
  // callers don't have to change when we swap in the real implementation.
  return text;
}
