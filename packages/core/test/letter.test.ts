import { describe, expect, it } from "vitest";
import type { DocumentRenderer, LetterContent, PackageJob, PieceInput, TailoredCv, WriteLetterInput, WriterRequest, WrittenLetter } from "../src/index.ts";
import { createTestPreparation, fakeRenderer, fakeWriter, recordedLetter, recordedTailoredCv } from "./preparation-harness.ts";

// The cover letter (ticket #65): step 3 of a package, written in Kris's voice from the CV as decided,
// checked against the profile, the CV's decisions, the gaps to name and the stock phrases; drafts
// kept and paged; edits recorded as voice evidence; printed with the CV's letterhead. Through the
// preparation engine with the fake writer and recorded outputs. Made-up people and companies only.

/** A recorded output with its placeholder ids ("piece-analyst") swapped for the profile's. */
function withIds<T>(recorded: T, ids: Record<string, string>, edit: (out: T) => void = () => {}): T {
  const out = JSON.parse(JSON.stringify(recorded).replace(/"piece-([a-z]+)"/g, (m, key: string) => (ids[key] ? JSON.stringify(ids[key]) : m))) as T;
  edit(out);
  return out;
}

/** Mira Petrova's made-up profile, a voice sample of hers, and a writer answering with the recorded CV and letter. */
async function mira(options: {
  tailor?: (cv: TailoredCv) => void;
  letter?: (letter: WrittenLetter, input: WriteLetterInput) => WrittenLetter | Error | void;
  pieces?: (save: (key: string, input: PieceInput) => void, ids: Record<string, string>) => void;
  capUsd?: number;
  renderer?: DocumentRenderer;
} = {}) {
  const ids: Record<string, string> = {};
  const writer = fakeWriter({
    tailorCv: () => withIds(recordedTailoredCv, ids, options.tailor),
    writeLetter: (input) => {
      const letter = withIds(recordedLetter, ids);
      const out = options.letter?.(letter, input);
      return out ?? letter;
    },
    learnVoice: (input) => ({ rules: [{ id: null, text: "Opens with the company's problem, not with you", evidence: "1 sample", language: null, sources: [input.excerpts[0]!.source] }] }),
  });
  const t = createTestPreparation({ writer, capUsd: options.capUsd, ...(options.renderer && { renderer: options.renderer }) });
  const save = (key: string, input: PieceInput) => {
    const r = t.preparation.savePiece(input);
    if (!r.saved) throw new Error(`${key}: ${r.problems[0]!.message}`);
    ids[key] = r.piece.id;
  };
  save("analyst", { kind: "role", text: "", entry: { title: "Security Analyst", organisation: "Northwind Bank", city: "Sofia", start: "2022-03", end: null }, tags: ["SOC"], angles: ["security"] });
  save("detections", { kind: "achievement", text: "Wrote 30 detection rules that cut false alerts by a quarter.", belongsTo: ids.analyst, tags: ["SIEM"], angles: ["security"], numberSource: "measured" });
  save("phishing", { kind: "achievement", text: "Ran the response to a phishing campaign against the claims team.", belongsTo: ids.analyst, tags: ["incident response"], angles: ["security"] });
  save("wazuh", { kind: "skill", text: "Wazuh", tags: ["SIEM"], angles: ["security"] });
  options.pieces?.(save, ids);
  t.preparation.saveAngle({ angle: "security", summary: "Security analyst at a bank, writing detection rules." });
  t.preparation.saveContact({ nameLatin: "Mira Petrova", nameCyrillic: "Мира Петрова", email: "mira.petrova@example.com", phone: "+359 88 000 0175", city: "Sofia", country: "Bulgaria", links: ["linkedin.com/in/mira-petrova-example"] });
  await t.preparation.addVoiceSamples([{
    fileName: "cover-letter-harbour-2024.txt",
    bytes: new TextEncoder().encode("Dear Harbour team,\n\nYour night shift loses an hour to noisy alerts. I have spent two years making those alerts quieter.\n\nKind regards,\nMira"),
  }]);
  await t.preparation.learnVoice();
  return { ...t, ids, calls: (writer as unknown as { calls: WriterRequest[] }).calls };
}

