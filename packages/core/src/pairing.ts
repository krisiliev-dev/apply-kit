// Pairing the Chrome extension with the local service (ARCHITECTURE.md: "paired once with a code the
// user approves"). Kris asks the app for a code, types it into the extension, and the extension gets
// a token it sends with every request. Only a hash of each token is kept, so the database never holds
// one. The service rejects any extension request without a known token.
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Clock, SqlDatabase } from "./ports.ts";
import { migrate } from "./schema.ts";

/** How long a pairing code works. */
const codeLifetimeMs = 10 * 60_000;
/** Wrong tries before a code is thrown away (a 6-digit code can't be guessed in 5). */
const maxWrongTries = 5;

export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastUsedAt: string;
}

export type PairResult =
  | { ok: true; token: string; deviceId: string }
  /** no-code: none is waiting (never asked for, used, or thrown away after wrong tries). */
  | { ok: false; problem: "no-code" | "expired" | "wrong-code" };

export interface Pairing {
  /** A new 6-digit code for the app to show; it replaces any code still waiting. */
  startPairing(): { code: string; expiresAt: string };
  /** The extension trades the code for its token (once). */
  pair(code: string, deviceName: string): PairResult;
  /** Whether a request's token belongs to a paired extension. */
  verify(token: string): boolean;
  devices(): PairedDevice[];
  /** Forgets an extension: its token stops working. */
  unpair(deviceId: string): void;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function createPairing({ db, clock }: { db: SqlDatabase; clock: Clock }): Pairing {
  migrate(db);
  const now = () => clock.now().toISOString();

  return {
    startPairing() {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const expiresAt = new Date(clock.now().getTime() + codeLifetimeMs).toISOString();
      db.prepare("DELETE FROM pairing_code").run();
      db.prepare("INSERT INTO pairing_code (code, expires_at, wrong_tries) VALUES (?, ?, 0)").run(code, expiresAt);
      return { code, expiresAt };
    },

    pair(code, deviceName) {
      const waiting = db.prepare("SELECT code, expires_at, wrong_tries FROM pairing_code").get();
      if (!waiting) return { ok: false, problem: "no-code" };
      if (String(waiting.expires_at) <= now()) {
        db.prepare("DELETE FROM pairing_code").run();
        return { ok: false, problem: "expired" };
      }
      if (code.replace(/\D/g, "") !== String(waiting.code)) {
        const tries = Number(waiting.wrong_tries) + 1;
        if (tries >= maxWrongTries) db.prepare("DELETE FROM pairing_code").run();
        else db.prepare("UPDATE pairing_code SET wrong_tries = ?").run(tries);
        return { ok: false, problem: "wrong-code" };
      }
      db.prepare("DELETE FROM pairing_code").run();
      const token = randomBytes(32).toString("base64url");
      const deviceId = `device:${randomBytes(8).toString("hex")}`;
      const at = now();
      db.prepare("INSERT INTO extension_device (id, name, token_hash, paired_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
        .run(deviceId, deviceName.trim().slice(0, 80) || "Chrome extension", hash(token), at, at);
      return { ok: true, token, deviceId };
    },

    verify(token) {
      if (!token) return false;
      const device = db.prepare("SELECT id FROM extension_device WHERE token_hash = ?").get(hash(token));
      if (!device) return false;
      db.prepare("UPDATE extension_device SET last_used_at = ? WHERE id = ?").run(now(), String(device.id));
      return true;
    },

    devices() {
      return db.prepare("SELECT id, name, paired_at, last_used_at FROM extension_device ORDER BY paired_at, id").all().map((r) => ({
        id: String(r.id), name: String(r.name), pairedAt: String(r.paired_at), lastUsedAt: String(r.last_used_at),
      }));
    },

    unpair(deviceId) {
      db.prepare("DELETE FROM extension_device WHERE id = ?").run(deviceId);
    },
  };
}
