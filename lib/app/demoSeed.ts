"use client";

import type { Application, ApplicationEvent, ParsedJob } from "./types";

// Deterministic demo applications. Used by the "Populate demo" button on the
// home page so a first-run user sees a full pipeline instead of empty states.
// Dates are computed relative to "now" so the list feels fresh when seeded.

const DAY = 24 * 60 * 60 * 1000;

type Seed = {
  id: string;
  company: string;
  role: string;
  cvSlug: string;
  url: string;
  daysAgo: number;
  status: Application["status"];
  notes?: string;
  statusHistory?: Array<{ daysAgo: number; to: Application["status"]; note?: string }>;
  jobData: ParsedJob;
};

const SEEDS: Seed[] = [
  {
    id: "demo-app-01",
    company: "Marginalia Press",
    role: "Senior Product Designer",
    cvSlug: "designer",
    url: "https://marginalia.press/careers/senior-designer",
    daysAgo: 74,
    status: "offer",
    notes:
      "Founder-led reading app. Matilde's intro call was the best I've had this year — they care about type.",
    statusHistory: [
      { daysAgo: 70, to: "applied" },
      { daysAgo: 62, to: "screen", note: "45-min call with Matilde, the co-founder." },
      { daysAgo: 48, to: "interview", note: "Take-home: redesign the reading-list view." },
      { daysAgo: 21, to: "offer", note: "Offer sent — asking for two more days to decide." },
    ],
    jobData: {
      title: "Senior Product Designer",
      company: "Marginalia Press",
      location: "Remote (EU hours)",
      salary: "€75–90k + equity",
      description:
        "Marginalia is a small team building a reading app for people who annotate everything. We need a designer who will own the composer surface.",
      requirements: [
        "5+ years designing consumer-facing software",
        "Comfortable shipping from research through high-fidelity",
        "Working knowledge of HTML/CSS",
      ],
      responsibilities: [
        "Own the writer-facing surfaces end to end",
        "Run weekly critique with the two-person design team",
        "Partner with engineering on the design system",
      ],
      niceToHave: ["Editorial or publishing background", "Typography obsession"],
      keywords: ["product design", "editorial", "reading app", "typography"],
      sourceUrl: "https://marginalia.press/careers/senior-designer",
    },
  },
  {
    id: "demo-app-02",
    company: "Kettle Labs",
    role: "Frontend Engineer",
    cvSlug: "engineer",
    url: "https://kettle.dev/jobs/frontend",
    daysAgo: 58,
    status: "interview",
    notes:
      "Three-stage loop; system design is next Thursday. Re-read the SDK docs before then.",
    statusHistory: [
      { daysAgo: 55, to: "applied" },
      { daysAgo: 42, to: "screen", note: "Recruiter screen; team is 8 engineers." },
      { daysAgo: 14, to: "interview", note: "Pair-programming round went well." },
    ],
    jobData: {
      title: "Frontend Engineer",
      company: "Kettle Labs",
      location: "Berlin / Remote (CET)",
      salary: "€95–120k",
      description:
        "Infrastructure-as-a-product for small data teams. We want a frontend engineer with design taste to own the dashboard.",
      requirements: [
        "Strong TypeScript + React",
        "Shipped production dashboards with charting",
        "Comfort with component libraries and design tokens",
      ],
      responsibilities: [
        "Own the charting and query-builder surfaces",
        "Partner with a designer on the pattern library",
        "Contribute to the public SDK",
      ],
      niceToHave: ["D3 experience", "Open-source contributions"],
      keywords: ["react", "typescript", "dashboards", "d3", "design systems"],
      sourceUrl: "https://kettle.dev/jobs/frontend",
    },
  },
  {
    id: "demo-app-03",
    company: "Glyphbase",
    role: "Developer Experience Writer",
    cvSlug: "writer",
    url: "https://glyphbase.io/careers/dx-writer",
    daysAgo: 31,
    status: "screen",
    notes: "They want a writing sample specifically on empty-state copy.",
    statusHistory: [
      { daysAgo: 28, to: "applied" },
      { daysAgo: 6, to: "screen", note: "Intro call booked for Tuesday." },
    ],
    jobData: {
      title: "Developer Experience Writer",
      company: "Glyphbase",
      location: "Remote",
      salary: "$110–140k",
      description:
        "Glyphbase is a tiny team building a typography API for product teams. We need a DX writer to own the docs and the empty states.",
      requirements: [
        "3+ years writing for developers",
        "Portfolio of published tutorials or reference docs",
        "Comfortable reading TypeScript",
      ],
      responsibilities: [
        "Own the docs site end to end",
        "Write release notes and in-product copy",
        "Run docs cohort tests with a subset of users",
      ],
      keywords: ["docs", "developer experience", "api reference", "typography"],
      sourceUrl: "https://glyphbase.io/careers/dx-writer",
    },
  },
  {
    id: "demo-app-04",
    company: "Ortho Systems",
    role: "Design Engineer",
    cvSlug: "engineer",
    url: "https://orthosystems.co/careers",
    daysAgo: 18,
    status: "applied",
    statusHistory: [{ daysAgo: 18, to: "applied" }],
    jobData: {
      title: "Design Engineer",
      company: "Ortho Systems",
      location: "Remote (Americas)",
      salary: "$140–170k",
      description:
        "Ortho Systems builds a layout primitive library for design-forward frontend teams.",
      requirements: [
        "Hybrid designer/engineer skillset",
        "Experience with headless component libraries",
        "Taste for minimal APIs",
      ],
      responsibilities: [
        "Ship components in the open-source library",
        "Write the companion docs and examples",
        "Review community PRs",
      ],
      niceToHave: ["Open-source maintainer experience"],
      keywords: ["design engineer", "component library", "open source", "react"],
      sourceUrl: "https://orthosystems.co/careers",
    },
  },
  {
    id: "demo-app-05",
    company: "Smallpress",
    role: "Product Designer",
    cvSlug: "designer",
    url: "https://smallpress.studio/hiring",
    daysAgo: 44,
    status: "rejected",
    notes:
      "They went with someone with heavier iOS chops. Friendly rejection — Ana said to re-apply when the next role opens.",
    statusHistory: [
      { daysAgo: 42, to: "applied" },
      { daysAgo: 35, to: "screen" },
      { daysAgo: 12, to: "rejected", note: "Kind but firm — mismatched seniority." },
    ],
    jobData: {
      title: "Product Designer",
      company: "Smallpress",
      location: "Lisbon (hybrid)",
      description:
        "Smallpress is a two-person studio building indie publishing tools. We need a designer who can also write CSS.",
      requirements: [
        "Portfolio of shipped product work",
        "Opinionated about type",
      ],
      responsibilities: [
        "Own the publishing surface",
        "Contribute CSS to the engineering branch",
      ],
      keywords: ["product design", "indie", "publishing", "css"],
      sourceUrl: "https://smallpress.studio/hiring",
    },
  },
  {
    id: "demo-app-06",
    company: "Runesmith",
    role: "Frontend Engineer",
    cvSlug: "engineer",
    url: "https://runesmith.io/careers/frontend",
    daysAgo: 65,
    status: "withdrawn",
    notes: "Withdrew after offer from Marginalia looked stronger.",
    statusHistory: [
      { daysAgo: 63, to: "applied" },
      { daysAgo: 52, to: "screen" },
      { daysAgo: 40, to: "interview" },
      { daysAgo: 19, to: "withdrawn", note: "Withdrew politely over email." },
    ],
    jobData: {
      title: "Frontend Engineer",
      company: "Runesmith",
      location: "Amsterdam",
      salary: "€80–100k",
      description: "Runesmith is a developer-facing observability tool.",
      requirements: ["React + TypeScript", "Prior dashboards experience"],
      responsibilities: ["Build the query editor", "Own the charting pipeline"],
      keywords: ["react", "observability", "dashboards"],
      sourceUrl: "https://runesmith.io/careers/frontend",
    },
  },
  {
    id: "demo-app-07",
    company: "Paperbound",
    role: "DX & Docs",
    cvSlug: "writer",
    url: "https://paperbound.dev/hiring",
    daysAgo: 7,
    status: "applied",
    statusHistory: [{ daysAgo: 7, to: "applied" }],
    jobData: {
      title: "DX & Docs",
      company: "Paperbound",
      location: "Remote",
      description:
        "Paperbound is a developer-tools company building deployment primitives. We need a writer to own the docs.",
      requirements: [
        "Portfolio of published developer docs",
        "Comfortable reading and running code",
      ],
      responsibilities: [
        "Own the docs site",
        "Write release notes and blog posts",
        "Pair with engineers on the public API",
      ],
      keywords: ["developer docs", "technical writing", "deploys"],
      sourceUrl: "https://paperbound.dev/hiring",
    },
  },
  {
    id: "demo-app-08",
    company: "Atlas & Ledger",
    role: "Senior Product Designer",
    cvSlug: "designer",
    url: "https://atlasledger.co/jobs/senior-designer",
    daysAgo: 26,
    status: "draft",
    notes:
      "Application is drafted but I want to tailor the portfolio link before sending.",
    statusHistory: [],
    jobData: {
      title: "Senior Product Designer",
      company: "Atlas & Ledger",
      location: "London (hybrid)",
      salary: "£80–100k",
      description:
        "Atlas & Ledger is a small fintech building tools for independent bookkeepers.",
      requirements: [
        "5+ years of product design experience",
        "Prior fintech or workflow-tools work",
      ],
      responsibilities: [
        "Own the bookkeeper-facing workflows",
        "Partner with two engineers on the design system",
      ],
      keywords: ["product design", "fintech", "workflow"],
      sourceUrl: "https://atlasledger.co/jobs/senior-designer",
    },
  },
];

export function buildDemoApplications(now: number = Date.now()): Application[] {
  return SEEDS.map((seed) => {
    const dateCreated = now - seed.daysAgo * DAY;
    const events: ApplicationEvent[] = (seed.statusHistory ?? []).map(
      (h, idx, all) => ({
        at: now - h.daysAgo * DAY,
        kind: "status-change",
        from: idx === 0 ? undefined : all[idx - 1].to,
        to: h.to,
        note: h.note,
      }),
    );

    const app: Application = {
      id: seed.id,
      company: seed.company,
      role: seed.role,
      url: seed.url,
      cvSlug: seed.cvSlug,
      dateCreated,
      status: seed.status,
      jobData: seed.jobData,
      events: events.length > 0 ? events : undefined,
      notes: seed.notes,
    };
    return app;
  });
}
