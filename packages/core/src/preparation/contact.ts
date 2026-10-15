// Contact details and links: one place for the name (Latin and Cyrillic), the job address, phone,
// city, links and an optional photo, so every CV, letter and portal uses the same ones. One row in
// SQLite; the photo is a hash-named copy in the file store (ADR 0003).
import type { Clock, SqlDatabase } from "../ports.ts";
import { isFileReferenced } from "./file-references.ts";
import type { FileStore } from "./ports.ts";

export interface ContactDetails {
  /** The name as on an English CV. */
  nameLatin: string;
  /** The name as on a Bulgarian CV; may be empty. */
  nameCyrillic: string;
  /** The job address, so portal emails are tracked. */
  email: string;
  /** With the country code, e.g. "+359 88 000 0199". */
  phone: string;
  city: string;
  country: string;
  /** LinkedIn, GitHub, a portfolio: full web addresses. */
  links: string[];
}

export interface ContactPhoto {
  fileName: string;
  sha256: string;
  size: number;
}

export interface Contact extends ContactDetails {
  /** Used only in packages where Kris switches it on. */
  photo: ContactPhoto | null;
}

export type ContactField = keyof ContactDetails | "photo";

export interface ContactProblem {
  field: ContactField;
  message: string;
}

export type SaveContactResult = { saved: true; contact: Contact } | { saved: false; problems: ContactProblem[] };

export interface PhotoInput {
  fileName: string;
  bytes: Uint8Array;
}

const emptyDetails: ContactDetails = { nameLatin: "", nameCyrillic: "", email: "", phone: "", city: "", country: "", links: [] };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface ContactStore {
  get(): Contact;
  save(details: ContactDetails): SaveContactResult;
  setPhoto(photo: PhotoInput): Promise<SaveContactResult>;
  removePhoto(): Promise<Contact>;
}

export function createContactStore({ db, clock, files }: { db: SqlDatabase; clock: Clock; files: FileStore }): ContactStore {
  function get(): Contact {
    const r = db.prepare("SELECT * FROM profile_contact WHERE id = 1").get();
    if (!r) return { ...emptyDetails, photo: null };
    const details = { ...emptyDetails, ...(JSON.parse(String(r.details)) as Partial<ContactDetails>) };
    const photo = r.photo_sha256 == null ? null : { fileName: String(r.photo_name), sha256: String(r.photo_sha256), size: Number(r.photo_size) };
    return { ...details, photo };
  }

  function write(details: ContactDetails, photo: ContactPhoto | null) {
    db.prepare(
      `INSERT INTO profile_contact (id, details, photo_sha256, photo_name, photo_size, updated_at) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET details = excluded.details, photo_sha256 = excluded.photo_sha256,
         photo_name = excluded.photo_name, photo_size = excluded.photo_size, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(details), photo?.sha256 ?? null, photo?.fileName ?? null, photo?.size ?? null, clock.now().toISOString());
  }

  const detailsOf = (c: Contact): ContactDetails => {
    const { nameLatin, nameCyrillic, email, phone, city, country, links } = c;
    return { nameLatin, nameCyrillic, email, phone, city, country, links };
  };

  function save(input: ContactDetails): SaveContactResult {
    const seen = new Set<string>();
    const details: ContactDetails = {
      nameLatin: input.nameLatin.trim(),
      nameCyrillic: input.nameCyrillic.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      city: input.city.trim(),
      country: input.country.trim(),
      // "github.com/mira" is read as https://github.com/mira.
      links: input.links.map((l) => l.trim()).map((l) => (l && !/^[a-z]+:/i.test(l) && /^[^\s/]+\.[^\s/]+/.test(l) ? `https://${l}` : l))
        .filter((l) => l && !seen.has(l) && seen.add(l)),
    };
    const problems: ContactProblem[] = [];
    if (!details.nameLatin) problems.push({ field: "nameLatin", message: "Give your name in Latin script, as on your CV." });
    else if (CYRILLIC.test(details.nameLatin)) problems.push({ field: "nameLatin", message: "Use Latin letters here; your name in Cyrillic has its own field." });
    if (details.email && !EMAIL.test(details.email)) problems.push({ field: "email", message: "Give an email address like name@example.com." });
    const notLink = details.links.find((l) => !isWebAddress(l));
    if (notLink) problems.push({ field: "links", message: `"${notLink}" isn't a web address. Start links with https://.` });
    if (problems.length > 0) return { saved: false, problems };
    write(details, get().photo);
    return { saved: true, contact: get() };
  }

  async function setPhoto({ fileName, bytes }: PhotoInput): Promise<SaveContactResult> {
    if (!isJpegOrPng(bytes)) return { saved: false, problems: [{ field: "photo", message: "Use a JPEG or PNG photo. On a Mac, Preview can export one." }] };
    if (bytes.byteLength > MAX_PHOTO_BYTES) return { saved: false, problems: [{ field: "photo", message: "Use a photo under 5 MB." }] };
    const before = get();
    const stored = await files.put(bytes);
    write(detailsOf(before), { fileName: fileName.trim() || "photo", sha256: stored.sha256, size: stored.size });
    if (before.photo && before.photo.sha256 !== stored.sha256 && !isFileReferenced(db, before.photo.sha256)) await files.remove(before.photo.sha256);
    return { saved: true, contact: get() };
  }

  async function removePhoto(): Promise<Contact> {
    const before = get();
    if (!before.photo) return before;
    write(detailsOf(before), null);
    if (!isFileReferenced(db, before.photo.sha256)) await files.remove(before.photo.sha256);
    return get();
  }

  return { get, save, setPhoto, removePhoto };
}

function isWebAddress(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function isJpegOrPng(b: Uint8Array): boolean {
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v);
  return jpeg || png;
}
