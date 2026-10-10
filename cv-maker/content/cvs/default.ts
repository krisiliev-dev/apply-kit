import type { CVContent } from "@/lib/types";
import { profile } from "@/content/profile";

export const defaultCV: CVContent = {
  slug: "default",
  targetRole: "Generalist",
  profile,
  experiences: [
    {
      role: "Role Title",
      company: "Company",
      location: "City",
      dates: { start: "2023", end: "present" },
      summary: "One-line framing of what this role is about.",
      bullets: [
        "A concrete thing you shipped, with a number if possible.",
        "A second bullet that shows a different kind of work.",
      ],
      tags: ["tag-a", "tag-b"],
    },
  ],
  education: [
    {
      school: "University",
      degree: "BSc Something",
      dates: { start: "2019", end: "2023" },
    },
  ],
  skills: [
    { label: "Stack", items: ["TypeScript", "React", "Next.js"] },
    { label: "Tools", items: ["Figma", "git", "Vercel"] },
  ],
  interests: ["typography", "photography", "long walks"],
};
