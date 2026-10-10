import type { Profile } from "@/lib/types";

// Shared baseline — stable identity across CV variants.
// This is the demo persona shipped on first run. Clear the demo (home screen)
// to swap in your own identity.
export const profile: Profile = {
  name: "Ines Valverde",
  title: "Design-leaning technologist",
  email: "ines@valverde.studio",
  location: "Lisbon, PT",
  phone: "+351 910 000 000",
  links: [
    { label: "site", href: "https://valverde.studio" },
    { label: "github", href: "https://github.com/inesvalverde" },
    { label: "x", href: "https://x.com/inesvalverde" },
    { label: "linkedin", href: "https://linkedin.com/in/inesvalverde" },
  ],
  summary:
    "Builds small, opinionated tools for people who read the docs. Designs type-first, ships front-to-back, and writes the changelog herself.",
};
