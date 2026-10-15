// Dependencies the preparation engine needs from the outside world besides the ones it shares with
// the discovery engine (database, clock, settings, the AI budget). The service passes real ones;
// tests pass fakes (see test/preparation-harness.ts).
import type { AiBudget } from "../budget.ts";
import type { Clock, Settings, SqlDatabase } from "../ports.ts";
import type { Writer } from "../writing/writer.ts";
import type { DocumentKind, DocumentToRender } from "../documents/content.ts";

export type { DocumentKind, DocumentLanguage, DocumentToRender } from "../documents/content.ts";

export interface RenderedDocument {
  pdf: Uint8Array;
  /** Read from the PDF itself, so overflow onto a second page shows. */
  pages: number;
}

/** Prints documents (headless Chromium in the service). */
export interface DocumentRenderer {
  render(document: DocumentToRender): Promise<RenderedDocument>;
}

/** A PDF's text the way a parser reads it: pages of lines, in reading order. No text layer → no lines. */
export interface PdfText {
  pages: { lines: string[] }[];
}

/** Extracts text from a PDF (pdf.js in the service), for import and the ATS check. Local only. */
export interface PdfTextReader {
  read(pdf: Uint8Array): Promise<PdfText>;
}

/**
 * Reads the text off a scanned PDF's page images (text recognition), on this laptop. Scans misread,
 * so pieces drafted from what it reads are marked "check this". Throws when it can't run here.
 */
export interface TextRecognizer {
  recognise(pdf: Uint8Array): Promise<PdfText>;
}

export interface StoredFile {
  /** SHA-256 of the bytes, hex: also the file's name in the files folder. */
  sha256: string;
  size: number;
}

/**
 * Files Kris brings (old CVs, the LinkedIn export, voice samples, the photo), kept as hash-named
 * copies in the `files/` folder beside the database (ADR 0003). Their names and types live in the database.
 */
export interface FileStore {
  /** Stores the bytes under their SHA-256; the same bytes stored twice are kept once. */
  put(bytes: Uint8Array): Promise<StoredFile>;
  /** The stored bytes, or null if no file has this hash. */
  get(sha256: string): Promise<Uint8Array | null>;
  /** Deletes the copy; removing a missing file does nothing. */
  remove(sha256: string): Promise<void>;
}

/**
 * Generated PDFs, in `packages/<package id>/` beside the database (ADR 0003). A draft render
 * replaces the previous draft of the same document; approved files are frozen beside them (#67).
 */
export interface PackageFolder {
  /** Writes the draft and returns where it is, relative to the data folder ("packages/<id>/<file name>"). */
  saveDraft(packageId: string, kind: DocumentKind, fileName: string, bytes: Uint8Array): Promise<{ path: string }>;
  /**
   * Freezes an approved file: written once to "packages/<id>/v<version>/<file name>" and never
   * rewritten, and copied to Kris's Packages folder (a setting, inside Documents by default). `copy`
   * is where the copy went, or null if it couldn't be written (the frozen file still counts).
   */
  freeze(packageId: string, version: number, fileName: string, bytes: Uint8Array): Promise<{ path: string; copy: string | null }>;
  /** The file at a path `saveDraft` or `freeze` returned, or null if it isn't there (any other path is refused). */
  read(path: string): Promise<Uint8Array | null>;
}

export interface PreparationDeps {
  db: SqlDatabase;
  clock: Clock;
  /** The monthly AI budget shared with the discovery engine: one cap over extraction and writing. */
  budget: AiBudget;
  writer: Writer;
  renderer: DocumentRenderer;
  pdfReader: PdfTextReader;
  files: FileStore;
  packages: PackageFolder;
  /** Named settings. Missing means every setting is unset. */
  settings?: Settings;
  /** For import: the public GitHub API and a portfolio page. Missing means links can't be read. */
  fetch?: typeof fetch;
  /** Text recognition for scanned PDFs. Missing means it isn't offered. */
  recognizer?: TextRecognizer;
}
