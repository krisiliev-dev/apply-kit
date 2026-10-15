// A preparation engine for one evaluation package: its own empty in-memory database (so nothing
// touches Kris's profile or packages), its own budget (what is left of the month's), files in memory,
// and the package's PDFs printed into the run's folder so page fit can be checked by eye.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createAiBudget, createPreparationEngine, type DocumentRenderer, type FileStore, type PdfTextReader, type TailoringEngine, type Writer } from "@apply-kit/core";
import { createPackageFolder } from "../packages.ts";

function memoryFiles(): FileStore {
  const files = new Map<string, Uint8Array>();
  return {
    async put(bytes) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      files.set(sha256, new Uint8Array(bytes));
      return { sha256, size: bytes.byteLength };
    },
    get: async (sha256) => files.get(sha256) ?? null,
    async remove(sha256) { files.delete(sha256); },
  };
}

export interface EvaluationEngineDeps {
  renderer: DocumentRenderer;
  pdfReader: PdfTextReader;
  /** Where the packages' PDFs go (packages/<package id>/ inside it). */
  pdfDir: string;
  now?: () => Date;
}

export function evaluationEngine(deps: EvaluationEngineDeps) {
  return (writer: Writer, budgetUsd: number): TailoringEngine => {
    const db = new DatabaseSync(":memory:");
    const clock = { now: deps.now ?? (() => new Date()) };
    const preparation = createPreparationEngine({
      db, clock, writer,
      budget: createAiBudget({ db, clock, capUsd: budgetUsd }),
      renderer: deps.renderer,
      pdfReader: deps.pdfReader,
      files: memoryFiles(),
      packages: createPackageFolder(deps.pdfDir),
    });
    return { preparation, now: clock.now };
  };
}
