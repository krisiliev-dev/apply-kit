// Server-only pairing state.
//
// * `pairCodes`  — Map in memory, TTL 10 minutes, GC'd on every access.
// * `devices`    — Map in memory, *mirrored* to `.pairing-devices.json` on every
//                  mutation so pairings survive `npm run dev` restarts.
// * `inbox`      — Ring buffer (Map by posting id) in memory only. On restart,
//                  un-pulled captures are lost; the extension will resync them
//                  on its next alarm tick. This is the honest v1 tradeoff.
//
// TODO(v2): replace `inbox` with a KV store (Vercel KV / Upstash) so that
// the web-app can be served from multiple instances and captures survive
// restarts. The device store can stay file-backed in dev and move to KV in
// prod too. Flagged inline per the task brief.

import "server-only";
import { randomBytes, createHash, randomInt } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { stableId } from "@/lib/discovery/id";
import type { IngestPayload, JobPosting } from "@/lib/discovery/types";
import type {
  DeviceRecord,
  DeviceSummary,
  InboxItem,
  PairCodeEntry,
} from "./types";

const PAIR_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_INBOX = 500;
const DEVICES_FILE = path.join(process.cwd(), ".pairing-devices.json");

// Park everything on globalThis so HMR and multiple route imports share the
// same state within a process. Server-only, so no client concerns.
type Globals = typeof globalThis & {
  __cvMakerPairCodes?: Map<string, PairCodeEntry>;
  __cvMakerDevices?: Map<string, DeviceRecord>;
  __cvMakerDevicesLoaded?: boolean;
  __cvMakerInbox?: InboxItem[];
};

function g(): Globals {
  return globalThis as Globals;
}

function codes(): Map<string, PairCodeEntry> {
  const gl = g();
  if (!gl.__cvMakerPairCodes) gl.__cvMakerPairCodes = new Map();
  return gl.__cvMakerPairCodes;
}

function devicesMap(): Map<string, DeviceRecord> {
  const gl = g();
  if (!gl.__cvMakerDevices) gl.__cvMakerDevices = new Map();
  return gl.__cvMakerDevices;
}

function inbox(): InboxItem[] {
  const gl = g();
  if (!gl.__cvMakerInbox) gl.__cvMakerInbox = [];
  return gl.__cvMakerInbox;
}

// ———————————————————————————————————————————————————————————————
// Device persistence (file-backed, dev-only behavior)
// ———————————————————————————————————————————————————————————————

async function loadDevicesFromDisk(): Promise<void> {
  const gl = g();
  if (gl.__cvMakerDevicesLoaded) return;
  gl.__cvMakerDevicesLoaded = true;
  try {
    const raw = await fs.readFile(DEVICES_FILE, "utf8");
    const parsed = JSON.parse(raw) as DeviceRecord[] | unknown;
    if (!Array.isArray(parsed)) return;
    const m = devicesMap();
    for (const r of parsed) {
      if (isDeviceRecord(r)) m.set(r.deviceId, r);
    }
  } catch (err) {
    // ENOENT is expected on first run. Any other error we swallow — the file
    // is best-effort persistence, not authoritative.
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      console.warn("[pairing] could not read devices file:", err.message);
    }
  }
}

async function flushDevicesToDisk(): Promise<void> {
  const all = Array.from(devicesMap().values());
  try {
    await fs.writeFile(DEVICES_FILE, JSON.stringify(all, null, 2), "utf8");
  } catch (err) {
    console.warn(
      "[pairing] could not write devices file:",
      err instanceof Error ? err.message : err,
    );
  }
}

function isDeviceRecord(r: unknown): r is DeviceRecord {
  if (!r || typeof r !== "object") return false;
  const d = r as Record<string, unknown>;
  return (
    typeof d.deviceId === "string" &&
    typeof d.deviceLabel === "string" &&
    typeof d.tokenHash === "string" &&
    typeof d.pairedAt === "number" &&
    typeof d.lastSeenAt === "number"
  );
}

// ———————————————————————————————————————————————————————————————
// Pair codes
// ———————————————————————————————————————————————————————————————

// Small curated wordlist — memorable, short, no profanity, no similar-looking
// chars. Kept tiny on purpose; entropy comes from word-triple × 10000 digits.
// 60 words × 60 × 60 × 10000 ≈ 2.16B combinations — more than enough for a
// 10-minute window on a single-tenant dev box. Not a security boundary; only
// used for one-time exchange over TLS.
const WORDS = [
  "ASTRID", "BISON", "COBALT", "DAPPER", "EMBER", "FABLE", "GRANITE", "HAWTHORN",
  "INDIGO", "JUNIPER", "KAYAK", "LILAC", "MARIGOLD", "NOMAD", "OPAL", "PONY",
  "QUARTZ", "RAVEN", "SIENNA", "TALON", "UMBER", "VIOLET", "WILLOW", "XENON",
  "YARROW", "ZENITH", "AMBER", "BASALT", "CEDAR", "DUSK", "ECHO", "FERN",
  "GLACIER", "HARBOR", "IVORY", "JADE", "KESTREL", "LUPINE", "MOSS", "NECTAR",
  "ORCHID", "PEBBLE", "QUILL", "RIVER", "SAGE", "TINDER", "UPLAND", "VERDANT",
  "WAVE", "XYLO", "YONDER", "ZEPHYR", "ARROW", "BIRCH", "COMET", "DRIFT",
  "EMBERS", "FALCON", "GROVE", "HELIX",
];

function pickWord(): string {
  return WORDS[randomInt(0, WORDS.length)];
}

