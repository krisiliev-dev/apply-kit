import { describe, expect, it } from "vitest";
import type { LearnedVoice, SentExcerpt, VoiceLearningInput } from "../src/index.ts";
import { createTestPreparation, fakePdf, fakeWriter, scannedPdf, type FakeWriter, type TestPreparationOptions } from "./preparation-harness.ts";
import { docx } from "./zip.ts";

// Voice (ticket #59): samples of Kris's own writing, the voice rules learned from them and from
// edits to drafts, and the voice context each draft sends. Through the preparation engine with the
// fake writer's recorded outputs; no live AI. Every sample is invented, by made-up people.

const text = (s: string) => new TextEncoder().encode(s);

/** A made-up cover letter by a made-up person (Mira Petrova), 3 short paragraphs. */
const orbitalLetter = [
  "Dear Orbital Freight team,",
  "Your night shift loses an hour every time a parcel scan fails. I fixed the same problem at Northwind Bank, where alerts failed quietly for weeks.",
  "I wrote the runbook the analysts still use. It is short. Every step names who acts and what they check.",
  "Kind regards,\nMira Petrova",
].join("\n\n");

const aboutPage = "I build small tools that make noisy systems quieter. Most of my work is reading logs nobody reads and deciding what matters.";

/** A long made-up sample (Alex Doe's blog post): 30 numbered sentences of 9 words, 270 words in all. */
const longPost = Array.from({ length: 30 }, (_, i) => `Note ${i + 1}: the night shift reads the queue first.`).join(" ");

const words = (excerpts: SentExcerpt[]) => excerpts.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);
const learnCalls = (writer: FakeWriter) => writer.calls.filter((c) => c.task === "learn-voice").map((c) => c.input as VoiceLearningInput);

async function withSamples(options: TestPreparationOptions = {}) {
  const t = createTestPreparation(options);
  const added = await t.preparation.addVoiceSamples([
    { fileName: "cover-letter-orbital-2023.docx", bytes: docx(orbitalLetter.split("\n\n")) },
    { fileName: "about-page.txt", bytes: text(aboutPage) },
  ]);
  return { ...t, added };
}

describe("voice samples", () => {
  it("lists each sample with its kind and length, and an unreadable one with the reason and how to fix it while the others still count", async () => {
    const t = createTestPreparation();

    await t.preparation.addVoiceSamples([
      { fileName: "cover-letter-orbital-2023.docx", bytes: docx(orbitalLetter.split("\n\n")) },
      { fileName: "about-page.txt", bytes: text(aboutPage) },
      { fileName: "cover-letter-2022.pages", bytes: text("PK\u0003\u0004 not really a pages file") },
      { fileName: "scan.pdf", bytes: scannedPdf },
      { fileName: "letter-varna.pdf", bytes: fakePdf([["Dear Varna Telecom team,", "Your outage reports arrive a day late."]]) },
    ]);

    expect(t.preparation.voice().samples.map((s) => [s.fileName, s.kind, s.words, s.language, s.problem?.message ?? null])).toEqual([
      ["cover-letter-orbital-2023.docx", "cover-letter", 54, "en", null],
      ["about-page.txt", "writing", 22, "en", null],
      ["cover-letter-2022.pages", "cover-letter", 0, null, "Couldn't read a .pages file. Export it as PDF or DOCX from Pages; the other samples still count."],
      ["scan.pdf", "writing", 0, null, "This PDF is a scan, with no text to read. Export it again with its text, or as DOCX or TXT; the other samples still count."],
      ["letter-varna.pdf", "cover-letter", 11, "en", null],
    ]);
  });
});

