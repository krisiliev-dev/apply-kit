import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPackageFolder } from "./packages.ts";

const dirs: string[] = [];
const freshDir = () => { const d = mkdtempSync(join(tmpdir(), "apply-kit-packages-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const bytes = (s: string) => new TextEncoder().encode(s);

describe("packages folder", () => {
  it("keeps a draft in packages/<package id>/ under its file name", async () => {
    const dataDir = freshDir();

    const { path } = await createPackageFolder(dataDir).saveDraft("p1", "cv", "Mira_Petrova_CV_Kestrel.pdf", bytes("%PDF one"));

    expect(path).toBe("packages/p1/Mira_Petrova_CV_Kestrel.pdf");
    expect(readFileSync(join(dataDir, path), "utf8")).toBe("%PDF one");
  });

  it("replaces the previous draft of the same document, even under a new name, and leaves the other document", async () => {
    const dataDir = freshDir();
    const folder = createPackageFolder(dataDir);
    await folder.saveDraft("p1", "cv", "Mira_Petrova_CV_Kestrel.pdf", bytes("%PDF one"));
    await folder.saveDraft("p1", "cover-letter", "Mira_Petrova_Cover_Letter_Kestrel.pdf", bytes("%PDF letter"));

    await folder.saveDraft("p1", "cv", "Mira_Petrova_CV_Kestrel_Payments.pdf", bytes("%PDF two"));

    expect(readdirSync(join(dataDir, "packages/p1")).filter((f) => f.endsWith(".pdf")).sort())
      .toEqual(["Mira_Petrova_CV_Kestrel_Payments.pdf", "Mira_Petrova_Cover_Letter_Kestrel.pdf"]);
  });

  it("refuses a package id or file name that would leave the package's folder", async () => {
    const folder = createPackageFolder(freshDir());

    await expect(folder.saveDraft("../p1", "cv", "CV.pdf", bytes("x"))).rejects.toThrow();
    await expect(folder.saveDraft("p1", "cv", "../CV.pdf", bytes("x"))).rejects.toThrow();
  });
});
