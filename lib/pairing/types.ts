// Types for the extension ↔ web-app pairing flow.
//
// The design is intentionally modest: no real DB. The server keeps
//   - a short-lived in-memory `pairCodes` map (10-min TTL)
//   - a file-backed `devices` map (`.pairing-devices.json`, gitignored)
//   - an in-memory inbox ring buffer that the web app pulls into localStorage
//
// For dev this is fine: restarts preserve device pairings (via the file) but
// lose un-pulled inbox items (acceptable — user just recaptures). v2 would
// route the inbox through a KV store (Vercel KV / Upstash).

import type { IngestPayload, JobPosting } from "@/lib/discovery/types";

export type PairCodeStatus = "pending" | "bound" | "expired";

export interface PairCodeEntry {
  code: string;
  createdAt: number;
  expiresAt: number;
  status: PairCodeStatus;
  /** Once a device completes the pair, we stamp its deviceId here so the
   * web-app poller knows which device just bound. */
  boundDeviceId?: string;
}

/** Public, non-secret view of a paired device, shown in `/pair`. */
export interface DeviceSummary {
  deviceId: string;
  deviceLabel: string;
  pairedAt: number;
  lastSeenAt: number;
  /** JWK serialization of the extension's ECDSA P-256 public key. Kept for
   * forward compatibility (e.g. signed requests later). Not currently verified. */
  publicKey?: JsonWebKey;
}

/** Full server-side device record, including the token hash. Never serialized
 * to a client. */
export interface DeviceRecord extends DeviceSummary {
  /** Hex SHA-256 of the raw token we gave the extension. */
  tokenHash: string;
}

export interface InboxItem {
  posting: JobPosting;
  receivedAt: number;
  deviceId: string;
}

/** Request body for POST /api/pair/complete. */
export interface PairCompleteRequest {
  code: string;
  publicKey: JsonWebKey;
  deviceLabel: string;
}

/** Response for POST /api/pair/complete. Returned exactly once. */
export interface PairCompleteResponse {
  deviceId: string;
  token: string;
  deviceLabel: string;
  pairedAt: number;
}

/** Request body for POST /api/pair/ingest. */
export interface PairIngestRequest {
  items: IngestPayload[];
}

export interface PairIngestResponse {
  accepted: number;
  rejected: number;
  errors?: string[];
}
