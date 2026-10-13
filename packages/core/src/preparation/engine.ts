// The preparation engine: Prepare's deep module, beside the discovery engine and sharing its
// database, clock, settings and AI budget. It will own the master profile, angles, answer bank,
// voice, imports, the coach interview and packages (spec #51); each ticket adds its operations here.
import { createHash } from "node:crypto";
import { migrate } from "../schema.ts";
import type { BudgetInfo } from "../budget.ts";
import { createContactStore, type Contact, type ContactDetails, type PhotoInput, type SaveContactResult } from "./contact.ts";
import { createImportStore, type ImportInput, type ImportMerge, type ImportRun, type ImportStatus, type ResolveResult, type StartImportResult, type UnreadableChoice } from "./import.ts";
import { createProfileStore, type DeletedPiece, type PieceInput, type ProfilePiece, type PieceList, type PieceOrigin, type PieceQuery, type ProfileSummary, type SavePieceResult } from "./profile.ts";

/** The whole profile as one portable file: every piece with its source, the contact details and photo. */
export interface ProfileExport {
  format: "apply-kit master profile";
  version: 1;
  exportedAt: string;
  contact: Omit<Contact, "photo"> & { photo: (NonNullable<Contact["photo"]> & { base64: string }) | null };
  pieces: ProfilePiece[];
  /** Every source pieces came from (a file, a conversation, Kris by hand), with how many pieces each gave. */
  sources: { from: string; pieces: number }[];
}

import { checkAts, type AtsCheck, type AtsKeyword } from "../documents/ats.ts";
import { documentFileName, type FileNameParts } from "../documents/file-names.ts";
import type { DocumentToRender } from "../documents/content.ts";
import { demoDocument, demoFileName, type DemoOptions } from "../documents/demo.ts";
import type { PdfText, PreparationDeps } from "./ports.ts";

export interface DraftRequest {
  packageId: string;
  document: DocumentToRender;
  /** What the file is named after: Kris's name (Latin), the company and the role. */
  fileName: FileNameParts;
  /** The target posting's keywords, for the ATS check (CV only). */
  keywords?: AtsKeyword[];
}

export interface DocumentDraft {
  /** ASCII, "Name_CV_Company_Role.pdf". */
  fileName: string;
  /** Where the draft is, relative to the data folder. */
  path: string;
  pdf: Uint8Array;
  sha256: string;
  size: number;
  /** Read from the PDF itself. */
  pages: number;
  /** Set when the content ran past one page: reported, never fixed by shrinking type or margins. */
  overflow: { pages: number; linesAfterFirstPage: number } | null;
  /** The text read back from the PDF, the way a parser reads it. */
  text: PdfText;
  /** The parse check over that text; CVs only (null for a cover letter). */
  ats: AtsCheck | null;
}

export interface PreparationEngine {
  /** This month's AI spending against the cap, shared with Discover, so Prepare can say when a part must wait. */
  budget(): BudgetInfo;

