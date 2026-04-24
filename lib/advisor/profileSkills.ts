// Normalizes skills across the user's profile + CV variants so the
// skill-gap endpoint has a single union to compare against. Pure functions;
// callable from client and server.

import type { CVContent, SkillGroup } from "@/lib/types";

export function extractUserSkills(cvs: CVContent[]): string[] {
  const all = new Set<string>();
  for (const cv of cvs) {
    for (const group of cv.skills ?? []) {
      addGroup(group, all);
    }
    // Tech tags on experiences + projects feed the skill union too — people
    // rarely list every tool in the Skills block but cite them in bullets.
    for (const exp of cv.experiences ?? []) {
      for (const tag of exp.tags ?? []) {
        const normed = normalize(tag);
        if (normed) all.add(normed);
      }
    }
    for (const proj of cv.projects ?? []) {
      for (const tech of proj.stack ?? []) {
        const normed = normalize(tech);
        if (normed) all.add(normed);
      }
    }
  }
  return Array.from(all).sort();
}

function addGroup(group: SkillGroup, out: Set<string>) {
  for (const item of group.items ?? []) {
    const normed = normalize(item);
    if (normed) out.add(normed);
  }
}

// Lowercased, trimmed, minimal punctuation. Keeps "Next.js" as "next.js",
// so the LLM can still see casing cues via the original strings — we pass
// both normalized + originals into the prompt to give it context.
export function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9+.# /-]/g, "")
    .trim();
}