describe("learning the voice", () => {
  it("sends no call more than the excerpt limit of Kris's writing, reads every sample in turn, and records each call's excerpts", async () => {
    const writer = fakeWriter();
    const t = await withSamples({ writer });
    await t.preparation.addVoiceSamples([{ fileName: "blog-post.txt", bytes: text(longPost) }]);

    await t.preparation.learnVoice();

    const calls = learnCalls(writer);
    expect(calls.length).toBeGreaterThan(2);
    for (const call of calls) expect(words(call.excerpts)).toBeLessThanOrEqual(150);
    // Every sentence of every sample was read once, across the calls.
    const sent = calls.flatMap((c) => c.excerpts).map((e) => e.text).join(" ");
    for (let i = 1; i <= 30; i++) expect(sent).toContain(`Note ${i}: the night shift reads the queue first.`);
    expect(sent).toContain("Your night shift loses an hour every time a parcel scan fails.");
    expect(sent).toContain("Most of my work is reading logs nobody reads and deciding what matters.");
    // What each call sent is on record, as sent.
    expect(t.preparation.voiceSends().filter((s) => s.purpose === "learn-voice").map((s) => s.excerpts).reverse()).toEqual(calls.map((c) => c.excerpts));

    // Read once: learning again sends nothing.
    await t.preparation.learnVoice();
    expect(learnCalls(writer)).toHaveLength(calls.length);
  });

  it("shows the rules learned with their evidence, and what they were learned from", async () => {
    const learned = (input: VoiceLearningInput): LearnedVoice => ({
      rules: [
        { id: null, text: "Opens with the company's problem, not with you", evidence: "cover-letter-orbital-2023", language: null, sources: [input.excerpts[0]!.source] },
        { id: null, text: "Signs off \"Kind regards\"", evidence: "1 of 2 samples", language: "en", sources: [input.excerpts[0]!.source] },
      ],
    });
    const t = await withSamples({ writer: fakeWriter({ learnVoice: learned }) });

    await t.preparation.learnVoice();

    const voice = t.preparation.voice();
    expect(voice.rules.map((r) => [r.text, r.evidence, r.language, r.samples])).toEqual([
      ["Opens with the company's problem, not with you", "cover-letter-orbital-2023", null, 1],
      ["Signs off \"Kind regards\"", "1 of 2 samples", "en", 1],
    ]);
    expect(voice.learnedFrom).toEqual({ samples: 2, edits: 0 });
  });
});

/** The writer learns these rules from the first excerpt of any call. */
const learnsRules = (...rules: string[]) => (input: VoiceLearningInput): LearnedVoice => ({
  rules: rules.map((r) => ({ id: null, text: r, evidence: "samples", language: null, sources: [input.excerpts[0]!.source] })),
});

describe("the voice context a draft sends", () => {
  it("carries the rules and at most 150 words of excerpts in the draft's language, and records what it sent", async () => {
    const t = await withSamples({ writer: fakeWriter({ learnVoice: learnsRules("Opens with the company's problem, not with you", "Short declarative sentences") }) });
    await t.preparation.addVoiceSamples([
      { fileName: "blog-post.txt", bytes: text(longPost) },
      { fileName: "мотивационно-писмо.txt", bytes: text("Здравейте, екипът ви губи час всяка нощ заради неуспешни сканирания. Аз поправих същия проблем.") },
    ]);
    await t.preparation.learnVoice();

    const context = t.preparation.voiceContext({ language: "en", purpose: "cover-letter" });

    expect(context.rules.map((r) => r.text)).toEqual(["Opens with the company's problem, not with you", "Short declarative sentences"]);
    expect(words(context.excerpts)).toBeLessThanOrEqual(150);
    expect(context.excerpts.length).toBeGreaterThan(1);
    // English samples only; each excerpt is Kris's own words, whole sentences from a sample.
    const english = t.preparation.voice().samples.filter((s) => s.language === "en").map((s) => `sample:${s.id}`);
    for (const e of context.excerpts) expect(english).toContain(e.source);
    expect(context.excerpts[0]!.text.startsWith("Dear Orbital Freight team,")).toBe(true);
    // On record as sent, under the context's id.
    expect(t.preparation.voiceSends()[0]).toMatchObject({ id: context.id, purpose: "cover-letter", language: "en", excerpts: context.excerpts, words: words(context.excerpts) });
  });

  it("leaves out a removed rule from the next context", async () => {
    const t = await withSamples({ writer: fakeWriter({ learnVoice: learnsRules("Opens with the company's problem, not with you", "Signs off \"Kind regards\"") }) });
    await t.preparation.learnVoice();
    const signOff = t.preparation.voice().rules.find((r) => r.text.startsWith("Signs off"))!;

    expect(t.preparation.removeVoiceRule(signOff.id)).toBe(true);

    expect(t.preparation.voiceContext({ language: "en", purpose: "cover-letter" }).rules.map((r) => r.text)).toEqual(["Opens with the company's problem, not with you"]);
    expect(t.preparation.voice().rules.map((r) => r.text)).toEqual(["Opens with the company's problem, not with you"]);
  });
});

