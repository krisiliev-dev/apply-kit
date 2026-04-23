import type { DateRange, Experience, SkillGroup } from "@/lib/types";

// Small helpers. Use them or ignore them — each CV page has full freedom.
// Designed so you can restyle via className without fighting defaults.

export function formatDates({ start, end }: DateRange) {
  return `${start} — ${end === "present" ? "present" : end}`;
}

export function SectionHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60 mb-2 ${className}`}
    >
      {children}
    </h2>
  );
}

export function Tag({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-block font-mono text-[10px] tracking-wider px-1.5 py-0.5 border border-ink/20 ${className}`}
    >
      {children}
    </span>
  );
}

export function ExperienceEntry({
  exp,
  className = "",
}: {
  exp: Experience;
  className?: string;
}) {
  return (
    <article className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-display text-xl leading-tight">
          {exp.role} <span className="text-ink/50">·</span> {exp.company}
        </h3>
        <span className="font-mono text-[10px] text-ink/60 whitespace-nowrap">
          {formatDates(exp.dates)}
        </span>
      </div>
      {exp.summary && (
        <p className="text-sm text-ink/70 mt-1 italic">{exp.summary}</p>
      )}
      {exp.bullets && exp.bullets.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm list-disc pl-4">
          {exp.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {exp.tags && exp.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {exp.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}
    </article>
  );
}

export function SkillList({
  groups,
  className = "",
}: {
  groups: SkillGroup[];
  className?: string;
}) {
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm ${className}`}>
      {groups.map((g) => (
        <div key={g.label} className="contents">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-ink/60 pt-1">
            {g.label}
          </dt>
          <dd>{g.items.join(" · ")}</dd>
        </div>
      ))}
    </dl>
  );
}
