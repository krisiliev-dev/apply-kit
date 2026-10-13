// The preparation engine: Prepare's deep module, beside the discovery engine and sharing its
// database, clock, settings and AI budget. It will own the master profile, angles, answer bank,
// voice, imports, the coach interview and packages (spec #51); each ticket adds its operations here.
import { createHash } from "node:crypto";
import { migrate } from "../schema.ts";
import type { BudgetInfo } from "../budget.ts";
import { createContactStore, type Contact, type ContactDetails, type PhotoInput, type SaveContactResult } from "./contact.ts";
import { createAngleStore, type AngleChoice, type AnglePosting, type AngleView, type SaveAngleInput, type SaveAngleResult } from "./angles.ts";
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
  /** One piece, for editing; null once it's deleted. */
  piece(id: string): ProfilePiece | null;
  /** The master profile grouped by role (roles, then education, then pieces tied to neither), filtered. */
  listPieces(query?: PieceQuery): PieceList;
  /**
   * Prints a document from its fixed template, keeps it as the package's draft of that document,
   * and reads it back: page count, overflow and (for a CV) the ATS check come from the PDF itself.
   */
  draftDocument(request: DraftRequest): Promise<DocumentDraft>;
  /** The three angles (developer, security, design), each with its summary line, leads and whether it's thin. */
  angles(): AngleView[];
  /**
   * Saves an angle's summary line, its lead order (piece ids, first leads), or both. Only confirmed
   * pieces of that angle can lead. The next package for a Job of this angle starts from them.
   */
  saveAngle(input: SaveAngleInput): SaveAngleResult;
  /**
   * The angle a package for this Job starts from: the closest one by Discover's angle keywords and
   * the tags of Kris's confirmed pieces, with the reason.
   */
  closestAngle(posting: AnglePosting): AngleChoice;
  /** Drafts one of the fictional demo profile's documents (package "demo"), for checking the template. */
  demoDocument(options: DemoOptions): Promise<DocumentDraft>;
}

export function createPreparationEngine(deps: PreparationDeps): PreparationEngine {
  migrate(deps.db);
  const profile = createProfileStore(deps);
  const contact = createContactStore(deps);
  const angles = createAngleStore({ db: deps.db, clock: deps.clock, pieces: () => profile.all() });

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
    angles: () => angles.list(),
    saveAngle: (input) => angles.save(input),
    closestAngle: (posting) => angles.closest(posting),
    savePiece: (input, origin) => profile.save(input, origin),
    deletePiece: (id) => profile.remove(id),
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
