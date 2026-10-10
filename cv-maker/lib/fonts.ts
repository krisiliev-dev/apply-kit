// Curated font list. Each option resolves to a CSS variable that's set on
// <body> in app/layout.tsx via next/font. Keep the list small and editorial;
// the point is *distinctive* typography, not a font catalogue.

export type FontCategory = "sans" | "display" | "serif" | "mono";

export type FontOption = {
  id: string;
  label: string;
  cssVar: string; // e.g. "var(--font-inter)"
  category: FontCategory;
  preview?: string;
  notes?: string;
};

export const FONT_OPTIONS: FontOption[] = [
  { id: "inter", label: "Inter", cssVar: "var(--font-inter)", category: "sans" },
  {
    id: "space-grotesk",
    label: "Space Grotesk",
    cssVar: "var(--font-space-grotesk)",
    category: "sans",
    notes: "Editorial neo-grotesque",
  },
  {
    id: "instrument-serif",
    label: "Instrument Serif",
    cssVar: "var(--font-instrument-serif)",
    category: "display",
    notes: "Elegant display serif",
  },
  {
    id: "fraunces",
    label: "Fraunces",
    cssVar: "var(--font-fraunces)",
    category: "display",
    notes: "Bold, contrasty, characterful",
  },
  {
    id: "playfair-display",
    label: "Playfair Display",
    cssVar: "var(--font-playfair-display)",
    category: "display",
    notes: "Classic editorial",
  },
  {
    id: "eb-garamond",
    label: "EB Garamond",
    cssVar: "var(--font-eb-garamond)",
    category: "serif",
    notes: "Literary body serif",
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    cssVar: "var(--font-jetbrains-mono)",
    category: "mono",
  },
  {
    id: "space-mono",
    label: "Space Mono",
    cssVar: "var(--font-space-mono)",
    category: "mono",
  },
];

export const FONT_BY_CSSVAR: Record<string, FontOption> = Object.fromEntries(
  FONT_OPTIONS.map((f) => [f.cssVar, f]),
);

export function findFontByCssVar(cssVar: string | undefined): FontOption | null {
  if (!cssVar) return null;
  return FONT_BY_CSSVAR[cssVar] ?? null;
}

// The three theme "slots". The theme stores a cssVar for each; the editor
// swaps which font backs which slot.
export const THEME_SLOTS = ["display", "sans", "mono"] as const;
export type ThemeSlot = (typeof THEME_SLOTS)[number];
