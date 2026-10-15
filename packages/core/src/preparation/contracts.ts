// What Prepare hands to the other features (spec #51, ticket #67), as plain data: the approved
// package Apply fills portals from (#38, #39, #41) and the snapshot Track shows as sent (#35). The
// operations are on the preparation engine (`PrepareForApply`, `PrepareForTrack` in engine.ts);
// docs/contracts.md says how each feature uses them. Read-only except where the engine says so.

/** A file frozen when the package was approved: these exact bytes are what a portal gets. */
export interface FrozenFile {
  /** ASCII, "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf". */
  fileName: string;
  sha256: string;
  size: number;
  /** Where the frozen file is, relative to the data folder (the source of truth). */
  path: string;
  /** The copy in Kris's Packages folder ("Show in Finder"), or null if it couldn't be written. */
  copy: string | null;
}

/** A portal's own reference to a job, read from the target posting's link (Apply matches pages by it). */
export interface PortalJobReference {
  portal: "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters" | "workable";
  /** The board, site, company or tenant the job sits under. */
  board: string;
  jobId: string;
}

/** A role or a degree exactly as printed on the approved CV. Months are "YYYY-MM". */
export interface CvEntryAsSent {
  title: string;
  /** The employer or school. */
  organisation: string;
  place: string | null;
  start: string;
  /** Null for a current role. */
  end: string | null;
}

export type PackageState = "approved" | "submitted";
export type SubmittedVia = "extension" | "app";

/**
 * An approved package, frozen at approval and never changed after (later edits make a new version,
 * which needs approval again). The same data serves Apply's fill and Track's "Package as sent".
 */
export interface ApprovedPackage {
  id: string;
  jobId: string;
  /** 1 for the first approval; a package edited and approved again gets the next number. */
  version: number;
  state: PackageState;
  approvedAt: string;
  submitted: { at: string; via: SubmittedVia; portalUrl: string | null } | null;
  job: { title: string; company: string };
  targetPosting: { url: string; site: string; jobRef: PortalJobReference | null };
  language: "en" | "bg";
  angle: "developer" | "security" | "design";
  cv: {
    /** "Security · Kestrel Payments": what Track's What's working counts it under. */
    label: string;
    file: FrozenFile;
    /** The ATS check as approved: failing checks Kris accepted knowingly are named. */
    ats: { passed: number; total: number; accepted: string[] };
    skills: string[];
    /** The work history and education exactly as on the CV, for the portal's repeating sections. */
    roles: CvEntryAsSent[];
    education: CvEntryAsSent[];
  };
  /** Null when the package has no approved letter. */
  letter: { text: string; file: FrozenFile } | null;
  /** The approved screening answers, in the form's order. */
  answers: { question: string; answer: string }[];
  /** Kris's honesty decisions, in words, so she can answer for them in an interview. */
  decisions: { title: string; decision: string }[];
}

/** What Apply gets for a Job or package: the approved package, or why there isn't one to fill from. */
export type PackageForApply =
  | { kind: "approved"; package: ApprovedPackage }
  | { kind: "not-approved"; packageId: string; jobId: string; reason: string }
  | { kind: "none" };

/** The master profile as a portal's form asks for it (Apply fills contact details, history and links). */
export interface ProfileForApply {
  contact: {
    givenName: string;
    familyName: string;
    fullName: string;
    /** The name as stored in Cyrillic, or null. */
    fullNameCyrillic: string | null;
    /** The job address, so the portal's emails reach the job mailbox. */
    email: string;
    /** Null when there's no phone in the profile. */
    phone: { countryCode: string; national: string; full: string } | null;
    city: string;
    country: string;
    linkedin: string | null;
    github: string | null;
    portfolio: string | null;
  };
  roles: (CvEntryAsSent & { description: string })[];
  education: (CvEntryAsSent & { field: string | null })[];
  skills: string[];
}

export type MarkSubmittedResult =
  | { marked: true; alreadyMarked: boolean; package: ApprovedPackage }
  | { marked: false; reason: string };
