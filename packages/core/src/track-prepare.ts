// Track's ports onto Prepare (docs/contracts.md › PrepareForTrack): the tracker reads the master
// profile, adds interview stories to it and drafts in the user's voice through the preparation engine, never its tables.
import type { PrepareForTrack, VoiceForDrafts } from "./preparation/engine.ts";
import type { MasterProfile } from "./follow-ups.ts";

/** The tracker's `profile` and `voice` ports, made from Prepare's engine (as the service wires them). */
export function trackPortsFrom(prepare: PrepareForTrack): { profile: MasterProfile; voice: VoiceForDrafts } {
  return {
    voice: { voiceContext: (request) => prepare.voiceContext(request), recordVoiceEdit: (edit) => prepare.recordVoiceEdit(edit) },
    profile: {
      evidence: async (input) => prepare.profileEvidence(input),
      stories: async () => prepare.profileStories(),
      addUnconfirmedPiece: async (piece) => prepare.addUnconfirmedPiece(piece),
    },
  };
}
