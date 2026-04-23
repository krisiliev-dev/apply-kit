// Curated palettes. Each is a confident editorial combination — avoid
// "professional blue" corporate defaults. Meant to push toward distinctive
// design, not safety.

export type Palette = {
  id: string;
  name: string;
  ink: string;
  paper: string;
  accent: string;
};

export const PALETTES: Palette[] = [
  {
    id: "default",
    name: "Ember",
    ink: "#111111",
    paper: "#fafaf7",
    accent: "#d64933",
  },
  {
    id: "noir",
    name: "Noir",
    ink: "#0b0b0b",
    paper: "#ece6d9",
    accent: "#6e1f1f",
  },
  {
    id: "editorial",
    name: "Editorial",
    ink: "#111d2e",
    paper: "#f5f1e8",
    accent: "#e4a93a",
  },
  {
    id: "blueprint",
    name: "Blueprint",
    ink: "#1a2940",
    paper: "#f4f3ee",
    accent: "#2b6cff",
  },
  {
    id: "monochrome",
    name: "Monochrome",
    ink: "#1a1a1a",
    paper: "#f2f2f2",
    accent: "#1a1a1a",
  },
  {
    id: "warm",
    name: "Warm",
    ink: "#3a241b",
    paper: "#f2e5d5",
    accent: "#b4502f",
  },
  {
    id: "clinical",
    name: "Clinical",
    ink: "#1f2937",
    paper: "#f9fafb",
    accent: "#0d9488",
  },
  {
    id: "terminal",
    name: "Terminal",
    ink: "#0a0a0a",
    paper: "#eaf0ea",
    accent: "#00854a",
  },
  {
    id: "paper",
    name: "Paper",
    ink: "#2a2a2a",
    paper: "#ffffff",
    accent: "#ff5c38",
  },
];

export function matchPaletteId(
  colors: { ink: string; paper: string; accent: string } | undefined,
): string | null {
  if (!colors) return null;
  const norm = (c: string) => c.toLowerCase();
  for (const p of PALETTES) {
    if (
      norm(p.ink) === norm(colors.ink) &&
      norm(p.paper) === norm(colors.paper) &&
      norm(p.accent) === norm(colors.accent)
    ) {
      return p.id;
    }
  }
  return null;
}
