import type { ArchetypeCategory } from "./types";

// ————————————————————————————————————————————————
// Archetype bundle.
//
// ~40 boilerplate phrases a recruiter reads five times a day. Each phrase
// has:
//   • a canonical form (what we show in the UI)
//   • an array of regex variants — we run all of them case-insensitively
//   • a category (affects severity weighting in the UI)
//   • a "suggestion" — short, actionable replacement tactic
//
// Regexes use word boundaries where possible so we don't false-positive on
// substrings ("leverage" matches "leverage" but not "leveraged the car").
// Variants are lowercase — the detector lowercases both sides before matching.
// ————————————————————————————————————————————————

export type ArchetypeEntry = {
  /** Canonical label shown in warnings. */
  phrase: string;
  category: ArchetypeCategory;
  /** Regex variants, case-insensitive at runtime. */
  variants: RegExp[];
  /** Short actionable replacement tactic. */
  suggestion: string;
};

// Helper that builds a word-boundary-anchored regex case-insensitively.
function wb(pat: string): RegExp {
  return new RegExp(`\\b${pat}\\b`, "i");
}

export const ARCHETYPE_BUNDLE: ArchetypeEntry[] = [
  // ——— vague-achievement ———
  {
    phrase: "results-driven",
    category: "vague-achievement",
    variants: [wb("results[- ]driven"), wb("results[- ]oriented")],
    suggestion: "Show the result. What did you ship, and what changed because of it?",
  },
  {
    phrase: "track record of",
    category: "vague-achievement",
    variants: [/\btrack[- ]record of\b/i, /\bproven track[- ]record\b/i],
    suggestion: "Name the track. Two dated outcomes beat one track-record claim.",
  },
  {
    phrase: "proven ability",
    category: "vague-achievement",
    variants: [wb("proven ability"), wb("demonstrated ability")],
    suggestion: "Prove it with a specific example or metric.",
  },
  {
    phrase: "strong background",
    category: "vague-achievement",
    variants: [wb("strong background"), wb("solid background")],
    suggestion: "Name the systems, products, or companies.",
  },
  {
    phrase: "extensive experience",
    category: "vague-achievement",
    variants: [
      wb("extensive experience"),
      wb("significant experience"),
      wb("vast experience"),
    ],
    suggestion: "Replace with years + domain: \"6 years in fintech payments\".",
  },
  {
    phrase: "wide range of",
    category: "vague-achievement",
    variants: [wb("wide range of"), wb("broad range of"), wb("diverse range of")],
    suggestion: "Be specific — list the 2–3 examples that matter most.",
  },
  {
    phrase: "responsible for",
    category: "vague-achievement",
    variants: [wb("responsible for")],
    suggestion: "Turn it into a verb: \"Owned X\" or \"Shipped X\" with an outcome.",
  },
  {
    phrase: "helped to",
    category: "vague-achievement",
    variants: [/\bhelped to\b/i, /\bassisted in\b/i, /\bcontributed to\b/i],
    suggestion: "If you helped, say exactly what you did. If you didn't, cut it.",
  },

  // ——— filler-adjective ———
  {
    phrase: "passionate",
    category: "filler-adjective",
    variants: [wb("passionate")],
    suggestion: "Delete. Passion is inferred from what you built, not claimed.",
  },
  {
    phrase: "dedicated",
    category: "filler-adjective",
    variants: [wb("dedicated(?! to (?:shipping|building|the))")],
    suggestion: "Delete unless followed by a specific object (\"dedicated to shipping weekly\").",
  },
  {
    phrase: "hard-working",
    category: "filler-adjective",
    variants: [wb("hard[- ]working"), wb("hardworking")],
    suggestion: "Delete. Show it via scope and frequency of shipping.",
  },
  {
    phrase: "motivated",
    category: "filler-adjective",
    variants: [wb("highly motivated"), wb("self[- ]motivated"), wb("motivated")],
    suggestion: "Delete. Motivation isn't evidence.",
  },
  {
    phrase: "enthusiastic",
    category: "filler-adjective",
    variants: [wb("enthusiastic")],
    suggestion: "Delete. It's the weakest adjective in the CV dictionary.",
  },
  {
    phrase: "detail-oriented",
    category: "filler-adjective",
    variants: [wb("detail[- ]oriented"), wb("meticulous")],
    suggestion: "Show detail: cite a bug you caught, a spec you wrote, a pixel fix.",
  },
  {
    phrase: "innovative",
    category: "filler-adjective",
    variants: [wb("innovative"), wb("cutting[- ]edge")],
    suggestion: "Replace with the thing itself — what was new about what you shipped?",
  },
  {
    phrase: "dynamic",
    category: "filler-adjective",
    variants: [wb("dynamic(?! programming| pricing| type| import)")],
    suggestion: "\"Dynamic\" says nothing. Describe the motion concretely.",
  },
  {
    phrase: "world-class",
    category: "filler-adjective",
    variants: [wb("world[- ]class"), wb("best[- ]in[- ]class")],
    suggestion: "Replace with a comparison the reader can verify.",
  },

  // ——— corporate-cliche ———
  {
    phrase: "synergy",
    category: "corporate-cliche",
    variants: [wb("synerg(y|ies|ize|istic)")],
    suggestion: "Say what actually combined. \"Integrated X with Y\" usually works.",
  },
  {
    phrase: "leverage",
    category: "corporate-cliche",
    variants: [wb("leverag(e|ed|es|ing)")],
    suggestion: "Use \"used\" or \"built on\" — both are clearer.",
  },
  {
    phrase: "value-add",
    category: "corporate-cliche",
    variants: [wb("value[- ]add"), wb("added value"), wb("value proposition")],
    suggestion: "Name the added value in nouns: revenue, users, shipped features.",
  },
  {
    phrase: "move the needle",
    category: "corporate-cliche",
    variants: [/\bmov(e|ed|ing) the needle\b/i],
    suggestion: "Specify which needle and by how much.",
  },
  {
    phrase: "think outside the box",
    category: "corporate-cliche",
    variants: [/\bthink(ing)? outside the box\b/i, /\bout-of-the-box thinker\b/i],
    suggestion: "Show a non-obvious approach by example.",
  },
  {
    phrase: "go-getter",
    category: "corporate-cliche",
    variants: [wb("go[- ]getter"), wb("self[- ]starter")],
    suggestion: "Example beats label — what did you start without being asked?",
  },
  {
    phrase: "low-hanging fruit",
    category: "corporate-cliche",
    variants: [/\blow[- ]hanging fruit\b/i],
    suggestion: "Name the fruit.",
  },
  {
    phrase: "game-changer",
    category: "corporate-cliche",
    variants: [wb("game[- ]chang(er|ing)")],
    suggestion: "Describe the change; let the reader decide if it's a game-changer.",
  },
  {
    phrase: "best practices",
    category: "corporate-cliche",
    variants: [wb("best practices")],
    suggestion: "Which practices? Two named ones outweigh the phrase.",
  },
  {
    phrase: "rockstar / ninja / guru",
    category: "corporate-cliche",
    variants: [wb("rockstar"), wb("ninja"), wb("(?<!java)guru")],
    suggestion: "Drop the label. Your output is the signal.",
  },

  // ——— generic-collaboration ———
  {
    phrase: "team player",
    category: "generic-collaboration",
    variants: [wb("team player")],
    suggestion: "Show teamwork: pair-programming, review culture, mentorship count.",
  },
  {
    phrase: "excellent communication",
    category: "generic-collaboration",
    variants: [
      /\bexcellent communication( skills)?\b/i,
      /\bstrong communication( skills)?\b/i,
      /\bgreat communicator\b/i,
    ],
    suggestion: "Link to docs you wrote, talks you gave, or threads you resolved.",
  },
  {
    phrase: "cross-functional",
    category: "generic-collaboration",
    variants: [wb("cross[- ]functional(?! team)"), /\bworked cross[- ]functionally\b/i],
    suggestion: "Name the functions and the artifact. PM+Eng+Design → a shipped thing.",
  },
  {
    phrase: "stakeholders",
    category: "generic-collaboration",
    variants: [wb("stakeholders(?! at| in)"), /\bkey stakeholders\b/i],
    suggestion: "Name them: \"the sales team\", \"our PM\", \"two enterprise customers\".",
  },
  {
    phrase: "interpersonal skills",
    category: "generic-collaboration",
    variants: [wb("interpersonal skills"), wb("people skills")],
    suggestion: "Demonstrate, don't claim. Mentorship counts, hiring counts, reviews count.",
  },
  {
    phrase: "collaborative environment",
    category: "generic-collaboration",
    variants: [wb("collaborative environment"), wb("collaborative mindset")],
    suggestion: "Describe the collaboration: RFC culture? Pair programming? Critique?",
  },

  // ——— pace-cliche ———
  {
    phrase: "fast-paced environment",
    category: "pace-cliche",
    variants: [wb("fast[- ]paced environment"), wb("fast[- ]paced")],
    suggestion: "Swap for a concrete pace: \"weekly releases\" or \"biweekly sprints\".",
  },
  {
    phrase: "hit the ground running",
    category: "pace-cliche",
    variants: [/\bhit the ground running\b/i, /\bhits? the ground running\b/i],
    suggestion: "Replace with what you shipped in your first 30 days somewhere.",
  },
  {
    phrase: "thrive under pressure",
    category: "pace-cliche",
    variants: [/\bthriv(e|es|ed|ing) under pressure\b/i, /\bperform under pressure\b/i],
    suggestion: "Show a crunch moment: an incident, a launch, a deadline you hit.",
  },
  {
    phrase: "wear many hats",
    category: "pace-cliche",
    variants: [/\bwear(?:ing|s)? many hats\b/i, /\bmultiple hats\b/i],
    suggestion: "List the two biggest hats by scope; drop the rest.",
  },
  {
    phrase: "dynamic environment",
    category: "pace-cliche",
    variants: [wb("dynamic environment"), wb("ever[- ]changing environment")],
    suggestion: "Describe the environment by team size or reorg cadence.",
  },
  {
    phrase: "ground floor",
    category: "pace-cliche",
    variants: [/\bground floor\b/i, /\bzero to one\b/i],
    suggestion: "Say how early: employee #, pre-PMF, pre-seed, etc.",
  },
  {
    phrase: "end-to-end",
    category: "vague-achievement",
    variants: [wb("end[- ]to[- ]end"), wb("full[- ]stack ownership")],
    suggestion: "Name the ends — \"from design spec to prod rollout\".",
  },
  {
    phrase: "spearheaded",
    category: "vague-achievement",
    variants: [wb("spearhead(ed|ing)?")],
    suggestion: "\"Led\" is shorter and lands harder. Then add the outcome.",
  },
];

export const ARCHETYPE_BY_CATEGORY_LABEL: Record<ArchetypeCategory, string> = {
  "vague-achievement": "Vague achievement",
  "filler-adjective": "Filler adjective",
  "corporate-cliche": "Corporate cliché",
  "generic-collaboration": "Generic collaboration",
  "pace-cliche": "Pace cliché",
};
