import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AnswerRecord, CapturedJob } from "../shared/types";

const DB_NAME = "cv-autofill";
// v2 adds the discoveryQueue object store. Opening an older client will run
// the upgrade in-place without losing the existing answers store.
const DB_VERSION = 2;
const STORE = "answers" as const;
const BY_QUESTION = "by-question" as const;
const JOB_STORE = "discoveryQueue" as const;
const BY_SYNC = "by-synced" as const;
const BY_URL = "by-url" as const;

// Internally we denormalize `syncedToWebApp` -> `syncedFlag` (0|1) because
// IndexedDB cursor keyRanges on boolean values behave inconsistently across
// engines. The DB schema stores JobRow; callers always see CapturedJob.
type JobRow = CapturedJob & { syncedFlag: 0 | 1 };

interface AutofillDB extends DBSchema {
  [STORE]: {
    key: string;
    value: AnswerRecord;
    indexes: {
      [BY_QUESTION]: string;
    };
  };
  [JOB_STORE]: {
    key: string;
    value: JobRow;
    indexes: {
      [BY_SYNC]: number;
      [BY_URL]: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<AutofillDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<AutofillDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AutofillDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex(BY_QUESTION, "questionNormalized", { unique: false });
        }
        if (oldVersion < 2) {
          const jobs = db.createObjectStore(JOB_STORE, { keyPath: "id" });
          jobs.createIndex(BY_SYNC, "syncedFlag", { unique: false });
          jobs.createIndex(BY_URL, "url", { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

export async function putRecord(rec: AnswerRecord): Promise<void> {
  const db = await getDB();
  await db.put(STORE, rec);
}

export async function getById(id: string): Promise<AnswerRecord | undefined> {
  const db = await getDB();
  return db.get(STORE, id);
}

export async function getByQuestion(
  questionNormalized: string,
): Promise<AnswerRecord | undefined> {
  const db = await getDB();
  return db.getFromIndex(STORE, BY_QUESTION, questionNormalized);
}

export async function allRecords(): Promise<AnswerRecord[]> {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function deleteById(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function clearAll(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE);
}

// --- Discovery queue ---

function toRow(job: CapturedJob): JobRow {
  return { ...job, syncedFlag: job.syncedToWebApp ? 1 : 0 };
}

function fromRow(row: JobRow): CapturedJob {
  // Strip the internal flag before handing back to callers.
  const { syncedFlag: _flag, ...rest } = row;
  void _flag;
  return rest;
}

export async function putJob(job: CapturedJob): Promise<void> {
  const db = await getDB();
  await db.put(JOB_STORE, toRow(job));
}

export async function getJob(id: string): Promise<CapturedJob | undefined> {
  const db = await getDB();
  const row = await db.get(JOB_STORE, id);
  return row ? fromRow(row) : undefined;
}

export async function getJobByUrl(url: string): Promise<CapturedJob | undefined> {
  const db = await getDB();
  const row = await db.getFromIndex(JOB_STORE, BY_URL, url);
  return row ? fromRow(row) : undefined;
}

export async function allJobs(): Promise<CapturedJob[]> {
  const db = await getDB();
  const rows = await db.getAll(JOB_STORE);
  return rows.map(fromRow);
}

export async function unsyncedJobs(): Promise<CapturedJob[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex(JOB_STORE, BY_SYNC, 0);
  return rows.map(fromRow);
}

export async function deleteJob(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(JOB_STORE, id);
}
