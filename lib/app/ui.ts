import type { ApplicationStatus } from "./types";

// Subtle tint per status. Stays in the light-aesthetic palette; no hot colors.
export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: "Draft",
  applied: "Applied",
  screen: "Screen",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const STATUS_CLASS: Record<ApplicationStatus, string> = {
  draft: "bg-ink/5 text-ink/70 border-ink/10",
  applied: "bg-ink/5 text-ink border-ink/15",
  screen: "bg-accent/10 text-accent border-accent/25",
  interview: "bg-accent/15 text-accent border-accent/30",
  offer: "bg-ink text-paper border-ink",
  rejected: "bg-ink/5 text-ink/40 border-ink/10 line-through",
  withdrawn: "bg-ink/5 text-ink/40 border-ink/10",
};

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
