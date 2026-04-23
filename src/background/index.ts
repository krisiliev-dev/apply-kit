import { nanoid } from "nanoid";
import type {
  AnswerRecord,
  BgRequest,
  BgResponse,
  HistoricalAnswer,
} from "../shared/types";
import {
  allRecords,
  deleteById,
  getById,
  getByQuestion,
  putRecord,
} from "../store/db";
import { findBestMatch } from "../store/match";

// Service worker. Owns the IndexedDB connection.
// All DB access from content scripts / popup goes through this message bus so
// we only have one writer and no race-conditiony interleaving.

chrome.runtime.onInstalled.addListener(() => {
  console.info("[cv-autofill] installed");
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
      // TODO: call CV-maker paraphrase/embedding API when wired.
      return { kind: "embedQuestion", vector: null };
    }
  }
}

function latestAt(r: AnswerRecord): number {
  const last = r.answers[r.answers.length - 1];
  return last ? last.at : 0;
}