function pickWordTriple(): [string, string, string] {
  // Prefer three distinct words for readability. If the pool ever shrinks
  // below 3 this still terminates because the words aren't required unique.
  const a = pickWord();
  let b = pickWord();
  while (b === a && WORDS.length > 1) b = pickWord();
  let c = pickWord();
  while ((c === a || c === b) && WORDS.length > 2) c = pickWord();
  return [a, b, c];
}

function freshCodeString(): string {
  const [a, b, c] = pickWordTriple();
  const n = String(randomInt(1000, 10000));
  return `${a}-${b}-${c}-${n}`;
}

function gcCodes(): void {
  const now = Date.now();
  const m = codes();
  for (const [k, v] of m) {
    if (v.expiresAt < now) m.delete(k);
  }
}

export function mintCode(): PairCodeEntry {
  gcCodes();
  const m = codes();
  // Retry on the 1-in-a-million collision with a live code.
  let code = freshCodeString();
  let tries = 0;
  while (m.has(code) && tries < 5) {
    code = freshCodeString();
    tries++;
  }
  const now = Date.now();
  const entry: PairCodeEntry = {
    code,
    createdAt: now,
    expiresAt: now + PAIR_CODE_TTL_MS,
    status: "pending",
  };
  m.set(code, entry);
  return entry;
}

/** Returns the entry if the code is pending & unexpired, else null. Does not
 * mutate. */
export function peekCode(code: string): PairCodeEntry | null {
  gcCodes();
  const entry = codes().get(code);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

/** Consumes a pair code: marks it bound, writes the deviceId. Returns true
 * if the code was valid & pending, false otherwise. */
export function bindCode(code: string, deviceId: string): boolean {
  gcCodes();
  const entry = codes().get(code);
  if (!entry) return false;
  if (entry.status !== "pending") return false;
  if (entry.expiresAt < Date.now()) return false;
  entry.status = "bound";
  entry.boundDeviceId = deviceId;
  return true;
}

// ———————————————————————————————————————————————————————————————
// Device registration & auth
// ———————————————————————————————————————————————————————————————

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function mintToken(): string {
  // 32 random bytes → 43-char base64url (unpadded). High entropy.
  return randomBytes(32).toString("base64url");
}

function mintDeviceId(): string {
  // 16 random bytes → 22-char base64url. Human-visible suffix only.
  return randomBytes(16).toString("base64url");
}

export async function registerDevice(args: {
  deviceLabel: string;
  publicKey: JsonWebKey;
}): Promise<{ deviceId: string; token: string; record: DeviceRecord }> {
  await loadDevicesFromDisk();
  const deviceId = mintDeviceId();
  const token = mintToken();
  const tokenHash = sha256Hex(token);
  const now = Date.now();
  const record: DeviceRecord = {
    deviceId,
    deviceLabel: args.deviceLabel.slice(0, 80),
    pairedAt: now,
    lastSeenAt: now,
    publicKey: args.publicKey,
    tokenHash,
  };
  devicesMap().set(deviceId, record);
  await flushDevicesToDisk();
  return { deviceId, token, record };
}

export async function validateToken(
  deviceId: string,
  token: string,
): Promise<DeviceRecord | null> {
  await loadDevicesFromDisk();
  const rec = devicesMap().get(deviceId);
  if (!rec) return null;
  if (sha256Hex(token) !== rec.tokenHash) return null;
  return rec;
}

export async function touchDevice(deviceId: string): Promise<void> {
  const rec = devicesMap().get(deviceId);
  if (!rec) return;
  rec.lastSeenAt = Date.now();
  // File-write on every capture would be noisy; we accept eventual durability.
  // Flush explicitly on revoke/register. lastSeenAt drifts at most one dev-
  // server restart, which is acceptable for the summary display.
}

export async function listDevices(): Promise<DeviceSummary[]> {
  await loadDevicesFromDisk();
  return Array.from(devicesMap().values())
    .map(({ tokenHash: _t, ...rest }) => rest)
    .sort((a, b) => b.pairedAt - a.pairedAt);
}

export async function revokeDevice(deviceId: string): Promise<boolean> {
  await loadDevicesFromDisk();
  const m = devicesMap();
  const existed = m.delete(deviceId);
  if (existed) await flushDevicesToDisk();
  return existed;
}

// ———————————————————————————————————————————————————————————————
// Pair inbox (ephemeral buffer; web app pulls it into localStorage)
// ———————————————————————————————————————————————————————————————

function ingestToPosting(payload: IngestPayload): JobPosting {
  return {
    id: stableId([payload.source, payload.url, payload.capturedAt]),
    source: { kind: payload.source },
    url: payload.url,
    title: payload.title,
    company: payload.company,
    location: payload.location,
    salary: payload.salary,
    description: payload.description,
    postedAt: payload.capturedAt,
    fetchedAt: Date.now(),
  };
}

export function appendInboxItem(
  deviceId: string,
  payload: IngestPayload,
): JobPosting {
  const posting = ingestToPosting(payload);
  const buf = inbox();
  // Dedup by posting id.
  const filtered = buf.filter((e) => e.posting.id !== posting.id);
  filtered.push({ posting, receivedAt: Date.now(), deviceId });
  while (filtered.length > MAX_INBOX) filtered.shift();
  (g().__cvMakerInbox = filtered);
  return posting;
}

export function inboxCount(): number {
  return inbox().length;
}

/** Returns all pending items and clears the buffer. */
export function drainInbox(): JobPosting[] {
  const buf = inbox();
  const out = buf.map((e) => e.posting);
  g().__cvMakerInbox = [];
  return out;
}
