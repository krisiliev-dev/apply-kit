// Track's ports onto Prepare (docs/contracts.md › PrepareForTrack): the tracker reads the master
// profile, adds interview stories to it, drafts in the user's voice and reads packages as sent through
// the preparation engine, never its tables.
import type { PrepareForTrack, VoiceForDrafts } from "./preparation/engine.ts";
import type { MasterProfile } from "./follow-ups.ts";
import type { PackagesForTrack } from "./tracker.ts";

/** The tracker's `profile`, `voice` and `packages` ports, made from Prepare's engine (as the service wires them). */
export function trackPortsFrom(prepare: PrepareForTrack): { profile: MasterProfile; voice: VoiceForDrafts; packages: PackagesForTrack } {
  return {
    packages: {
      packageSnapshot: (id) => prepare.packageSnapshot(id),
      approvedWithoutApplication: () => prepare.approvedWithoutApplication(),
      packageFile: (id, which, version) => prepare.packageFile(id, which, version),
      markPackageSubmitted: (id, how) => prepare.markPackageSubmitted(id, how),
      undoPackageSubmitted: (id) => prepare.undoPackageSubmitted(id),
    },
    voice: { voiceContext: (request) => prepare.voiceContext(request), recordVoiceEdit: (edit) => prepare.recordVoiceEdit(edit) },
    profile: {
      evidence: async (input) => prepare.profileEvidence(input),
      stories: async () => prepare.profileStories(),
      addUnconfirmedPiece: async (piece) => prepare.addUnconfirmedPiece(piece),
    },
  };
}
