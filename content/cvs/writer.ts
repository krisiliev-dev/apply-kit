import type { CVContent } from "@/lib/types";
import { profile } from "@/content/profile";

export const writerCV: CVContent = {
  slug: "writer",
  targetRole: "Developer Experience & Tech Writing",
  profile: {
    ...profile,
    title: "Developer experience writer",
    summary:
      "Writes for developers who skim. Ten years of shipping tools and six of writing about them — usually at the same time, often to explain my own code to myself.",
  },
  experiences: [
    {
      role: "Developer Experience Lead",
      company: "Paperlane",
      location: "Amsterdam (remote)",
      dates: { start: "2022", end: "present" },
      summary:
        "Analytics SDK. I own the docs, the onboarding, and the public-facing writing.",
      bullets: [
        "Rewrote the docs from reference-only to a task-first structure — \"time to first chart\" dropped from 42 to 9 minutes in cohort testing.",
        "Ship a fortnightly engineering blog; grew it from 400 to 14,000 RSS subscribers in 18 months.",
        "Wrote and maintain the 'Paperlane recipes' series — small, runnable examples that account for 30% of docs traffic.",
        "Standardised the changelog voice with a one-page style guide and a linter for our public-facing markdown.",
      ],
      tags: ["docs", "writing", "DX"],
    },
    {
      role: "Technical Writer",
      company: "Foyer",
      location: "Berlin",
      dates: { start: "2020", end: "2022" },
      summary:
        "First writer on a 40-person product team. Owned docs, release notes, and customer-facing copy.",
      bullets: [
        "Built the first docs site; migrated 80+ support-ticket answers into searchable how-tos — ticket volume fell ~28%.",
        "Wrote the in-app empty states and error copy that shipped with the v3 rewrite.",
        "Ran a monthly 'write with engineers' session; trained five PMs to ship their own release notes.",
      ],
      tags: ["docs", "product copy", "release notes"],
    },
    {
      role: "Software Engineer → Writing",
      company: "Stagepost",
      location: "Lisbon",
      dates: { start: "2018", end: "2020" },
      summary: "Joined as an engineer, drifted into writing the tutorials nobody else wanted to write.",
      bullets: [
        "Wrote the full public API reference and the 'first project' tutorial still used in sales demos.",
        "Maintained the video-editing plugin developer guide; reviewed 60+ community plugin submissions.",
      ],
      tags: ["API reference", "tutorials"],
    },
  ],
  education: [
    {
      school: "Universidade de Lisboa",
      degree: "BSc, Computer Science & Design",
      location: "Lisbon, PT",
      dates: { start: "2014", end: "2018" },
    },
    {
      school: "Write the Docs (mentorship cohort)",
      degree: "Mentee, then mentor",
      dates: { start: "2021", end: "present" },
      notes: "Mentored four first-time tech writers through their first 90 days.",
    },
  ],
  projects: [
    {
      name: "Tipo",
      summary:
        "Weekly newsletter on typography for people who build software. ~2,400 subscribers; two sponsor slots a month.",
      url: "https://tipo.valverde.studio",
    },
    {
      name: "Ship Notes",
      summary:
        "A short podcast-style series where I read a notable changelog out loud and explain why it's good writing.",
      url: "https://valverde.studio/ship-notes",
    },
    {
      name: "dx/notes",
      summary:
        "Open-source changelog generator with per-entry diff previews. ~800 stars on GitHub; the docs eat their own dog food.",
      url: "https://github.com/inesvalverde/dx-notes",
      stack: ["Astro"],
    },
  ],
  skills: [
    { label: "Writing", items: ["Tutorials", "API reference", "Release notes", "In-product copy"] },
    { label: "Tools", items: ["Markdown", "MDX", "Astro", "Docusaurus", "Mintlify"] },
    { label: "Code", items: ["TypeScript", "Node.js", "Python (reading it)"] },
    { label: "Method", items: ["Docs-as-code", "User research", "Cohort testing"] },
  ],
  interests: [
    "reading changelogs on the weekend",
    "typography",
    "long-form essays",
    "small plaintext formats",
    "urban cycling",
  ],
};
