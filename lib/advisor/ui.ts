import type { RoleTier } from "./types";

// Shared formatting helpers for advisor UI.

export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(ts).toLocaleDateString();
}

export const TIER_LABEL: Record<RoleTier, string> = {
  below: "Below level",
  "in-range": "In range",
  stretch: "Stretch",
  aspirational: "Aspirational",
};

// Subtle color tints per tier — aligns with the ink/paper/accent palette.
// Using inline style strings so tailwind's JIT doesn't choke on dynamic class names.
export const TIER_TINT: Record<RoleTier, { border: string; bg: string; label: string }> = {
  below: {
    border: "border-ink/20",
    bg: "bg-ink/[0.04]",
    label: "text-ink/50",
  },
  "in-range": {
    border: "border-ink/40",
    bg: "bg-ink/[0.06]",
    label: "text-ink/80",
  },
  stretch: {
    border: "border-accent/40",
    bg: "bg-accent/[0.06]",
    label: "text-accent",
  },
  aspirational: {
    border: "border-accent/25",
    bg: "bg-accent/[0.03]",
    label: "text-accent/70",
  },
};
