// From stored facts to what Kris sees: requirements, key facts with their source lines, the
// facts that need him, and the cautious reading used until he answers. Pure functions.
import type { PostingFacts } from "./facts.ts";

/** Whether Kris meets a requirement. "unknown" until there is a master profile to check against. */
export type RequirementStatus = "met" | "partly" | "gap" | "unknown";

export interface FeedRequirement {
  text: string;
  /** As used for screening: a low-confidence "required" counts as preferred until Kris confirms it. */
  kind: "required" | "preferred";
  status: RequirementStatus;
  needsYou: boolean;
}

export function feedRequirements(facts: PostingFacts): FeedRequirement[] {
  return facts.requirements.map((r) => ({ text: r.text, kind: r.kind, status: "unknown", needsYou: false }));
}
