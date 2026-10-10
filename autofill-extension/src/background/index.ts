import { nanoid } from "nanoid";
import type {
  AnswerRecord,
  BgRequest,
  BgResponse,
  CapturedJob,
  HistoricalAnswer,
  PairedDeviceSummary,
} from "../shared/types";
import {
  clearPairing,
  generatePublicJwk,
  getPairing,
  normalizeWebAppUrl,
  setPairing,
  type PairedDeviceState,
} from "../shared/pairing";
import {
  allJobs,
  allRecords,
  deleteById,
  deleteJob,
  getById,
  getByQuestion,
  getJob,
  getJobByUrl,
  putJob,
  putRecord,
} from "../store/db";
import { findBestMatch } from "../store/match";
import { getConfig, setBaseUrl } from "../shared/config";
import { syncAll, syncOne } from "./discoverySync";
import { paraphrase } from "../paraphrase";

// Service worker. Owns the IndexedDB connection.
// All DB access from content scripts / popup goes through this message bus so
// we only have one writer and no race-conditiony interleaving.

chrome.runtime.onInstalled.addListener(() => {
  console.info("[cv-autofill] installed");
  // Ensure the background sync alarm exists. Safe to call repeatedly — if an
  // alarm with the same name exists it's replaced. 5-minute period balances
  // timeliness (captures land within minutes of going offline) with idle
  // resource use.
  chrome.alarms.create("sync-discovery", { periodInMinutes: 5 });
});

// Startup rehydration: if the alarm was cleared by browser restart, re-add it.
chrome.runtime.onStartup?.addListener(() => {
  chrome.alarms.create("sync-discovery", { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "sync-discovery") return;
  // Fire-and-forget; errors are recorded via console and the JobSyncResult's
  // error field. We don't await — the alarm doesn't care.
  void syncAll().catch((err) => {
    console.warn("[cv-autofill] background sync failed:", err);
  });
});

chrome.runtime.onMessage.addListener(
  (req: BgRequest, _sender, sendResponse: (r: BgResponse) => void) => {
    handle(req)
      .then(sendResponse)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[cv-autofill] bg error", err);
        sendResponse({ kind: "error", message });
      });
    // Returning true keeps the message channel open for the async response.
    return true;
  },
);

