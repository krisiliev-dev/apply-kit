// Track's ports onto Prepare (docs/contracts.md › PrepareForTrack): the tracker reads the master
// profile and adds interview stories to it through the preparation engine, never its tables.
import type { PrepareForTrack } from "./preparation/engine.ts";
import type { MasterProfile } from "./follow-ups.ts";

/** The tracker's `profile` port, made from Prepare's engine (as the service wires them). */
export function trackPortsFrom(prepare: PrepareForTrack): { profile: MasterProfile } {
  return {
    profile: {
      evidence: async (input) => prepare.profileEvidence(input),
      stories: async () => prepare.profileStories(),
      addUnconfirmedPiece: async (piece) => prepare.addUnconfirmedPiece(piece),
    },
  };
}