/** A made-up edit: Kris rewrote the draft's opener and cut a stock phrase, in a package's letter. */
const letterEdit = {
  purpose: "cover-letter",
  language: "en" as const,
  source: "package:kestrel",
  before: "I am excited to apply for the Security Analyst role. I am passionate about security. I tuned detections at Northwind Bank.",
  after: "Your analysts lose an hour a night to noisy alerts. I tuned detections at Northwind Bank.",
};

describe("learning from Kris's edits to drafts", () => {
  it("records an edit to any draft as evidence and learns from only what changed", async () => {
    const writer = fakeWriter();
    const t = createTestPreparation({ writer });

    expect(t.preparation.recordVoiceEdit(letterEdit)).toBe(true);
    expect(t.preparation.recordVoiceEdit({ purpose: "follow-up", language: "en", source: "application:halden", before: "Just checking in!", after: "Is the role still open?" })).toBe(true);
    expect(t.preparation.voice().edits).toEqual({ total: 2, sources: 2, waiting: 2 });

    await t.preparation.learnVoice();

    expect(learnCalls(writer).flatMap((c) => c.excerpts.map((e) => e.text))).toEqual([
      "Draft: I am excited to apply for the Security Analyst role. I am passionate about security.\nKris: Your analysts lose an hour a night to noisy alerts.",
      "Draft: Just checking in!\nKris: Is the role still open?",
    ]);
    expect(t.preparation.voice()).toMatchObject({ edits: { total: 2, sources: 2, waiting: 0 }, learnedFrom: { edits: 2 } });
  });

  it("records nothing when an edit changes nothing", () => {
    const t = createTestPreparation();

    expect(t.preparation.recordVoiceEdit({ ...letterEdit, after: letterEdit.before })).toBe(false);
    expect(t.preparation.voice().edits.total).toBe(0);
  });

  it("stops recording edits as evidence while learning is paused, and starts again on resume", async () => {
    const writer = fakeWriter();
    const t = createTestPreparation({ writer });

    expect(t.preparation.setVoiceLearning(false).learnFromEdits).toBe(false);
    expect(t.preparation.recordVoiceEdit(letterEdit)).toBe(false);
    await t.preparation.learnVoice();

    expect(t.preparation.voice().edits).toEqual({ total: 0, sources: 0, waiting: 0 });
    expect(learnCalls(writer)).toEqual([]);

    expect(t.preparation.setVoiceLearning(true).learnFromEdits).toBe(true);
    expect(t.preparation.recordVoiceEdit(letterEdit)).toBe(true);
    expect(t.preparation.voice().edits.total).toBe(1);
  });
});

describe("a removed rule", () => {
  it("doesn't come back from writing it was removed over, only when newer writing shows it again", async () => {
    const t = await withSamples({ writer: fakeWriter({ learnVoice: learnsRules("Signs off \"Kind regards\"") }) });
    await t.preparation.learnVoice();
    const rule = t.preparation.voice().rules[0]!;
    // An edit made before the rule was removed, learned from after.
    t.preparation.recordVoiceEdit(letterEdit);
    await t.clock.advance(60_000);
    t.preparation.removeVoiceRule(rule.id);
    await t.clock.advance(60_000);

    await t.preparation.learnVoice();
    expect(t.preparation.voice().rules).toEqual([]);

    await t.preparation.addVoiceSamples([{ fileName: "cover-letter-halden.txt", bytes: text("Dear Halden team,\n\nYour release notes go unread.\n\nKind regards,\nMira Petrova") }]);
    await t.preparation.learnVoice();
    expect(t.preparation.voice().rules.map((r) => r.text)).toEqual(["Signs off \"Kind regards\""]);
  });
});
