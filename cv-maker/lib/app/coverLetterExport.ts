"use client";

import JSZip from "jszip";
import type { Application } from "./types";
import { loadFromStorage } from "@/lib/doc/persist";
import { toAtsText } from "@/lib/export/atsText";

// Build-and-download a zip bundle for an application.
// Contents:
//   - cover-letter.txt            (only if app.coverLetter exists)
//   - cv.json                     (tailored CV document dump, if cvSlug resolves)
//   - cv-plain.txt                (ATS-friendly plain text, same conditions as cv.json)
//   - README.md                   (instructions for exporting the CV to PDF)

export type CoverLetterExportResult = {
  filename: string;
  included: {
    coverLetter: boolean;
    cv: boolean;
    cvPlain: boolean;
  };
};

function safeSlug(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "application"
  );
}

function composeCoverLetterText(app: Application): string {
  const body = app.coverLetter?.body.trim() ?? "";
  const greeting = `Dear ${app.company} team,`;
  const signOff = `Sincerely,\n${app.role ? "" : ""}`;
  // No candidate name available in the Application record on its own — keep the
  // sign-off minimal and let the user edit downstream.
  return [greeting, "", body, "", signOff].join("\n").trim() + "\n";
}

function buildReadme(app: Application, hasCv: boolean): string {
  const lines: string[] = [
    `# ${app.company} — ${app.role}`,
    "",
    `Exported ${new Date().toLocaleString()}.`,
    "",
  ];

  if (app.coverLetter) {
    lines.push(
      "## cover-letter.txt",
      "",
      "Plain-text cover letter. The greeting and sign-off are placeholders — edit before sending.",
      "",
    );
  }

  if (hasCv && app.cvSlug) {
    lines.push(
      "## cv.json",
      "",
      `A JSON dump of the tailored CV document currently saved under slug \`${app.cvSlug}\`. This is the full editor-model representation — positions, styles, theme — suitable for re-opening in the workshop.`,
      "",
      "## cv-plain.txt",
      "",
      "An ATS-friendly plain-text rendering of the same CV: single column, standard section headings, no decorative nodes. Paste into application forms that strip formatting, or use to verify what an ATS will actually read.",
      "",
      "### Exporting the CV to PDF",
      "",
      `1. Open the workshop and visit \`/cv/${app.cvSlug}\`.`,
      "2. Press ⌘P (or Ctrl+P on Windows/Linux).",
      "3. Choose **Save as PDF** as the destination.",
      "4. Print CSS strips the editor chrome and scales to A4 automatically.",
      "",
    );
  } else if (app.cvSlug) {
    lines.push(
      "## CV",
      "",
      `The CV slug \`${app.cvSlug}\` is linked to this application, but no saved document was found in localStorage.`,
      "Open it once in the editor to seed and save it, then re-export.",
      "",
    );
  } else {
    lines.push(
      "## CV",
      "",
      "No CV linked to this application. Set a CV slug in the detail page to include it on the next bundle export.",
      "",
    );
  }

  return lines.join("\n");
}

export async function exportApplicationBundle(
  app: Application,
): Promise<CoverLetterExportResult> {
  const zip = new JSZip();

  let cvIncluded = false;
  let cvPlainIncluded = false;
  if (app.cvSlug) {
    const doc = loadFromStorage(app.cvSlug);
    if (doc) {
      zip.file("cv.json", JSON.stringify(doc, null, 2));
      cvIncluded = true;
      try {
        const plain = toAtsText(doc);
        if (plain.trim().length > 0) {
          zip.file("cv-plain.txt", plain);
          cvPlainIncluded = true;
        }
      } catch {
        // Plain-text rendering is best-effort — never block the bundle.
      }
    }
  }

  const coverLetterIncluded = Boolean(app.coverLetter?.body.trim());
  if (coverLetterIncluded) {
    zip.file("cover-letter.txt", composeCoverLetterText(app));
  }

  zip.file("README.md", buildReadme(app, cvIncluded));

  const blob = await zip.generateAsync({ type: "blob" });
  const filename = `${safeSlug(app.company)}-${safeSlug(app.role)}.zip`;

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on the next tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    filename,
    included: {
      coverLetter: coverLetterIncluded,
      cv: cvIncluded,
      cvPlain: cvPlainIncluded,
    },
  };
}
