// Runtime configuration, persisted via chrome.storage.sync so the popup
// and the service worker see the same value. Only the CV-maker base URL
// lives here today; more knobs can join without widening the API.

export const DEFAULT_CV_MAKER_BASE_URL = "http://localhost:3000";
const STORAGE_KEY = "cvMakerBaseUrl";

export interface ExtensionConfig {
  cvMakerBaseUrl: string;
}

function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_CV_MAKER_BASE_URL;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_CV_MAKER_BASE_URL;
  try {
    // Validate — if this throws, fall back to default instead of letting a bad URL
    // propagate into fetch() later and explode.
    new URL(trimmed);
    return trimmed;
  } catch {
    return DEFAULT_CV_MAKER_BASE_URL;
  }
}

export async function getConfig(): Promise<ExtensionConfig> {
  const raw = await chrome.storage.sync.get(STORAGE_KEY);
  return { cvMakerBaseUrl: normalizeBaseUrl(raw[STORAGE_KEY]) };
}

export async function setBaseUrl(next: string): Promise<string> {
  const value = normalizeBaseUrl(next);
  await chrome.storage.sync.set({ [STORAGE_KEY]: value });
  return value;
}
