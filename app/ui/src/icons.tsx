// State icons from the hi-fi screens. No state is shown by colour alone (DESIGN.md principle 5).
import type { ReactNode } from "react";

export type IconName = "met" | "partly" | "gap" | "ask" | "unknown" | "info" | "target";

const paths: Record<IconName, ReactNode> = {
  met: <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  partly: (
    <>
      <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 1.8a4.2 4.2 0 0 1 0 8.4z" fill="currentColor" />
    </>
  ),
  gap: <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  ask: (
    <>
      <path d="M4.3 4.4a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6" cy="9.8" r=".9" fill="currentColor" />
    </>
  ),
  // Not checked yet: a dotted ring, deliberately unlike met, partly or gap.
  unknown: <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1.6 1.8" />,
  info: (
    <>
      <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 3.6v3M6 8.2v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  target: (
    <>
      <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="6" r="1.7" fill="currentColor" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 12 12" aria-hidden="true">{paths[name]}</svg>;
}

export function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
