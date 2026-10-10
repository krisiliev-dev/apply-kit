// Extension-side pairing state.
//
// Persists the paired web-app URL + device token + device id in
// chrome.storage.sync so the service worker (alarm-driven sync) and the
// popup see the same values. A separate WebCrypto-generated public key JWK
// is stored too — we send it to the web-app on pair so future signed-request
// upgrades don't require a re-pair.

export interface PairedDeviceState {
  /** Base URL of the CV-maker web app (no trailing slash). */
  webAppUrl: string;
  /** Opaque device id assigned by the web-app. */
  deviceId: string;
  /** Long-lived bearer token. Stored in chrome.storage.sync; treat as a
   * secret and never log it. */
  deviceToken: string;
  /** Human label shown on /pair. */
  deviceLabel: string;
  /** When the device was paired (ms epoch). */
  pairedAt: number;
  /** Last successful background sync (ms epoch, 0 if never). */
  lastSyncAt: number;
  /** JWK public key corresponding to the keypair we generated. */
  publicKey: JsonWebKey;
}

const STORAGE_KEYS = {
  pairing: "pairing",
} as const;

export async function getPairing(): Promise<PairedDeviceState | null> {
  const raw = await chrome.storage.sync.get(STORAGE_KEYS.pairing);
  const v = raw[STORAGE_KEYS.pairing];
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (
    typeof p.webAppUrl !== "string" ||
    typeof p.deviceId !== "string" ||
    typeof p.deviceToken !== "string" ||
    typeof p.deviceLabel !== "string" ||
    typeof p.pairedAt !== "number" ||
    typeof p.lastSyncAt !== "number" ||
    !p.publicKey ||
    typeof p.publicKey !== "object"
  ) {
    return null;
  }
  return p as unknown as PairedDeviceState;
}

export async function setPairing(state: PairedDeviceState): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEYS.pairing]: state });
}

export async function clearPairing(): Promise<void> {
  await chrome.storage.sync.remove(STORAGE_KEYS.pairing);
}

export async function updateLastSync(ts: number): Promise<void> {
  const p = await getPairing();
  if (!p) return;
  await setPairing({ ...p, lastSyncAt: ts });
}

// ———————————————————————————————————————————————————————————————
// WebCrypto keypair
// ———————————————————————————————————————————————————————————————

/** Generates a fresh ECDSA P-256 keypair and returns the public JWK. The
 * private key is intentionally discarded — v1 does not sign requests yet.
 * Keeping this entry point means we can start storing the private key as
 * an extractable JWK in chrome.storage.local later without changing the
 * wire format with the web-app. */
export async function generatePublicJwk(): Promise<JsonWebKey> {
  const { publicKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return (await crypto.subtle.exportKey("jwk", publicKey)) as JsonWebKey;
}

// ———————————————————————————————————————————————————————————————
// URL normalization — shared with config.ts so the pair tab accepts the
// same formats ("localhost:3000", "http://foo", with/without trailing /).
// ———————————————————————————————————————————————————————————————

export function normalizeWebAppUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const u = new URL(candidate);
    // Strip trailing slash from pathname too.
    return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname}`.replace(
      /\/+$/,
      "",
    );
  } catch {
    return null;
  }
}