/** A made-up Kestrel Payments job: the company's Greenhouse page. */
function kestrelJob(overrides: Partial<PackageJob> = {}): PackageJob {
  return {
    id: "job-kestrel",
    title: "Security Engineer",
    titleTranslation: null,
    company: "Kestrel Payments",
    location: "Sofia",
    packageLanguage: "en",
    closed: null,
    reading: { state: "read" },
    requirements: [{ text: "Experience triaging alerts in a SIEM" }, { text: "Incident response" }],
    postings: [
      { id: "posting-gh", site: "job-boards.greenhouse.io", url: "https://job-boards.greenhouse.io/kestrel/jobs/4410", source: { name: "Kestrel Payments", kind: "greenhouse", label: "Greenhouse", category: "ats" } },
    ],
    target: { postingId: "posting-gh" },
    ...overrides,
  };
}

async function started(t: Awaited<ReturnType<typeof mira>>, job = kestrelJob()) {
  const r = t.preparation.startPackage(job);
  if (!r.started) throw new Error(r.reason);
  return (await t.preparation.packageSettled(r.package.id))!;
}

const letterInputs = (t: Awaited<ReturnType<typeof mira>>) => t.calls.filter((c) => c.task === "write-letter").map((c) => c.input as WriteLetterInput);

describe("writing the cover letter", () => {
  it("is written in the background after the CV, in Kris's voice, from the CV's wording", async () => {
    const t = await mira();

    const pkg = await started(t);

    expect(pkg.parts.find((p) => p.part === "letter")).toMatchObject({ state: "done", what: "Draft 1 · 113 words" });
    const [input] = letterInputs(t);
    expect(input).toMatchObject({
      posting: { title: "Security Engineer", company: "Kestrel Payments", requirements: ["Experience triaging alerts in a SIEM", "Incident response"] },
      language: "en", words: 220, voice: ["Opens with the company's problem, not with you"], gaps: [], instruction: null, previous: null,
      cv: { summary: "Security analyst who writes SIEM detection rules and runs incident response at a bank." },
    });
    expect(input!.cv.lines.map((l) => l.text)).toEqual([
      "Ran the incident response to a phishing campaign against the claims team",
      "Wrote 30 detection rules that cut false alerts by a quarter",
    ]);
    expect(input!.excerpts).toEqual([{ source: expect.stringMatching(/^sample:/), text: expect.stringContaining("Your night shift loses an hour to noisy alerts.") }]);
  });
});

describe("the letter as the step shows it", () => {
  it("shows draft 1 with its word count, the sentences written for the company named in words, and the excerpts it sent", async () => {
    const t = await mira();

    const { letter } = await started(t);

    expect(letter).toMatchObject({
      draft: 1, drafts: 1, origin: "writer", instruction: null, words: 113, target: 220,
      greeting: "Dear Kestrel Payments hiring team,", closing: "Kind regards,",
      forCompany: { count: 2, where: "the first sentence of paragraph 1 and the first sentence of paragraph 3" },
      voice: {
        samples: 1, edits: 0, sentWords: 24,
        sent: [{ from: "cover-letter-harbour-2024.txt", text: "Dear Harbour team, Your night shift loses an hour to noisy alerts. I have spent two years making those alerts quieter. Kind regards, Mira" }],
      },
    });
    expect(letter!.paragraphs[0]).toEqual([
      { text: "Every false alert in a payments SOC costs an analyst's time, and every missed one can cost a merchant.", forCompany: true },
      { text: "Telling those apart is the work I do as a security analyst at Northwind Bank, and it is why the Security Engineer role stood out to me.", forCompany: false },
    ]);
    expect(letter!.text).toBe([
      "Dear Kestrel Payments hiring team,",
      "Every false alert in a payments SOC costs an analyst's time, and every missed one can cost a merchant. Telling those apart is the work I do as a security analyst at Northwind Bank, and it is why the Security Engineer role stood out to me.",
      "At Northwind Bank I wrote 30 detection rules that cut false alerts by a quarter. I also ran the response to a phishing campaign against the claims team.",
      "Your posting asks for alert triage in a SIEM and for incident response, which is the work I want to keep doing. I would like to hear where the team wants its detections to be a year from now.",
      "Kind regards,",
    ].join("\n\n"));
  });
});

