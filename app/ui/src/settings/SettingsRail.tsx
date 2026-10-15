/** The Settings sections, with the one shown marked. Sections without a screen yet show "not built". */
const sections = [
  { href: "/settings/sources", label: "Sources & watchlist" },
  { href: "/settings/follow-ups", label: "Follow-ups" },
  { href: "/settings/mailbox", label: "Mailbox" },
  { href: "/settings/model", label: "Model & budget" },
  { href: "/settings/data", label: "Data & privacy" },
];

export function SettingsRail({ current }: { current: string }) {
  return (
    <nav className="rail" aria-label="Settings sections">
      <span className="rail-h">Settings</span>
      {sections.map((s) => <a key={s.href} href={s.href} aria-current={s.href === current ? "page" : undefined}>{s.label}</a>)}
    </nav>
  );
}
