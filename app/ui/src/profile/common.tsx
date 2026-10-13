// Shared parts of Profile (hi-fi: docs/design/hifi/profile.html): the section links with their
// counts, the words for piece types and number sources, and in-page navigation between Profile's views.
import type { Angle, NumberSource, PieceKind, ProfilePiece, ProfileSummary } from "@apply-kit/core";
import { entryLabel } from "@apply-kit/core/profile";
import type { MouseEvent } from "react";

export const kindLabel: Record<PieceKind, string> = { role: "Role", achievement: "Achievement", skill: "Skill", education: "Education" };
export const kindPlural: Record<PieceKind, string> = { role: "Roles", achievement: "Achievements", skill: "Skills", education: "Education" };
export const angleLabel: Record<Angle, string> = { developer: "Developer", security: "Security", design: "Design" };
export const numberSourceLabel: Record<NumberSource, string> = {
  measured: "Measured",
  estimate: "Estimate you'd defend",
  told: "Someone told you",
};

/** The piece in a few words, for button names ("Edit · Splunk detections…"). */
export function pieceName(p: ProfilePiece): string {
  if (p.entry) return `${p.entry.title} at ${p.entry.organisation}`;
  return p.text.length > 48 ? `${p.text.slice(0, 46)}…` : p.text;
}

export const pieceText = (p: ProfilePiece) => (p.entry ? entryLabel(p.entry) : p.text);

export const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Moves between Profile's views without a page load; Back and Forward work as usual. */
export type Go = (path: string) => void;

/** A real link that Profile follows in place (a modified click still opens a new tab). */
export function navLink(go: Go) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    go(e.currentTarget.getAttribute("href")!);
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Profile's areas as links (not tabs). A count shows only where something needs Kris; the counts add
 * up to the nav badge. Search and dealbreakers is the existing search settings page.
 */
export function ProfileSections({ current, summary, go }: { current: string; summary: ProfileSummary | null; go: Go }) {
  const n = summary?.needsYou;
  const sections = [
    { href: "/profile", label: "Master profile", count: n?.masterProfile ?? 0 },
    { href: "/profile/angles", label: "Angles", count: n?.angles ?? 0 },
    { href: "/profile/answers", label: "Answer bank", count: n?.answerBank ?? 0 },
    { href: "/profile/voice", label: "Voice", count: n?.voice ?? 0 },
    { href: "/profile/search", label: "Search and dealbreakers", count: 0 },
  ];
  return (
    <nav className="subnav" aria-label="Profile">
      {sections.map((s) => (
        <a key={s.href} href={s.href} aria-current={s.href === current ? "page" : undefined} onClick={navLink(go)}>
          {s.label}
          {s.count > 0 && (
            <>
              <span className="n" aria-hidden="true">{s.count}</span>
              <span className="sr-only">, {plural(s.count, "needs you", "need you")}</span>
            </>
          )}
        </a>
      ))}
    </nav>
  );
}