describe("the letter's checks", () => {
  it("passes every check when it keeps to the profile and the CV, with one example that has a number", async () => {
    const t = await mira();

    const { letter } = await started(t);

    expect(letter!.checks).toEqual([
      { id: "trace", state: "ok", label: "Every claim traces to your master profile", detail: null },
      { id: "decisions", state: "ok", label: "Wording matches your CV", detail: null },
      { id: "gaps", state: "ok", label: "No gap to name: you chose none in the CV step", detail: null },
      { id: "stock", state: "ok", label: "No stock phrases (\"passionate\", \"excited to apply\")", detail: null },
      { id: "example", state: "ok", label: "One concrete example with a number", detail: null },
    ]);
  });

  it("flags a letter that contradicts a CV decision (\"led all 3\"), and the step can't be approved", async () => {
    const t = await mira({
      pieces: (save, ids) => save("incidents", { kind: "achievement", text: "Responded to 3 phishing incidents and led 1 of them.", belongsTo: ids.analyst, tags: ["incident response"], angles: ["security"], numberSource: "measured" }),
      tailor: (cv) => {
        cv.roles[0]!.bullets.push({ text: "Led the response to all 3 phishing incidents", pieceIds: [t.ids.incidents!], claim: "stronger", why: "The posting asks for incident response.", honest: "Responded to 3 phishing incidents, leading 1 of them" });
      },
      letter: (letter) => {
        letter.paragraphs[1]!.sentences[1] = { text: "I also led the response to all 3 phishing incidents at Northwind Bank.", forCompany: false, pieceIds: [t.ids.incidents!] };
      },
    });
    const pkg = await started(t);
    const flag = pkg.cvVersion!.flags.find((f) => f.kind === "near-the-line")!;
    await t.preparation.decideFlag(pkg.id, flag.id, { option: "honest" });
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");

    const refused = t.preparation.approveStep(pkg.id, "letter");

    expect(refused.package.letter!.checks.find((c) => c.id === "decisions")).toEqual({
      id: "decisions", state: "problem",
      label: "Contradicts your CV decision: \"Responded to 3 phishing incidents, leading 1 of them\"",
      detail: "\"I also led the response to all 3 phishing incidents at Northwind Bank\" says \"all\", which your CV decision doesn't. Use the CV's wording, or ask for a new draft.",
    });
    expect(refused).toMatchObject({
      approved: false, blockedBy: "letter",
      reason: "The cover letter can't be approved yet: it contradicts your CV decision: \"Responded to 3 phishing incidents, leading 1 of them\".",
    });
    expect(refused.package.steps[2]).toMatchObject({ state: "current", sub: "1 to fix" });
  });

  it("holds every claim to the profile: a number or a tool it doesn't have is a problem", async () => {
    const t = await mira({
      letter: (letter) => { letter.paragraphs[1]!.sentences[0]!.text = "At Northwind Bank I wrote 50 detection rules in Splunk."; },
    });
    const pkg = await started(t);
    expect(pkg.letter!.checks[0]).toEqual({
      id: "trace", state: "problem", label: "A claim doesn't trace to your master profile",
      detail: "\"At Northwind Bank I wrote 50 detection rules in Splunk\" names \"Splunk\", which isn't in your profile; it says \"50\", which its piece doesn't back.",
    });
  });

  it("names the gap Kris chose to name, and says so when a draft doesn't", async () => {
    const kubernetes = kestrelJob({ requirements: [{ text: "Incident response", kind: "required", category: "skill" }, { text: "Kubernetes security", kind: "required", category: "skill" }] });
    let named = false;
    const t = await mira({
      letter: (letter) => {
        if (named) letter.paragraphs[2]!.sentences.push({ text: "Kubernetes security I haven't done in production, and I would want to close that gap early.", forCompany: true, pieceIds: [] });
      },
    });
    const pkg = await started(t, kubernetes);
    const gap = pkg.cvVersion!.flags.find((f) => f.kind === "gap")!;

    const decided = await t.preparation.decideFlag(pkg.id, gap.id, { option: "letter" });

    expect(decided.package.letter!.checks.find((c) => c.id === "gaps")).toEqual({
      id: "gaps", state: "problem", label: "Kubernetes security gap not named",
      detail: "You chose to name Kubernetes security in the letter, as something to learn. Ask for a new draft (\"Name the Kubernetes security gap\"), or add a sentence yourself.",
    });
    expect(decided.package.letter!.quick).toContain("Name the Kubernetes security gap");

    named = true;
    const redrafted = await t.preparation.redraftLetter(pkg.id, "Name the Kubernetes security gap");

    expect(letterInputs(t).at(-1)).toMatchObject({ gaps: ["Kubernetes security"], instruction: "Name the Kubernetes security gap" });
    expect(redrafted.package.letter!.checks.find((c) => c.id === "gaps")).toMatchObject({ state: "ok", label: "Kubernetes security gap named, as you chose in the CV step" });
    expect(redrafted.package.letter!.checks[0]).toMatchObject({ state: "ok" });
  });

  it("warns about stock phrases and a letter with no example, without stopping Approve", async () => {
    const t = await mira({
      letter: (letter) => {
        letter.paragraphs[1]!.sentences = [{ text: "I am passionate about security and excited to apply.", forCompany: false, pieceIds: [] }];
      },
    });
    const pkg = await started(t);
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");

    expect(pkg.letter!.checks.slice(3)).toEqual([
      { id: "stock", state: "warning", label: "Stock phrases: \"passionate\", \"excited to apply\"", detail: "In \"I am passionate about security and excited to apply\". Say what you did instead." },
      { id: "example", state: "warning", label: "No concrete example with a number", detail: "Anchor the letter in one example from your profile, with its number." },
    ]);
    expect(t.preparation.approveStep(pkg.id, "letter")).toMatchObject({ approved: true });
  });
});

