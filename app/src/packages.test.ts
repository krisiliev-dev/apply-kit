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

  it("freezes an approved file in packages/<id>/v<version>/, never rewrites it, and copies it to the Packages folder", async () => {
    const dataDir = freshDir();
    const packagesDir = join(freshDir(), "apply-kit Packages");
    const folder = createPackageFolder(dataDir, packagesDir);

    const frozen = await folder.freeze("p1", 1, "Mira_Petrova_CV_Kestrel.pdf", bytes("%PDF approved"));

    expect(frozen).toEqual({ path: "packages/p1/v1/Mira_Petrova_CV_Kestrel.pdf", copy: join(packagesDir, "Mira_Petrova_CV_Kestrel.pdf") });
    expect(new TextDecoder().decode((await folder.read(frozen.path))!)).toBe("%PDF approved");
    expect(readFileSync(frozen.copy!, "utf8")).toBe("%PDF approved");
    await expect(folder.freeze("p1", 1, "Mira_Petrova_CV_Kestrel.pdf", bytes("%PDF changed"))).rejects.toThrow();
    // A new draft never touches the frozen file.
    await folder.saveDraft("p1", "cv", "Mira_Petrova_CV_Kestrel.pdf", bytes("%PDF draft"));
    expect(new TextDecoder().decode((await folder.read(frozen.path))!)).toBe("%PDF approved");
  });

  it("freezes the same bytes again as the file already there (a retried approval), and refuses other bytes", async () => {
    const dataDir = freshDir();
    const folder = createPackageFolder(dataDir);
    const first = await folder.freeze("p1", 1, "Mira_Petrova_CV_Kestrel.pdf", bytes("%PDF approved"));

    const again = await folder.freeze("p1", 1, "Mira_Petrova_CV_Kestrel.pdf", bytes("%PDF approved"));

    expect(again).toEqual(first);
    await expect(folder.freeze("p1", 1, "Mira_Petrova_CV_Kestrel.pdf", bytes("%PDF changed"))).rejects.toThrow();
    expect(new TextDecoder().decode((await folder.read(first.path))!)).toBe("%PDF approved");
  });

  it("still freezes when the Packages folder can't be written, with no copy", async () => {
    const dataDir = freshDir();
    const folder = createPackageFolder(dataDir, "/dev/null/apply-kit Packages");

    expect(await folder.freeze("p1", 2, "Mira_Petrova_CV_Kestrel.pdf", bytes("%PDF"))).toEqual({ path: "packages/p1/v2/Mira_Petrova_CV_Kestrel.pdf", copy: null });
  });

  it("refuses a package id or file name that would leave the package's folder", async () => {
    const folder = createPackageFolder(freshDir());

    await expect(folder.saveDraft("../p1", "cv", "CV.pdf", bytes("x"))).rejects.toThrow();
    await expect(folder.saveDraft("p1", "cv", "../CV.pdf", bytes("x"))).rejects.toThrow();
  });
});
