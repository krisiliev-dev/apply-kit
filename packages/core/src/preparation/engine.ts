// The preparation engine: Prepare's deep module, beside the discovery engine and sharing its
// database, clock, settings and AI budget. It will own the master profile, angles, answer bank,
// voice, imports, the coach interview and packages (spec #51); each ticket adds its operations here.
import { createHash } from "node:crypto";
import { migrate } from "../schema.ts";
import type { BudgetInfo } from "../budget.ts";
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
   * Prints a document from its fixed template, keeps it as the package's draft of that document,
   * and reads it back: page count, overflow and (for a CV) the ATS check come from the PDF itself.
   */
  draftDocument(request: DraftRequest): Promise<DocumentDraft>;
  /** Drafts one of the fictional demo profile's documents (package "demo"), for checking the template. */
  demoDocument(options: DemoOptions): Promise<DocumentDraft>;
}

export function createPreparationEngine(deps: PreparationDeps): PreparationEngine {
  migrate(deps.db);

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
  };
}
