import { describe, expect, it } from "vitest";
import type { PackageJob, PieceInput, TailoredCv, WriteLetterInput, WriterRequest, WrittenLetter } from "../src/index.ts";
import { createTestPreparation, fakeWriter, recordedLetter, recordedTailoredCv } from "./preparation-harness.ts";

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
  const t = createTestPreparation({ writer, capUsd: options.capUsd });
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
});
