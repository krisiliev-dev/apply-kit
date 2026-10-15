// The file store keeps each file once, under its SHA-256, so the same bytes can be a contact photo,
// an imported file and a voice sample at once. A remover deletes the copy only when no table still
// refers to it; every table that stores a file's SHA-256 is listed here.
import type { SqlDatabase } from "../ports.ts";

const referrers = [
  "SELECT 1 AS x FROM profile_contact WHERE photo_sha256 = ?",
  "SELECT 1 AS x FROM import_item WHERE sha256 = ?",
  "SELECT 1 AS x FROM voice_sample WHERE sha256 = ?",
];

/** Whether anything still uses the file with this SHA-256 (call it after removing the remover's own row). */
export function isFileReferenced(db: SqlDatabase, sha256: string): boolean {
  return referrers.some((sql) => !!db.prepare(sql).get(sha256));
}
