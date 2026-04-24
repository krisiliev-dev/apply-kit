import Link from "next/link";
import { cvList } from "@/content/cvs";
import { DemoControls, DemoHint } from "@/components/home/DemoControls";
import { CapturedPill } from "@/components/pair/CapturedPill";

export default function Home() {
  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <header className="mb-12">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            CV Workshop
          </p>
          <div className="flex items-center gap-3">
            {/* Pill only renders when the pair inbox has captures; hidden
                otherwise so it doesn't clutter the header. */}
            <CapturedPill />
            <nav className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/50 flex gap-4">
              <Link href="/discover" className="hover:text-ink">
                Discover
              </Link>
              <Link href="/applications" className="hover:text-ink">
                Applications
              </Link>
              <Link href="/jobs" className="hover:text-ink">
                Jobs
              </Link>
              <Link href="/pair" className="hover:text-ink">
                Pair
              </Link>
            </nav>
          </div>
        </div>
        <h1 className="font-display text-5xl mt-2">
          Your CVs, <em>tailored per role.</em>
        </h1>
        <p className="mt-4 text-ink/70 max-w-prose">
          Each CV variant opens in a visual editor with an AI copilot. Click
          anything on the page to edit it, drag to move, resize from the
          handles. Ask the copilot to make bigger changes in plain English.
        </p>
      </header>

      <section>
        <div className="flex items-baseline justify-between mb-4 gap-4">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
            CV variants
          </h2>
          <Link
            href="/cv/compare"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink underline decoration-ink/20 underline-offset-4"
          >
            Compare variants →
          </Link>
        </div>
        <DemoHint />
        <ul className="divide-y divide-ink/10 border-y border-ink/10">
          {cvList.map((cv) => (
            <li key={cv.slug}>
              <Link
                href={`/cv/${cv.slug}`}
                className="flex items-baseline justify-between py-4 hover:opacity-70"
              >
                <span className="font-display text-2xl">{cv.targetRole}</span>
                <span className="font-mono text-xs text-ink/60">/cv/{cv.slug}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/cv/new"
              className="flex items-baseline justify-between py-4 hover:opacity-70 text-ink/50"
            >
              <span className="font-display text-2xl italic">+ blank variant</span>
              <span className="font-mono text-xs">/cv/new</span>
            </Link>
          </li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-4">
          Apply to a role
        </h2>
        <Link
          href="/jobs"
          className="flex items-baseline justify-between py-4 border-y border-ink/10 hover:opacity-70"
        >
          <span className="font-display text-2xl italic">
            Paste a job → tailored CV
          </span>
          <span className="font-mono text-xs text-ink/60">/jobs</span>
        </Link>
      </section>

      <footer className="mt-16 space-y-6">
        <DemoControls />
        <div className="font-mono text-[11px] text-ink/50 space-y-1">
          <p>⌘Z undo · ⌘⇧Z redo · ⌘D duplicate · Del delete · Esc deselect</p>
          <p>⌘/Ctrl + scroll = zoom</p>
          <p>
            For AI chat: add <code>ANTHROPIC_API_KEY</code> to{" "}
            <code>.env.local</code>
          </p>
        </div>
      </footer>
    </main>
  );
}
