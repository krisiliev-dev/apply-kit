// File names portals accept: ASCII letters, digits and underscores only (DESIGN.md › Documents),
// "Name_CV_Company_Role.pdf". Cyrillic is transliterated the official Bulgarian way.
import type { DocumentKind } from "./content.ts";

const bulgarian: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
};

function ascii(text: string): string {
  const latin = [...text.normalize("NFC")].map((ch) => {
    const lower = ch.toLowerCase();
    const t = bulgarian[lower];
    if (t === undefined) return ch;
    return ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1);
  }).join("");
  return latin.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export interface FileNameParts {
  /** Kris's name; written in Latin where it's stored in Cyrillic. */
  name: string;
  company: string;
  role: string;
}

const kindWords: Record<DocumentKind, string> = { cv: "CV", "cover-letter": "Cover Letter" };

/** "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf". */
export function documentFileName(kind: DocumentKind, parts: FileNameParts): string {
  return `${[parts.name, kindWords[kind], parts.company, parts.role].map(ascii).filter(Boolean).join("_")}.pdf`;
}
