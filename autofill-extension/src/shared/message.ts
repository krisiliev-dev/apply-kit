import type { BgRequest, BgResponse } from "./types";

// Thin typed wrapper over chrome.runtime.sendMessage so callers don't
// stringly-type the request kinds. Narrows the response by discriminant.

export async function sendToBackground<K extends BgRequest["kind"]>(
  req: Extract<BgRequest, { kind: K }>,
): Promise<Extract<BgResponse, { kind: K }> | Extract<BgResponse, { kind: "error" }>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(req, (resp: BgResponse) => {
      if (chrome.runtime.lastError) {
        resolve({ kind: "error", message: chrome.runtime.lastError.message ?? "unknown error" });
        return;
      }
      resolve(
        resp as
          | Extract<BgResponse, { kind: K }>
          | Extract<BgResponse, { kind: "error" }>,
      );
    });
  });
}
