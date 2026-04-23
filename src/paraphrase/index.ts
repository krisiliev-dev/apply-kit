import { getConfig } from "../shared/config";

// Paraphrase interface — calls the CV-maker web app's /api/paraphrase endpoint.
// The endpoint may not exist yet (a parallel agent is responsible for it); on
// 404, network error, or malformed response we fall back to the original text
// so callers (e.g. the suggest tooltip) keep working unchanged.
//
// Contract with the web app:
//   POST /api/paraphrase  { text: string, context: ParaphraseContext }
//   200 { text: string }  — the rewritten answer; same facts, new phrasing
//   any other status      — treat as "no paraphrase available", return input

export interface ParaphraseContext {
  jobTitle?: string;
  companyName?: string;
  fieldLabel: string;
}

const PARAPHRASE_PATH = "/api/paraphrase";
// Keep the call short: if the web app is slow or wedged, we don't want to
// block the autofill path for seconds. Better to just use the original text.
const TIMEOUT_MS = 8000;

export async function paraphrase(
  text: string,
  context: ParaphraseContext,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const { cvMakerBaseUrl } = await getConfig();
  const url = `${cvMakerBaseUrl.replace(/\/+$/, "")}${PARAPHRASE_PATH}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, context }),
      signal: ctrl.signal,
    });
  } catch {
    // Network error, CORS block, or abort — silently fall back.
    clearTimeout(timer);
    return text;
  }
  clearTimeout(timer);

  if (!res.ok) {
    // 404 (endpoint not shipped yet), 5xx, etc. — fall back.
    return text;
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return text;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "text" in payload &&
    typeof (payload as { text: unknown }).text === "string"
  ) {
    const paraphrased = (payload as { text: string }).text.trim();
    return paraphrased.length > 0 ? paraphrased : text;
  }
  return text;
}
