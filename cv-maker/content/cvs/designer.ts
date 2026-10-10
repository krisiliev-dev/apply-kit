import type { CVContent } from "@/lib/types";
import { profile } from "@/content/profile";

export const designerCV: CVContent = {
  slug: "designer",
  targetRole: "Senior Product Designer",
  profile: {
    ...profile,
    title: "Senior Product Designer",
    summary:
      "Product designer who prototypes in the browser. Happiest owning a surface end-to-end — from research notes to the edge cases Product forgot to mention.",
  },
  experiences: [
    {
      role: "Senior Product Designer",
      company: "Quill & Compass",
      location: "Remote",
      dates: { start: "2023", end: "present" },
      summary:
        "Two-designer team at an editorial-leaning reading app. I own the writer-facing surfaces.",
      bullets: [
        "Redesigned the composer around an inline command palette — median time-to-publish dropped from 14 to 6 minutes.",
        "Ran a three-week co-design sprint with fifteen working essayists; shipped four of the top six requests in the same quarter.",
        "Wrote the type scale and motion tokens now used across web, iOS and the email templates.",
        "Paired weekly with an engineer to migrate 40+ components off ad-hoc CSS to a small token-backed library.",
      ],
      tags: ["design systems", "editorial UI", "research"],
    },
    {
      role: "Product Designer",
      company: "Foyer",
      location: "Berlin (hybrid)",
      dates: { start: "2021", end: "2023" },
      summary: "Calendar and scheduling product for independent practitioners.",
      bullets: [
        "Led the first real IA rewrite — cut the setup flow from 11 steps to 4, lifting trial-to-paid by 22%.",
        "Designed and shipped the booking-link builder; became the most-shared feature in support tickets.",
        "Owned the pattern library and ran a fortnightly design critique with the five-person product team.",
      ],
      tags: ["SaaS", "onboarding", "pattern library"],
    },
    {
      role: "Designer",
      company: "Halftone Studio",
      location: "Porto",
      dates: { start: "2019", end: "2021" },
      summary: "Independent studio working with museums and small publishers.",
      bullets: [
        "Designed the identity and reading experience for a Lisbon contemporary-art museum's online archive.",
        "Shipped a print + digital catalogue for a modernist photography survey — 128 pages, two languages, one very tight deadline.",
        "Co-ran a monthly zine workshop with local design students.",
      ],
      tags: ["brand", "editorial", "print"],
    },
  ],
  education: [
    {
      school: "ESAD Matosinhos",
      degree: "MA, Communication Design",
      location: "Porto, PT",
      dates: { start: "2017", end: "2019" },
      notes: "Thesis on reading patterns in long-form digital journalism.",
    },
    {
      school: "Universidade de Lisboa",
      degree: "BA, Graphic Design",
      location: "Lisbon, PT",
      dates: { start: "2014", end: "2017" },
    },
  ],
  projects: [
    {
      name: "Marginalia",
      summary:
        "A browser extension that lets you annotate any article and publish the margin as a reading list.",
      url: "https://valverde.studio/marginalia",
      stack: ["TypeScript", "WXT", "Tailwind"],
    },
    {
      name: "Tipo",
      summary:
        "A weekly newsletter on typography for people who build software — 2,400 subscribers.",
      url: "https://tipo.valverde.studio",
    },
    {
      name: "Riso Club",
      summary:
        "Volunteer-run risograph studio in Lisbon. I run the workshop schedule and designed the booking system.",
    },
  ],
  skills: [
    { label: "Design", items: ["Figma", "Design systems", "Prototyping", "Illustration"] },
    { label: "Code", items: ["TypeScript", "React", "Tailwind", "Framer Motion"] },
    { label: "Research", items: ["User interviews", "Usability tests", "Diary studies"] },
    { label: "Craft", items: ["Editorial typography", "Risograph", "Motion"] },
  ],
  interests: [
    "independent magazines",
    "typography",
    "long-distance walking",
    "letterpress",
    "field recordings",
  ],
};