  /**
   * Adds a piece (no id) or saves an edit to one, after the honesty checks. A refused piece comes back
   * with every problem, each tied to its field, and one-click honest fixes where there are any.
   * Kris's own pieces are confirmed; import, the coach and packages pass where theirs came from.
   */
  savePiece(input: PieceInput, origin?: PieceOrigin): SavePieceResult;
  /**
   * Deletes a piece. Pieces under a deleted role stay, tied to no role. Packages already approved or
   * submitted keep their files as they are.
   */
  deletePiece(id: string): DeletedPiece;
  /** How many pieces Profile holds, and what waits for Kris in each section (for the nav badge). */
  profileSummary(): ProfileSummary;
  /** Contact details and links, the same in every CV, letter and portal. Empty until Kris saves them. */
  contact(): Contact;
  saveContact(details: ContactDetails): SaveContactResult;
  /** Keeps a JPEG or PNG photo (replacing the one before); it goes only into packages where Kris switches it on. */
  setPhoto(photo: PhotoInput): Promise<SaveContactResult>;
  removePhoto(): Promise<Contact>;
  /** Everything in Profile, for the one-click JSON export. */
  exportProfile(): Promise<ProfileExport>;
  /**
   * Kris checked a drafted piece and it's true: it becomes confirmed, once it has what a confirmed
   * piece needs (months, where a number comes from); otherwise it comes back with the problems.
   */
  confirmPiece(id: string): SavePieceResult;
  /**
   * Imports old CVs (PDF, DOCX, TXT), the LinkedIn export, a GitHub profile and a portfolio page:
   * files are copied into the file store, their text is read on this laptop, and only that text goes
   * to the writer. Sources are read one after another; each one's pieces are in Profile, unconfirmed,
   * as soon as it finishes, with near-duplicates merged into the piece already there. `done` resolves
   * once every source has finished, couldn't be read, or waits for the budget.
   */
  startImport(input: ImportInput): Promise<StartImportResult>;
  /** An import's progress and results (the latest one without an id); null if there's none. */
  importStatus(id?: string): ImportStatus | null;
  /** Stops reading: sources not started are cancelled, a draft in progress is dropped, finished pieces stay. */
  cancelImport(id: string): ImportStatus | null;
  /** Reads the sources that waited for the budget, or were cancelled or interrupted. */
  resumeImport(id: string): ImportRun | null;
  /** What to do with a source that couldn't be read: text recognition, a text version, try again, or skip. */
  resolveUnreadable(itemId: string, choice: UnreadableChoice): Promise<ResolveResult>;
  /** Every source an import merged into a piece already there ("See merges"). */
  importMerges(id: string): ImportMerge[];
  /** One piece, for editing; null once it's deleted. */
  piece(id: string): ProfilePiece | null;
  /** The master profile grouped by role (roles, then education, then pieces tied to neither), filtered. */
  listPieces(query?: PieceQuery): PieceList;
  /**
   * Prints a document from its fixed template, keeps it as the package's draft of that document,
   * and reads it back: page count, overflow and (for a CV) the ATS check come from the PDF itself.
   */
  draftDocument(request: DraftRequest): Promise<DocumentDraft>;
  /** Drafts one of the fictional demo profile's documents (package "demo"), for checking the template. */
  demoDocument(options: DemoOptions): Promise<DocumentDraft>;
}

export function createPreparationEngine(deps: PreparationDeps): PreparationEngine {
  migrate(deps.db);
  const profile = createProfileStore(deps);
  const contact = createContactStore(deps);
  const imports = createImportStore(deps, profile);

  async function draftDocument({ packageId, document, fileName: parts, keywords }: DraftRequest): Promise<DocumentDraft> {
    const fileName = documentFileName(document.kind, parts);
    const { pdf } = await deps.renderer.render(document);
    const { path } = await deps.packages.saveDraft(packageId, document.kind, fileName, pdf);
    const text = await deps.pdfReader.read(pdf);
    const pages = text.pages.length;
    const linesAfterFirstPage = text.pages.slice(1).reduce((n, p) => n + p.lines.length, 0);
    return {
      fileName,
      path,
      pdf,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      size: pdf.byteLength,
      pages,
      overflow: pages > 1 ? { pages, linesAfterFirstPage } : null,
      text,
      ats: document.kind === "cv" ? checkAts({ text, document, fileName, keywords }) : null,
      };
  }

  return {
    budget: () => deps.budget.info(),
    draftDocument,
    demoDocument: (options) => draftDocument({ packageId: "demo", document: demoDocument(options), fileName: demoFileName }),
    savePiece: (input, origin) => profile.save(input, origin),
    deletePiece: (id) => profile.remove(id),
    confirmPiece: (id) => profile.confirm(id),
    startImport: (input) => imports.start(input),
    importStatus: (id) => imports.status(id),
    cancelImport: (id) => imports.cancel(id),
    resumeImport: (id) => imports.resume(id),
    resolveUnreadable: (itemId, choice) => imports.resolve(itemId, choice),
    importMerges: (id) => imports.merges(id),
    piece: (id) => profile.get(id),
    listPieces: (query) => profile.list(query),
    profileSummary: () => profile.summary(),
    contact: () => contact.get(),
    saveContact: (details) => contact.save(details),
    setPhoto: (photo) => contact.setPhoto(photo),
    removePhoto: () => contact.removePhoto(),
    async exportProfile() {
      const { photo, ...details } = contact.get();
      const bytes = photo ? await deps.files.get(photo.sha256) : null;
      const pieces = profile.all();
      const sources = new Map<string, number>();
      for (const p of pieces) sources.set(p.source.from, (sources.get(p.source.from) ?? 0) + 1);
      return {
        format: "apply-kit master profile",
        version: 1,
        exportedAt: deps.clock.now().toISOString(),
        contact: { ...details, photo: photo && bytes ? { ...photo, base64: Buffer.from(bytes).toString("base64") } : null },
        pieces,
        sources: [...sources].map(([from, n]) => ({ from, pieces: n })),
      };
    },
  };
}
