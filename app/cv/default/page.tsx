import { CvPage } from "@/components/cv/CvPage";
import {
  ExperienceEntry,
  SectionHeading,
  SkillList,
} from "@/components/cv/primitives";
import { defaultCV } from "@/content/cvs/default";

// This whole file is yours to redesign. Rearrange, swap components for raw
// JSX, add SVG, absolute-position things, whatever. The primitives above are
// helpers — not required.

export default function DefaultCV() {
  const cv = defaultCV;
  const { profile } = cv;

  return (
    <main className="min-h-screen flex flex-col items-center gap-8 py-8 px-4 bg-neutral-200">
      <CvPage>
        {/* ——— masthead ——— */}
        <header className="border-b border-ink/20 pb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
            curriculum vitae — {cv.targetRole}
          </p>
          <h1 className="font-display text-[76px] leading-none mt-3">
            {profile.name}
          </h1>
          <p className="font-display italic text-2xl text-ink/70 mt-1">
            {profile.title}
          </p>

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-ink/70">
            <span>{profile.email}</span>
            {profile.location && <span>{profile.location}</span>}
            {profile.links?.map((l) => (
              <a key={l.href} href={l.href} className="underline-offset-2 hover:underline">
                {l.label} ↗
              </a>
            ))}
          </div>
        </header>

        {/* ——— two-column body ——— */}
        <div className="mt-8 grid grid-cols-[1fr_2fr] gap-8">
          {/* sidebar */}
          <aside className="space-y-8">
            {profile.summary && (
              <section>
                <SectionHeading>About</SectionHeading>
                <p className="font-display text-lg italic leading-snug">
                  {profile.summary}
                </p>
              </section>
            )}

            {cv.skills && (
              <section>
                <SectionHeading>Skills</SectionHeading>
                <SkillList groups={cv.skills} />
              </section>
            )}

            {cv.education.length > 0 && (
              <section>
                <SectionHeading>Education</SectionHeading>
                <ul className="space-y-3 text-sm">
                  {cv.education.map((e) => (
                    <li key={e.school}>
                      <div className="font-display text-base">{e.degree}</div>
                      <div className="text-ink/70">{e.school}</div>
                      <div className="font-mono text-[10px] text-ink/60">
                        {e.dates.start} — {e.dates.end}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {cv.interests && cv.interests.length > 0 && (
              <section>
                <SectionHeading>Interests</SectionHeading>
                <p className="text-sm text-ink/80">{cv.interests.join(", ")}</p>
              </section>
            )}
          </aside>

          {/* main column */}
          <section className="space-y-6">
            <SectionHeading>Experience</SectionHeading>
            <div className="space-y-6">
              {cv.experiences.map((exp, i) => (
                <ExperienceEntry key={i} exp={exp} />
              ))}
            </div>
          </section>
        </div>
      </CvPage>
    </main>
  );
}
