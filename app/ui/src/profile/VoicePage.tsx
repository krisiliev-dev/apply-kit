// Profile › Voice (hi-fi: docs/design/hifi/profile.html, state Voice samples): the local-only notice,
// what the voice learned as rules with their evidence (each removable), the samples (add, remove, and
// an unreadable one with its reason and Replace), and the "Learn from my edits" switch.
import type { VoiceRule, VoiceSample, VoiceView } from "@apply-kit/core";
import { useEffect, useRef, useState } from "react";
import { addVoiceSamples, fetchVoice, removeVoiceRule, removeVoiceSample, replaceVoiceSample, setVoiceLearning, toUpload } from "../api.ts";
import { Icon } from "../icons.tsx";
import { message } from "./common.tsx";

/** How often to look again while the voice is learning. */
const POLL_MS = 2_000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const kindLabel = { "cover-letter": "Cover letter", writing: "Personal writing" } as const;

export function VoicePage({ announce }: { announce: (msg: string) => void }) {
  const [voice, setVoice] = useState<VoiceView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** A change that failed: said in an alert that takes focus. */
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const failureRef = useRef<HTMLDivElement>(null);
  const rulesHeading = useRef<HTMLHeadingElement>(null);
  const samplesHeading = useRef<HTMLHeadingElement>(null);
  const wasUpdating = useRef(false);
  /** Where focus goes once a change's answer is on screen. */
  const focusNext = useRef<((v: VoiceView) => void) | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchVoice(ctrl.signal).then(setVoice).catch((err: unknown) => { if (!ctrl.signal.aborted) setLoadError(message(err)); });
    return () => ctrl.abort();
  }, []);

  // While it learns, look again until it's done; say once that the rules were updated.
  const updating = voice?.updating ?? false;
  useEffect(() => {
    if (updating) { wasUpdating.current = true; }
    else if (wasUpdating.current) { wasUpdating.current = false; announce("The voice rules are up to date."); }
    if (!updating) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => { fetchVoice(ctrl.signal).then(setVoice).catch(() => {}); }, POLL_MS);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [updating, voice, announce]);

  useEffect(() => { if (failure) failureRef.current?.focus(); }, [failure]);
  useEffect(() => {
    if (!voice || !focusNext.current) return;
    focusNext.current(voice);
    focusNext.current = null;
  }, [voice]);

  /**
   * Runs a change; the view it answers with replaces the page's. Controls stay focusable while it
   * runs (aria-disabled, so focus isn't lost), and a second change waits for the first.
   */
  const change = async (run: () => Promise<VoiceView>, said: (v: VoiceView) => string, focus?: (v: VoiceView) => void) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const v = await run();
      focusNext.current = focus ?? null;
      setVoice(v);
      announce(said(v));
    } catch (err) {
      setFailure(message(err));
    } finally {
      setBusy(false);
    }
  };

  const add = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    void change(
      async () => addVoiceSamples(await Promise.all(files.map(toUpload))),
      (v) => {
        const added = v.samples.slice(-files.length);
        const bad = added.filter((s) => s.problem).length;
        return `Added ${plural(files.length, "sample", "samples")}${bad ? `; ${bad} couldn't be read` : ""}.`;
      },
    );
  };

  const removeRule = (rule: VoiceRule, index: number) =>
    change(
      () => removeVoiceRule(rule.id),
      () => `Removed the rule "${rule.text}". It won't come back unless your writing shows it again.`,
      // Focus moves to the next rule's Remove (or the one before), or the heading when none are left.
      (v) => {
        const next = v.rules[Math.min(index, v.rules.length - 1)];
        const button = next && document.getElementById(`rule-remove-${next.id}`);
        if (button) button.focus();
        else rulesHeading.current?.focus();
      },
    );

  const removeSample = (sample: VoiceSample) =>
    change(() => removeVoiceSample(sample.id), () => `Removed ${sample.fileName}.`, () => samplesHeading.current?.focus());

  const replace = (sample: VoiceSample, file: File | undefined) => {
    if (!file) return;
    void change(
      async () => replaceVoiceSample(sample.id, await toUpload(file)),
      (v) => {
        const now = v.samples.find((s) => s.fileName === file.name);
        return now?.problem ? `${file.name} couldn't be read either. ${now.problem.message}` : `Replaced ${sample.fileName} with ${file.name}.`;
      },
      () => samplesHeading.current?.focus(),
    );
  };

  const toggle = (on: boolean) =>
    change(() => setVoiceLearning(on), () => (on ? "Learning from your edits again." : "Paused: your edits to drafts won't be recorded."));

  if (loadError) return <div className="banner error" role="alert"><span className="text"><b>Couldn't load your voice.</b> {loadError}</span></div>;
  if (!voice) return <p className="meta" role="status">Loading your voice…</p>;

  const readable = voice.samples.filter((s) => !s.problem).length;
  const from = [plural(voice.learnedFrom.samples, "sample", "samples"), voice.learnedFrom.edits > 0 && plural(voice.learnedFrom.edits, "edit", "edits")].filter(Boolean).join(" and ");

  return (
    <>
      <div className="banner info voice-notice">
        <span className="text">
          <span className="local">
            <Icon name="lock" />
            <span><b>Local only.</b> Samples stay on this laptop and are never committed. Each draft sends the rules below plus a few short excerpts (about 150 words) through the pinned non-China hosts, never a whole sample.</span>
          </span>
        </span>
      </div>
      {failure && (
        <div className="banner error" role="alert" tabIndex={-1} ref={failureRef}>
          <span className="text"><b>That didn't work.</b> {failure}</span>
        </div>
      )}
      <div className="cols voice">
        <div className="col">
          <section className="panel" aria-labelledby="rules-h">
            <div className="sec-head">
              <h2 className="grow" id="rules-h" tabIndex={-1} ref={rulesHeading}>What it learned</h2>
              <span className="meta" aria-live="polite">
                {voice.updating && <><span className="spin sm" aria-hidden="true" /> {updatingLabel(voice)}</>}
              </span>
            </div>
            {voice.rules.length === 0 ? (
              <p className="mini muted">
                {readable === 0
                  ? "No rules yet. Add a few cover letters or other writing of yours; the rules it learns show here, each with what shows it."
                  : voice.updating ? "Reading your samples. The rules show here as they're learned." : "No rules yet. They show here once the voice has learned from your samples."}
              </p>
            ) : (
              <>
                <p className="mini muted">From {from}. Remove a rule that's wrong; it won't come back unless your writing shows it again.</p>
                <ul className="rules">
                  {voice.rules.map((r, i) => (
                    <li key={r.id}>
                      <span>
                        <b>{r.text}</b>
                        <span className="meta block">{r.evidence}{r.language && ` · ${r.language === "bg" ? "Bulgarian" : "English"} only`}</span>
                      </span>
                      <button className="btn ghost sm" type="button" id={`rule-remove-${r.id}`} aria-disabled={busy || undefined} onClick={() => void removeRule(r, i)}>
                        Remove<span className="sr-only"> rule: {r.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
        <aside className="col">
          <section className="panel" aria-labelledby="samples-h">
            <div className="sec-head">
              <h2 className="grow" id="samples-h" tabIndex={-1} ref={samplesHeading}>Samples</h2>
              <label className="btn sm" htmlFor="voice-add">Add samples</label>
              <input className="sr-only" id="voice-add" type="file" multiple accept=".pdf,.docx,.txt,.md" aria-describedby="voice-add-help" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
            </div>
            <span className="sr-only" id="voice-add-help">Past cover letters and other writing of yours: PDF, DOCX or TXT.</span>
            {voice.samples.length > 0 && (
              <ul className="files">
                {voice.samples.map((s) => <SampleRow key={s.id} sample={s} busy={busy} onRemove={() => void removeSample(s)} onReplace={(f) => replace(s, f)} />)}
              </ul>
            )}
          </section>
          <section className="panel" aria-labelledby="edits-h">
            <h2 id="edits-h">Your edits to drafts</h2>
            <p className="mini muted">
              {voice.edits.total === 0
                ? "None yet. When you change a drafted letter or answer, the edit is added here automatically."
                : `${plural(voice.edits.total, "edit", "edits")} from ${plural(voice.edits.sources, "draft", "drafts")}, added automatically.`}
              {!voice.learnFromEdits && " Paused: new edits aren't recorded."}
            </p>
            <label className="check">
              <input type="checkbox" checked={voice.learnFromEdits} aria-disabled={busy || undefined} onChange={(e) => void toggle(e.target.checked)} /> Learn from my edits
            </label>
          </section>
        </aside>
      </div>
    </>
  );
}

function updatingLabel(v: VoiceView): string {
  if (v.edits.waiting > 0) return `Updating from ${plural(v.edits.waiting, "new edit", "new edits")}…`;
  return "Learning from your samples…";
}

function SampleRow({ sample: s, busy, onRemove, onReplace }: { sample: VoiceSample; busy: boolean; onRemove: () => void; onReplace: (f: File | undefined) => void }) {
  const inputId = `voice-replace-${s.id}`;
  return (
    <li>
      <span>
        <span className="name">{s.fileName}</span>
        {s.problem
          ? <span className="err-line block" id={`${inputId}-why`}>{s.problem.message}</span>
          : <span className="meta block">{kindLabel[s.kind]} · {plural(s.words, "word", "words")}{s.language === "bg" && " · Bulgarian"}</span>}
      </span>
      {s.problem ? (
        <span className="sample-acts">
          <label className="btn sm" htmlFor={inputId}>Replace<span className="sr-only"> {s.fileName}</span></label>
          <input className="sr-only" id={inputId} type="file" accept=".pdf,.docx,.txt,.md" aria-describedby={`${inputId}-why`} onChange={(e) => { onReplace(e.target.files?.[0]); e.target.value = ""; }} />
          <button className="btn ghost sm" type="button" aria-disabled={busy || undefined} onClick={onRemove}>Remove<span className="sr-only"> {s.fileName}</span></button>
        </span>
      ) : (
        <button className="btn ghost sm" type="button" aria-disabled={busy || undefined} onClick={onRemove}>Remove<span className="sr-only"> {s.fileName}</span></button>
      )}
    </li>
  );
}