describe("drafts", () => {
  it("asking for a new draft keeps the previous one, reachable by paging", async () => {
    let n = 0;
    const t = await mira({
      letter: (letter) => {
        n += 1;
        if (n === 2) letter.paragraphs.pop();
      },
    });
    const pkg = await started(t);

    const second = await t.preparation.redraftLetter(pkg.id, "Shorter");

    expect(second.package.letter).toMatchObject({ draft: 2, drafts: 2, instruction: "Shorter", words: 74 });
    expect(letterInputs(t).at(-1)).toMatchObject({ instruction: "Shorter", previous: pkg.letter!.text });
    const first = await t.preparation.showLetterDraft(pkg.id, 1);
    expect(first.package.letter).toMatchObject({ draft: 1, drafts: 2, instruction: null, words: 113, text: pkg.letter!.text });
    expect((await t.preparation.showLetterDraft(pkg.id, 2)).package.letter).toMatchObject({ draft: 2, words: 74 });
    expect(await t.preparation.showLetterDraft(pkg.id, 3)).toMatchObject({ changed: false, reason: "There's no draft 3." });
  });

  it("a new draft that fails keeps the one there is, and says so", async () => {
    let n = 0;
    const t = await mira({ letter: () => { n += 1; return n > 1 ? new Error("The model host didn't answer within 90 s") : undefined; } });
    const pkg = await started(t);

    const r = await t.preparation.redraftLetter(pkg.id, "More direct");

    expect(r).toMatchObject({
      changed: false, reason: "The new draft wasn't written: The model host didn't answer within 90 s. Draft 1 is kept. Try again, or edit this one yourself.",
      package: { letter: { draft: 1, drafts: 1 } },
    });
  });
});

