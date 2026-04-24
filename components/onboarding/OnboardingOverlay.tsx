"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/lib/settings/store";
import {
  readBackupFile,
  restoreAllState,
} from "@/lib/settings/backup";
import { cvList } from "@/content/cvs";
import { saveToStorage } from "@/lib/doc/persist";
import { seedFromContent } from "@/lib/jobs/seedFromContent";
import { saveAllToStorage } from "@/lib/app/persist";
import { APPLICATIONS_STORAGE_KEY } from "@/lib/app/types";
import { buildDemoApplications } from "@/lib/app/demoSeed";

// Full-screen first-run overlay. Renders only when:
//   - `settings.ui.showOnboarding === true`
//   - AND there are no `cv-maker:doc:*` keys
//   - AND there are no applications yet
//
// Closing the wizard flips `showOnboarding` off so it stays gone. The Settings
// > General tab exposes a "Reopen onboarding" button to flip it back on.

const CV_DOC_KEY_PREFIX = "cv-maker:doc:";

type Step = "welcome" | "ai" | "start" | "done";

function hasExistingData(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(APPLICATIONS_STORAGE_KEY)) return true;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CV_DOC_KEY_PREFIX)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function OnboardingOverlay() {
  const loaded = useSettings((s) => s.loaded);
  const load = useSettings((s) => s.load);
  const showOnboarding = useSettings((s) => s.ui.showOnboarding);
  const setUi = useSettings((s) => s.setUi);
  const setModelFeature = useSettings((s) => s.setModelFeature);

  // Gate on mount — a fresh browser with pre-existing data shouldn't see the
  // overlay even if someone toggled it back on via settings. That's the
  // intent for the Reopen button though — so we track whether the user
  // explicitly asked for it via a "force open" state.
  const [mounted, setMounted] = useState(false);
  const [hadData, setHadData] = useState(false);
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [ollamaBase, setOllamaBase] = useState("http://localhost:11434/v1");
  const [ollamaTest, setOllamaTest] = useState<
    { kind: "ok"; models: string[] } | { kind: "error"; msg: string } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    load();
    setMounted(true);
    setHadData(hasExistingData());
  }, [load]);

  const visible = useMemo(() => {
    if (!mounted || !loaded) return false;
    if (!showOnboarding) return false;
    if (hadData) return false;
    return true;
  }, [mounted, loaded, showOnboarding, hadData]);

  const close = useCallback(() => {
    setUi({ showOnboarding: false });
  }, [setUi]);

  // Escape closes the wizard — matches native dialog behaviour. We attach
  // at the document level so focus doesn't need to be inside a specific
  // element for the keypress to register.
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, close]);

  const pickHosted = useCallback(() => {
    setModelFeature("default", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
    });
    setStep("start");
  }, [setModelFeature]);

  const pickLocal = useCallback(() => {
    setModelFeature("default", {
      provider: "ollama-openai-compat",
      model: "llama3.2:latest",
      baseUrl: ollamaBase,
      label: "Ollama llama3.2",
    });
    setStep("start");
  }, [setModelFeature, ollamaBase]);

  const testOllama = useCallback(async () => {
    setOllamaTest(null);
    try {
      const url = ollamaBase.replace(/\/$/, "") + "/models";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { id?: string }[] };
      const models = Array.isArray(body.data)
        ? body.data
            .map((m) => m.id)
            .filter((x): x is string => typeof x === "string")
        : [];
      setOllamaTest({ kind: "ok", models });
    } catch (err) {
      setOllamaTest({
        kind: "error",
        msg: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [ollamaBase]);

  const populateDemo = useCallback(() => {
    for (const cv of cvList) {
      const doc = seedFromContent(cv.slug, cv);
      saveToStorage(doc);
    }
    saveAllToStorage(buildDemoApplications());
    setStep("done");
  }, []);

  const onImportFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const payload = await readBackupFile(file);
      restoreAllState(payload);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const startEmpty = useCallback(() => {
    setStep("done");
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 bg-paper z-40 flex items-center justify-center p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome — CV Workshop setup"
    >
      <div className="max-w-xl w-full">
        {step === "welcome" ? (
          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-2">
              Welcome
            </p>
            <h1 className="font-display text-5xl mb-4">
              A <em>local</em> CV workshop.
            </h1>
            <p className="text-ink/80 mb-8">
              Tailor CVs to roles, track applications, and let an AI copilot
              do the grunt work. Everything lives in your browser — nothing
              leaves except prompts to whatever AI you choose.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep("ai")}
                className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink"
              >
                Get set up
              </button>
              <button
                type="button"
                onClick={close}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 px-4 py-2 hover:text-ink"
              >
                Skip for now
              </button>
            </div>
          </section>
        ) : null}

        {step === "ai" ? (
          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-2">
              Step 2 of 3 — Pick your AI
            </p>
            <h2 className="font-display text-4xl mb-6">
              Hosted or <em>local?</em>
            </h2>
            <div className="space-y-4">
              <button
                type="button"
                onClick={pickHosted}
                className="w-full text-left border border-ink/15 p-4 hover:border-ink"
              >
                <div className="font-display text-2xl">Hosted (Anthropic)</div>
                <div className="text-sm text-ink/70 mt-1">
                  Uses Claude. Roughly pennies per CV draft. Add{" "}
                  <code className="font-mono text-[11px]">ANTHROPIC_API_KEY</code>{" "}
                  to <code className="font-mono text-[11px]">.env.local</code>,
                  restart <code className="font-mono text-[11px]">npm run dev</code>.
                </div>
              </button>

              <div className="border border-ink/15 p-4">
                <div className="font-display text-2xl">Local (Ollama)</div>
                <div className="text-sm text-ink/70 mt-1 mb-3">
                  Runs against a model on your machine. Free, but you need
                  Ollama or an OpenAI-compatible server running.
                </div>
                <div className="flex gap-2">
                  <label htmlFor="onboarding-ollama-base" className="sr-only">
                    Ollama base URL
                  </label>
                  <input
                    id="onboarding-ollama-base"
                    type="text"
                    value={ollamaBase}
                    onChange={(e) => setOllamaBase(e.target.value)}
                    className="flex-1 border border-ink/20 bg-white px-3 py-2 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={testOllama}
                    className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/20 px-3 py-2 hover:border-ink/50"
                  >
                    Test
                  </button>
                </div>
                {ollamaTest ? (
                  <div className="mt-2 font-mono text-[11px]">
                    {ollamaTest.kind === "ok" ? (
                      <span className="text-green-700">
                        OK — {ollamaTest.models.length} model
                        {ollamaTest.models.length === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="text-red-700">
                        Failed: {ollamaTest.msg}
                      </span>
                    )}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={pickLocal}
                  className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink"
                >
                  Use local
                </button>
              </div>
            </div>
            <div className="mt-8 flex gap-3">
              <button
                type="button"
                onClick={() => setStep("welcome")}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 px-4 py-2 hover:text-ink"
              >
                ← back
              </button>
              <button
                type="button"
                onClick={() => setStep("start")}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 px-4 py-2 hover:text-ink"
              >
                Skip →
              </button>
            </div>
          </section>
        ) : null}

        {step === "start" ? (
          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-2">
              Step 3 of 3 — Pick your start
            </p>
            <h2 className="font-display text-4xl mb-6">
              How do you want to <em>begin?</em>
            </h2>
            <div className="space-y-4">
              <button
                type="button"
                onClick={populateDemo}
                className="w-full text-left border border-ink/15 p-4 hover:border-ink"
              >
                <div className="font-display text-2xl">Populate demo</div>
                <div className="text-sm text-ink/70 mt-1">
                  Seeds 3 CV variants + 8 sample applications using the
                  fictional Ines Valverde persona. Good for clicking around.
                </div>
              </button>
              <div className="border border-ink/15 p-4">
                <div className="font-display text-2xl">Import from backup</div>
                <div className="text-sm text-ink/70 mt-1 mb-3">
                  Pick a <code className="font-mono text-[11px]">
                    cv-maker-backup-*.json
                  </code>{" "}
                  file you exported earlier.
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink"
                >
                  Choose file…
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onImportFile(f);
                    e.target.value = "";
                  }}
                />
                {error ? (
                  <p className="mt-2 font-mono text-[11px] text-red-700">
                    {error}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={startEmpty}
                className="w-full text-left border border-ink/15 p-4 hover:border-ink"
              >
                <div className="font-display text-2xl">Start empty</div>
                <div className="text-sm text-ink/70 mt-1">
                  I'll build my profile in the editor. Open a CV variant and
                  start typing.
                </div>
              </button>
            </div>
            <div className="mt-8">
              <button
                type="button"
                onClick={() => setStep("ai")}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 px-4 py-2 hover:text-ink"
              >
                ← back
              </button>
            </div>
          </section>
        ) : null}

        {step === "done" ? (
          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-2">
              You're set
            </p>
            <h2 className="font-display text-5xl mb-4">
              Three main <em>routes.</em>
            </h2>
            <ul className="space-y-3 text-ink/80 mb-6">
              <li>
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60">
                  /
                </span>{" "}
                — CV variants. Each opens in a visual editor with an AI
                copilot.
              </li>
              <li>
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60">
                  /applications
                </span>{" "}
                — your application tracker. Status pipeline, follow-ups,
                cover letters, salary, prep.
              </li>
              <li>
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60">
                  /advisor
                </span>{" "}
                — the longer-arc view. Narrative, skill-gap, ceiling,
                decisions.
              </li>
            </ul>
            <p className="text-ink/70 text-sm mb-6">
              Settings live at{" "}
              <Link href="/settings" className="underline">
                /settings
              </Link>
              . You can toggle backup folders, clear data, and swap models
              any time.
            </p>
            <button
              type="button"
              onClick={close}
              className="font-mono text-[11px] uppercase tracking-[0.2em] border border-ink/30 px-4 py-2 hover:border-ink"
            >
              Close &amp; reload
            </button>
          </section>
        ) : null}
      </div>
    </div>
  );
}
