import type { CVContent } from "@/lib/types";
import { profile } from "@/content/profile";

export const engineerCV: CVContent = {
  slug: "engineer",
  targetRole: "Frontend Engineer",
  profile: {
    ...profile,
    title: "Frontend Engineer",
    summary:
      "Frontend engineer who takes the design seriously. Writes TypeScript for a living, ships design systems, and prefers a short list of dependencies to a long one.",
  },
  experiences: [
    {
      role: "Senior Frontend Engineer",
      company: "Quill & Compass",
      location: "Remote",
      dates: { start: "2023", end: "present" },
      summary:
        "Reading app for long-form writing. I own the editor surface end-to-end.",
      bullets: [
        "Led the rewrite of the writing canvas on top of ProseMirror; reduced keystroke latency by ~60% on mid-tier Android.",
        "Extracted a typed command system shared by the editor, the command palette, and the AI assist flow.",
        "Built an offline-first sync layer with CRDTs — reconciles three devices per user without merge prompts.",
        "Set up the visual-regression pipeline (Playwright + per-PR screenshots) that now gates all design-system changes.",
      ],
      tags: ["ProseMirror", "CRDTs", "TypeScript"],
    },
    {
      role: "Frontend Engineer",
      company: "Paperlane",
      location: "Amsterdam",
      dates: { start: "2021", end: "2023" },
      summary:
        "Developer-facing analytics product. Small team; I wrote both the SDK and the dashboard.",
      bullets: [
        "Shipped the charting layer on top of D3 — interactive, accessible, themeable.",
        "Designed the plugin API so customers could write their own widgets; 34 plugins in 18 months.",
        "Halved time-to-first-chart on empty accounts by rebuilding the onboarding as a guided REPL.",
      ],
      tags: ["D3", "SDK design", "dashboards"],
    },
    {
      role: "Software Engineer",
      company: "Stagepost",
      location: "Lisbon",
      dates: { start: "2019", end: "2021" },
      summary: "Media-asset review tool for small film studios.",
      bullets: [
        "Wrote the timeline scrubber used by every reviewer — 120fps, keyboard-first, frame-accurate.",
        "Built the comment-resolve workflow that replaced a shared Google Doc inside studios.",
        "Owned the upgrade from an aging CRA build to Next.js without a single regression ticket.",
      ],
      tags: ["video", "real-time", "Next.js"],
    },
    {
      role: "Junior Developer",
      company: "Halftone Studio",
      location: "Porto",
      dates: { start: "2018", end: "2019" },
      bullets: [
        "Built a dozen editorial microsites for museum clients — HTML, CSS, a little Svelte.",
        "Maintained the studio's internal asset-handoff tool.",
      ],
    },
  ],
  education: [
    {
      school: "Universidade de Lisboa",
      degree: "BSc, Computer Science & Design",
      location: "Lisbon, PT",
      dates: { start: "2014", end: "2018" },
      notes: "Capstone: a real-time collaborative code sketchbook built on Yjs.",
    },
    {
      school: "Recurse Center",
      degree: "Fall batch (remote)",
      dates: { start: "2020", end: "2020" },
      notes: "Spent twelve weeks on compilers and type systems.",
    },
  ],
  projects: [
    {
      name: "tiny-crdt",
      summary:
        "A 3kb CRDT for small collaborative lists — used in two internal tools at Quill & Compass.",
      url: "https://github.com/inesvalverde/tiny-crdt",
      stack: ["TypeScript"],
    },
    {
      name: "dx/notes",
      summary:
        "A tiny static-site tool for changelogs with per-entry diff previews. ~800 GitHub stars.",
      url: "https://github.com/inesvalverde/dx-notes",
      stack: ["Astro", "Shiki"],
    },
    {
      name: "Riso Club booking",
      summary:
        "Booking + calendar system for a volunteer risograph studio — Next.js, SQLite, Tailwind.",
      stack: ["Next.js", "SQLite"],
    },
  ],
  skills: [
    { label: "Core", items: ["TypeScript", "React", "Next.js", "Node.js"] },
    { label: "Rendering", items: ["Canvas", "WebGL", "SVG", "D3"] },
    { label: "Infra", items: ["Vercel", "Cloudflare Workers", "Supabase", "Playwright"] },
    { label: "Also", items: ["Figma", "Tailwind", "ProseMirror", "Yjs"] },
  ],
  interests: [
    "small type-safe libraries",
    "old compilers",
    "trail running",
    "risograph printing",
  ],
};
