"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { defaultCV } from "@/content/cvs/default";
import { saveToStorage } from "@/lib/doc/persist";
import { readApplications, upsertApplication } from "@/lib/app/storage";
import type { Application, ParsedJob } from "@/lib/app/types";
import { makeVariantSlug, upsertVariant } from "@/lib/jobs/registry";
import { seedFromContent } from "@/lib/jobs/seedFromContent";
import { saveDraftEval, type DraftEvalResult } from "@/lib/evaluation/keywords";
import type { CVContent } from "@/lib/types";

type Stage = "idle" | "parsing" | "drafting" | "error";

export default function JobsPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [apps, setApps] = useState<Application[]>([]);

  useEffect(() => {
    setApps(readApplications());
  }, []);

  const disabled = stage !== "idle" && stage !== "error";

  const hasInput = useMemo(
    () => url.trim().length > 0 || text.trim().length > 0,
    [url, text],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasInput || disabled) return;

    setErrorMsg("");
    setStage("parsing");
    setStatusMsg("Reading the job post…");

    let job: ParsedJob;
    try {
      const res = await fetch("/api/jobs/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), text: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStage("error");
        setErrorMsg(data?.error ?? "Failed to parse job.");
        return;
      }
      job = data.job as ParsedJob;
    } catch (err) {
      setStage("error");
      setErrorMsg(err instanceof Error ? err.message : "Network error.");
      return;
    }

    setStage("drafting");
    setStatusMsg(`Tailoring a CV for ${job.company} — ${job.title}…`);

    let tailored: CVContent & { tailoringNotes?: string[] };
    let draftEval: DraftEvalResult | undefined;
    try {
      const res = await fetch("/api/jobs/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job, baseCv: defaultCV }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStage("error");
        setErrorMsg(data?.error ?? "Failed to draft tailored CV.");
        return;
      }
      tailored = data.cv;
      draftEval = data.eval as DraftEvalResult | undefined;
    } catch (err) {
      setStage("error");
      setErrorMsg(err instanceof Error ? err.message : "Network error.");
      return;
    }

    // Persist the new CV variant + application record.
    const slug = makeVariantSlug(job.company, job.title);
    const variantContent: CVContent = {
      slug,
      targetRole: tailored.targetRole,
      profile: tailored.profile,
      experiences: tailored.experiences,
      education: tailored.education,
      skills: tailored.skills,
      interests: tailored.interests,
    };
    const doc = seedFromContent(slug, variantContent);
    saveToStorage(doc);
    upsertVariant({
      slug,
      targetRole: variantContent.targetRole,
      company: job.company,
      createdAt: Date.now(),
      source: "job",
    });

    const appId = nanoid(10);
    const application: Application = {
      id: appId,
      company: job.company,
      role: job.title,
      url: job.sourceUrl,
      jobDescriptionRaw: text.trim() || undefined,
      jobData: job,
      cvSlug: slug,
      dateCreated: Date.now(),
      status: "draft",
      events: [
        {
          at: Date.now(),
          kind: "draft-created",
          note: tailored.tailoringNotes?.join(" · "),
        },
      ],
    };
    upsertApplication(application);
    if (draftEval) saveDraftEval(appId, draftEval);

    // Go to the editor for quick polish, but also expose /jobs/[appId]
    // for the prefilled-form flow later.
    router.push(`/cv/${slug}?appId=${appId}`);
  }

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <header className="mb-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Apply
        </p>
        <h1 className="font-display text-5xl mt-2">
          One role, <em>one tailored CV.</em>
        </h1>
        <p className="mt-4 text-ink/70 max-w-prose">
          Paste a job URL or the full description. A tailored variant of your
          default CV is drafted — you land in the editor to polish it.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="job-url"
            className="block font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-2"
          >
            Job URL
          </label>
          <input
            id="job-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={disabled}
            placeholder="https://boards.greenhouse.io/company/jobs/123"
            className="w-full border border-ink/20 bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:border-ink disabled:opacity-50"
          />
          <p className="font-mono text-[10px] text-ink/50 mt-1">
            LinkedIn / Indeed aren&apos;t supported — their ToS forbids scraping.
            Paste the text below instead.
          </p>
        </div>

        <div className="text-center font-mono text-[10px] uppercase tracking-[0.25em] text-ink/40">
          or
        </div>

        <div>
          <label
            htmlFor="job-text"
            className="block font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-2"
          >
            Paste description
          </label>
          <textarea
            id="job-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={disabled}
            rows={10}
            placeholder="Paste the full job posting here…"
            className="w-full border border-ink/20 bg-paper px-3 py-2 text-sm focus:outline-none focus:border-ink disabled:opacity-50 font-sans leading-relaxed"
          />
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={!hasInput || disabled}
            className="border border-ink bg-ink text-paper px-5 py-2 font-mono text-xs uppercase tracking-[0.2em] hover:bg-transparent hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {stage === "parsing"
              ? "Parsing…"
              : stage === "drafting"
                ? "Drafting…"
                : "Tailor CV"}
          </button>
          {stage !== "idle" && stage !== "error" && (
            <span className="font-mono text-xs text-ink/60">{statusMsg}</span>
          )}
          {stage === "error" && (
            <span className="font-mono text-xs text-accent">{errorMsg}</span>
          )}
        </div>
      </form>

      {apps.length > 0 && (
        <section className="mt-16">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-4">
            Drafts & applications
          </h2>
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {apps
              .slice()
              .sort((a, b) => b.dateCreated - a.dateCreated)
              .map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/jobs/${a.id}`}
                    className="flex items-baseline justify-between py-4 hover:opacity-70"
                  >
                    <span>
                      <span className="font-display text-2xl">{a.role}</span>
                      <span className="ml-3 font-mono text-xs text-ink/60">
                        {a.company}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">
                      {a.status}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

      <footer className="mt-16 font-mono text-[11px] text-ink/50 space-y-1">
        <p>
          <Link href="/" className="underline underline-offset-4">
            ← back to CVs
          </Link>
        </p>
      </footer>
    </main>
  );
}