describe("editing the letter", () => {
  const opener = "Every false alert in a payments SOC costs an analyst's time, and every missed one can cost a merchant.";
  const mine = "Your analysts lose an hour a night to noisy alerts.";

  it("saves Kris's text; a sentence she changed is hers (no longer highlighted), and the edit is voice evidence", async () => {
    const t = await mira();
    const pkg = await started(t);

    const r = await t.preparation.editLetter(pkg.id, 1, pkg.letter!.text.replace(opener, mine));

    expect(r.package.letter).toMatchObject({
      draft: 1, words: 104, editedAt: "2026-10-12T07:30:00.000Z",
      forCompany: { count: 1, where: "the first sentence of paragraph 3" },
    });
    expect(r.package.letter!.paragraphs[0]![0]).toEqual({ text: mine, forCompany: false });
    expect(t.preparation.voice().edits).toMatchObject({ total: 1, waiting: 1 });

    // Editing again keeps one piece of evidence for the draft, with the latest text.
    await t.preparation.editLetter(pkg.id, 1, r.package.letter!.text.replace("Kind regards,", "Best,"));
    expect(t.preparation.voice().edits).toMatchObject({ total: 1, waiting: 1 });
    await t.preparation.learnVoice();
    const sent = t.calls.filter((c) => c.task === "learn-voice").at(-1)!.input as { excerpts: { text: string }[] };
    expect(sent.excerpts.map((e) => e.text)).toEqual([`Draft: ${opener} Kind regards,\nKris: ${mine} Best,`]);
  });

  it("isn't recorded as evidence while learning from edits is paused; the text is still saved", async () => {
    const t = await mira();
    const pkg = await started(t);
    t.preparation.setVoiceLearning(false);

    const r = await t.preparation.editLetter(pkg.id, 1, pkg.letter!.text.replace(opener, mine));

    expect(r.package.letter!.paragraphs[0]![0]!.text).toBe(mine);
    expect(t.preparation.voice().edits).toMatchObject({ total: 0 });
  });

  it("reopens an approved letter step, and holds Kris's own sentences to the whole profile", async () => {
    const t = await mira();
    const pkg = await started(t);
    for (const step of ["target", "cv", "letter"] as const) t.preparation.approveStep(pkg.id, step);

    const r = await t.preparation.editLetter(pkg.id, 1, pkg.letter!.text.replace(opener, "I cut false alerts by 90% with Splunk."));

    expect(r.package.steps[2]).toMatchObject({ approvedAt: null, state: "current", sub: "1 to fix" });
    expect(r.package.letter!.checks[0]).toMatchObject({
      state: "problem", detail: "\"I cut false alerts by 90% with Splunk\" names \"Splunk\", which isn't in your profile; it says \"90%\", which its piece doesn't back.",
    });
  });
});

/** What the fake renderer printed into a PDF: the document's content. */
const printed = <T>(pdf: Uint8Array): T => {
  const text = JSON.parse(new TextDecoder().decode(pdf).slice("%PDF-fake\n".length)) as { pages: { lines: string[] }[] };
  return JSON.parse(text.pages[0]!.lines[1]!) as T;
};

describe("the letter's PDF", () => {
  it("shares the CV's letterhead, with the date, recipient and Re: line filled from the job, on one page", async () => {
    const t = await mira();
    const pkg = await started(t);

    const file = await t.preparation.packageLetter(pkg.id);

    expect(pkg.letter!.file).toMatchObject({ fileName: "Mira_Petrova_Cover_Letter_Kestrel_Payments_Security_Engineer.pdf", pages: 1, overflow: null, draft: 1 });
    expect(file!.fileName).toBe("Mira_Petrova_Cover_Letter_Kestrel_Payments_Security_Engineer.pdf");
    const letter = printed<LetterContent>(file!.pdf);
    const cv = printed<{ letterhead: unknown }>((await t.preparation.packageCv(pkg.id))!.pdf);
    expect(letter.letterhead).toEqual(cv.letterhead);
    expect(letter).toMatchObject({
      date: "2026-10-12", recipient: { company: "Kestrel Payments", place: "Sofia" }, re: { role: "Security Engineer" },
      greeting: "Dear Kestrel Payments hiring team,", closing: "Kind regards,",
      paragraphs: [expect.stringMatching(/^Every false alert/), expect.stringMatching(/^At Northwind Bank/), expect.stringMatching(/^Your posting asks/)],
    });
  });

  it("a letter that runs onto a second page can't be approved until it's shorter", async () => {
    const renderer = fakeRenderer((doc) => ({ pages: doc.kind === "cover-letter" ? [{ lines: ["Dear"] }, { lines: ["Kind regards,"] }] : [{ lines: [doc.title] }] }));
    const t = await mira({ renderer });
    const pkg = await started(t);
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");

    expect(t.preparation.approveStep(pkg.id, "letter")).toMatchObject({ approved: false, reason: "The letter runs onto 2 pages. Shorten it to fit one." });
  });
});

