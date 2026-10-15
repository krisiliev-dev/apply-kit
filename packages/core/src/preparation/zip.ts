// Reads the entries of a .zip file (a DOCX is one, and so is the LinkedIn export) from its central
// directory, on this laptop. Stored and deflated entries only, which is what Word and LinkedIn write.
import { inflateRawSync } from "node:zlib";

/** The file isn't a zip, or uses something this reader doesn't handle. */
export class ZipError extends Error {}

/** Every entry's name and bytes; directories are left out. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits in the last 64 KB + 22 bytes (after an optional comment).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new ZipError("not a zip file");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new ZipError("damaged zip directory");
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ZipError("damaged zip entry");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (method === 0) entries.set(name, new Uint8Array(data));
    else if (method === 8) entries.set(name, new Uint8Array(inflateRawSync(data)));
    else throw new ZipError(`unsupported compression in ${name}`);
  }
  return entries;
}
