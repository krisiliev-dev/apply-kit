import type { Profile } from "@/lib/types";

// Shared baseline — your stable identity across CV variants.
// Each CV variant (in content/cvs/*) can override or add to this.
export const profile: Profile = {
  name: "Your Name",
  title: "Your Title",
  email: "you@example.com",
  location: "City, Country",
  links: [
    { label: "site", href: "https://example.com" },
    { label: "github", href: "https://github.com/you" },
  ],
  summary:
    "A short line about who you are and what you care about. Rewrite per role.",
};