async function handle(req: BgRequest): Promise<BgResponse> {
  switch (req.kind) {
    case "queryByQuestion": {
      const match = await findBestMatch(req.field);
      return { kind: "queryByQuestion", match };
    }

    case "saveAnswer": {
      const existing = await getByQuestion(req.field.questionNormalized);
      const newAns: HistoricalAnswer = {
        value: req.value,
        at: Date.now(),
        url: req.url,
      };
      const record: AnswerRecord = existing
        ? {
            ...existing,
            // Dedupe: don't append a new history entry if value is identical to the last one.
            answers:
              existing.answers[existing.answers.length - 1]?.value === req.value
                ? existing.answers
                : [...existing.answers, newAns],
            questionLabel: req.field.label || existing.questionLabel,
            fieldKind: existing.fieldKind,
          }
        : {
            id: nanoid(),
            questionNormalized: req.field.questionNormalized,
            questionLabel: req.field.label,
            fieldKind: req.field.kind,
            answers: [newAns],
          };
      await putRecord(record);
      return { kind: "saveAnswer", record };
    }

    case "listAnswers": {
      const all = await allRecords();
      const q = req.query?.trim().toLowerCase() ?? "";
      const filtered = q
        ? all.filter(
            (r) =>
              r.questionLabel.toLowerCase().includes(q) ||
              r.questionNormalized.includes(q) ||
              r.answers.some((a) => a.value.toLowerCase().includes(q)),
          )
        : all;
      // Stable-ish order: most recently-answered first.
      filtered.sort((a, b) => latestAt(b) - latestAt(a));
      return { kind: "listAnswers", records: filtered };
    }

    case "deleteAnswer": {
      await deleteById(req.id);
      return { kind: "deleteAnswer", ok: true };
    }

    case "updateAnswer": {
      const rec = await getById(req.id);
      if (!rec) throw new Error(`record ${req.id} not found`);
      const next: AnswerRecord = {
        ...rec,
        answers: [
          ...rec.answers,
          { value: req.value, at: Date.now(), url: "popup-edit" },
        ],
      };
      await putRecord(next);
      return { kind: "updateAnswer", record: next };
    }

    case "exportAll": {
      const records = await allRecords();
      return { kind: "exportAll", records };
    }

    case "importAll": {
      if (req.mode === "replace") {
        const current = await allRecords();
        for (const r of current) await deleteById(r.id);
      }
      let imported = 0;
      for (const r of req.records) {
        // Minimal shape validation; bail on obvious junk instead of trusting blindly.
        if (
          typeof r?.id === "string" &&
          typeof r?.questionNormalized === "string" &&
          Array.isArray(r?.answers)
        ) {
          await putRecord(r);
          imported++;
        }
      }
      return { kind: "importAll", imported };
    }

    case "embedQuestion": {
      // TODO: call CV-maker embedding API when wired. Paraphrase is already
      // live — embeddings are a separate, heavier endpoint.
      return { kind: "embedQuestion", vector: null };
    }

    case "captureJob": {
      // De-dupe by URL — if the user clicked the pill twice on the same
      // posting we update the existing record instead of spawning a second.
      const existing = await getJobByUrl(req.job.url);
      const record: CapturedJob = existing
        ? {
            ...existing,
            title: req.job.title || existing.title,
            company: req.job.company || existing.company,
            location: req.job.location ?? existing.location,
            salary: req.job.salary ?? existing.salary,
            description: req.job.description ?? existing.description,
            postedAt: req.job.postedAt ?? existing.postedAt,
            // A re-capture means the data may have changed — reset sync.
            syncedToWebApp: false,
            capturedAt: Date.now(),
          }
        : {
            id: nanoid(),
            source: req.job.source,
            url: req.job.url,
            title: req.job.title,
            company: req.job.company,
            location: req.job.location,
            salary: req.job.salary,
            description: req.job.description,
            postedAt: req.job.postedAt,
            capturedAt: Date.now(),
            syncedToWebApp: false,
          };
      await putJob(record);

      // Best-effort immediate sync — if it fails, syncAll() will catch up later.
      const outcome = await syncOne(record);
      const final = outcome.synced
        ? { ...record, syncedToWebApp: true }
        : record;
      return { kind: "captureJob", job: final, synced: outcome.synced };
    }

    case "listJobs": {
      const jobs = await allJobs();
      jobs.sort((a, b) => b.capturedAt - a.capturedAt);
      return { kind: "listJobs", jobs };
    }

    case "deleteJob": {
      await deleteJob(req.id);
      return { kind: "deleteJob", ok: true };
    }

    case "syncDiscoveryQueue": {
      const result = await syncAll();
      return { kind: "syncDiscoveryQueue", result };
    }

    case "syncJob": {
      const job = await getJob(req.id);
      if (!job) throw new Error(`job ${req.id} not found`);
      const outcome = await syncOne(job);
      const final = outcome.synced ? { ...job, syncedToWebApp: true } : job;
      return { kind: "syncJob", job: final, synced: outcome.synced };
    }

    case "getConfig": {
      const cfg = await getConfig();
      return { kind: "getConfig", cvMakerBaseUrl: cfg.cvMakerBaseUrl };
    }

    case "setConfig": {
      const value = await setBaseUrl(req.cvMakerBaseUrl);
      return { kind: "setConfig", cvMakerBaseUrl: value };
    }

    case "getPairing": {
      const p = await getPairing();
      return {
        kind: "getPairing",
        pairing: p ? toSummary(p) : null,
      };
    }

    case "completePairing": {
      const webAppUrl = normalizeWebAppUrl(req.webAppUrl);
      if (!webAppUrl) throw new Error("Invalid web-app URL.");
      const code = req.code.trim().toUpperCase();
      if (!code) throw new Error("Pair code required.");
      const label = req.deviceLabel.trim() || "Chrome";

      // Generate the keypair and call the web-app's /api/pair/complete. On
      // success we persist the token + deviceId in chrome.storage.sync.
      const publicKey = await generatePublicJwk();
      const res = await fetch(`${webAppUrl}/api/pair/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, publicKey, deviceLabel: label }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as {
        deviceId: string;
        token: string;
        deviceLabel: string;
        pairedAt: number;
      };
      const state: PairedDeviceState = {
        webAppUrl,
        deviceId: data.deviceId,
        deviceToken: data.token,
        deviceLabel: data.deviceLabel,
        pairedAt: data.pairedAt,
        lastSyncAt: 0,
        publicKey,
      };
      await setPairing(state);

      // Kick off an immediate sync so the user sees captures flow without
      // waiting for the next alarm tick.
      void syncAll().catch(() => {});

      return {
        kind: "completePairing",
        pairing: toSummary(state),
      };
    }

    case "unpair": {
      const p = await getPairing();
      if (p) {
        // Best-effort notify the web-app so the device disappears from its
        // list. Ignore failures — local state wins.
        try {
          await fetch(`${p.webAppUrl}/api/pair/revoke`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ deviceId: p.deviceId }),
          });
        } catch {
          // offline / unreachable — carry on and clear local state anyway
        }
      }
      await clearPairing();
      return { kind: "unpair", ok: true };
    }

    case "paraphrase": {
      const next = await paraphrase(req.text, req.context);
      return { kind: "paraphrase", text: next, changed: next !== req.text };
    }
  }
}

function latestAt(r: AnswerRecord): number {
  const last = r.answers[r.answers.length - 1];
  return last ? last.at : 0;
}

function toSummary(p: PairedDeviceState): PairedDeviceSummary {
  return {
    webAppUrl: p.webAppUrl,
    deviceId: p.deviceId,
    deviceLabel: p.deviceLabel,
    pairedAt: p.pairedAt,
    lastSyncAt: p.lastSyncAt,
  };
}
