import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AnswerRecord } from "../shared/types";

const DB_NAME = "cv-autofill";
const DB_VERSION = 1;
const STORE = "answers" as const;
const BY_QUESTION = "by-question" as const;

interface AutofillDB extends DBSchema {
  [STORE]: {
    key: string;
    value: AnswerRecord;
    indexes: {
      [BY_QUESTION]: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<AutofillDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<AutofillDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AutofillDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex(BY_QUESTION, "questionNormalized", { unique: false });
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
