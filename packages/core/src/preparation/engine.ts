// The preparation engine: Prepare's deep module, beside the discovery engine and sharing its
// database, clock, settings and AI budget. It will own the master profile, angles, answer bank,
// voice, imports, the coach interview and packages (spec #51); each ticket adds its operations here.
import { migrate } from "../schema.ts";
import type { BudgetInfo } from "../budget.ts";
import type { PreparationDeps } from "./ports.ts";
import { createContactStore, type Contact, type ContactDetails, type PhotoInput, type SaveContactResult } from "./contact.ts";
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
}

export function createPreparationEngine(deps: PreparationDeps): PreparationEngine {
  migrate(deps.db);
  const profile = createProfileStore(deps);
  const contact = createContactStore(deps);
  return {
    budget: () => deps.budget.info(),
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