describe("when the letter can't be written", () => {
  it("a timed-out letter says so; the CV stays, and the letter can be retried or written by hand", async () => {
    let fail = true;
    const t = await mira({ letter: () => (fail ? new Error("The model host didn't answer within 90 s") : undefined) });

    const pkg = await started(t);

    expect(pkg.parts.find((p) => p.part === "letter")).toMatchObject({
      state: "failed", attempts: 2, what: "Not written: The model host didn't answer within 90 s. The rest is saved.",
    });
    expect(pkg).toMatchObject({ cv: { pages: 1 }, letter: null, steps: [{}, {}, { state: "failed", sub: "Failed" }, {}, {}] });

    fail = false;
    t.preparation.retryPart(pkg.id, "letter");
    expect((await t.preparation.packageSettled(pkg.id))!.letter).toMatchObject({ draft: 1, origin: "writer" });
  });

  it("Write it myself opens an empty draft with the greeting and closing, which can't be approved empty", async () => {
    const t = await mira({ letter: () => new Error("The model host didn't answer within 90 s") });
    const pkg = await started(t);
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");

    const r = await t.preparation.writeLetterYourself(pkg.id);

    expect(r.package.letter).toMatchObject({ draft: 1, drafts: 1, origin: "own", words: 0, text: "Dear Kestrel Payments hiring team,\n\nKind regards,", voice: { sent: [] } });
    expect(r.package.parts.find((p) => p.part === "letter")).toMatchObject({ state: "done" });
    expect(t.preparation.approveStep(pkg.id, "letter")).toMatchObject({ approved: false, reason: "The letter is empty. Write it, or ask for a draft." });

    const written = await t.preparation.editLetter(pkg.id, 1, "Dear Kestrel Payments hiring team,\n\nAt Northwind Bank I wrote 30 detection rules that cut false alerts by a quarter.\n\nKind regards,");
    expect(written.package.letter!.checks.map((c) => c.state)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(t.preparation.voice().edits.total).toBe(0);
    expect(t.preparation.approveStep(pkg.id, "letter")).toMatchObject({ approved: true });
  });

  it("isn't started when it would cross the monthly cap; the rest is kept and Kris can write it herself", async () => {
    // Learning the voice and the CV each cost $0.002; the letter would cross a $0.005 cap.
    const t = await mira({ capUsd: 0.005 });

    const pkg = await started(t);

    expect(pkg.parts.map((p) => [p.part, p.state])).toEqual([["target", "done"], ["cv", "done"], ["letter", "not-written"], ["answers", "done"], ["ats", "waiting"]]);
    expect(pkg.parts[2]!.what).toBe("Not written: this month's AI budget would be crossed.");
    expect(await t.preparation.redraftLetter(pkg.id, "Shorter")).toMatchObject({
      changed: false, reason: "This month's AI budget would be crossed, so a new draft can't be written now. Edit it, or write it yourself.",
    });
    expect((await t.preparation.writeLetterYourself(pkg.id)).package.letter).toMatchObject({ origin: "own" });
  });
});

describe("switching the package's language", () => {
  it("writes a new draft with the Bulgarian letterhead (#68)", async () => {
    const t = await mira();
    const pkg = await started(t);

    await t.preparation.setPackageLanguage(pkg.id, "bg");
    await t.preparation.packageSettled(pkg.id);

    expect(printed<LetterContent>((await t.preparation.packageLetter(pkg.id))!.pdf).letterhead.name).toBe("Мира Петрова");
  });
});
