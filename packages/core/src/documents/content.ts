// The structured content a package's documents are filled from (ADR 0003): the CV and the cover
// letter each have one fixed template, and the model only ever supplies this content, never markup.

export type DocumentKind = "cv" | "cover-letter";
export type DocumentLanguage = "en" | "bg";

/** A month and year (month 1–12), or a year alone where only the year is known. */
export interface MonthYear {
  year: number;
  month?: number;
}

/**
 * A date as the template prints it: a month and year (formatted per language), or loose text kept
 * as the profile stores it ("Summer 2022"), which the ATS check reports as unreadable.
 */
export type DocumentDate = MonthYear | { text: string };

/** The letterhead both documents share: contact details sit in the page body, never a header or footer. */
export interface Letterhead {
  /** In the script Kris stored it in for this language (Latin or Cyrillic). */
  name: string;
  /** The current title under the name. */
  headline: string;
  /** City and country, as one phrase ("Sofia, Bulgaria"). */
  location?: string;
  email: string;
  phone?: string;
  /** Profile links without the scheme ("linkedin.com/in/…"). */
  links: string[];
}

export interface CvRole {
  title: string;
  employer: string;
  place?: string;
  start: DocumentDate;
  /** "present" for a current role. */
  end: DocumentDate | "present";
  bullets: string[];
}

export interface CvEducation {
  /** "BSc Computer Science". */
  degree: string;
  school: string;
  start: DocumentDate;
  end: DocumentDate;
}

/** The optional photo: embedded as an image with no text, so parsers skip it. */
export interface DocumentPhoto {
  mediaType: "image/jpeg" | "image/png" | "image/svg+xml";
  bytes: Uint8Array;
}

export interface CvContent {
  letterhead: Letterhead;
  summary: string;
  /** Reverse-chronological. */
  experience: CvRole[];
  skills: string[];
  education: CvEducation[];
  /** Languages with level, then courses and certificates ("English (C1)"). The section is left out when empty. */
  languagesAndCourses: string[];
  /** Only when switched on for the package; no photo slot otherwise. */
  photo?: DocumentPhoto;
}

export interface LetterContent {
  letterhead: Letterhead;
  /** The day the letter is dated, YYYY-MM-DD. Filled by the template from the package, never by the model. */
  date: string;
  recipient: {
    company: string;
    place?: string;
  };
  /** The "Re:" line: the role and the job's reference where the posting has one. */
  re: {
    role: string;
    reference?: string;
  };
  /** The model's part: greeting to closing ("Kind regards,"); the name is signed under the closing. */
  greeting: string;
  paragraphs: string[];
  closing: string;
}

/** One document to print from its fixed HTML template (ADR 0003). */
export type DocumentToRender =
  | { kind: "cv"; language: DocumentLanguage; title: string; content: CvContent }
  | { kind: "cover-letter"; language: DocumentLanguage; title: string; content: LetterContent };
