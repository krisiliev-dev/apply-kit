"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Shared top navigation for the app chrome (everything except the full-screen
// CV editor). Sticky, dark, with an active-route highlight. Pages render this
// at the top of their <main>.

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/discover", label: "Discover" },
  { href: "/jobs", label: "Jobs" },
  { href: "/applications", label: "Applications" },
  { href: "/advisor", label: "Advisor" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppNav() {
  const pathname = usePathname() ?? "/";
  return (
    <header className="sticky top-0 z-40 -mx-6 mb-10 border-b border-line bg-paper/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4">
        <Link
          href="/"
          className="font-mono text-[13px] font-semibold tracking-[0.18em] text-ink hover:text-accent"
        >
          CV<span className="text-accent">·</span>MAKER
        </Link>
        <nav
          aria-label="Primary"
          className="flex items-center gap-0.5 text-sm"
        >
          {LINKS.filter((l) => l.href !== "/").map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={
                  "rounded-md px-3 py-1.5 transition-colors " +
                  (active
                    ? "bg-surface-2 font-medium text-ink"
                    : "text-ink/55 hover:bg-surface hover:text-ink")
                }
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
