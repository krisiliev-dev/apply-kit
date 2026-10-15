import { describe, expect, it } from "vitest";
import type { DraftAnswerInput, LetterContent, PackageView, TailorCvInput, TailoredCv, WriteLetterInput } from "../src/index.ts";
import { fakePdfReader, fakeWriter, recordedLetter, recordedLetterBg, recordedTailoredCv, recordedTailoredCvBg } from "./preparation-harness.ts";
import { kestrelJob, mira, started, vitoshaJob, withIds } from "./package-fixtures.ts";

// Bulgarian packages (ticket #68) through the preparation engine, with the writer's recorded
// Bulgarian outputs: a Bulgarian posting gets the whole package in Bulgarian, switching the language
// rewrites every part and keeps the earlier drafts, and an answer the bank has only in English is a
// translation for Kris to approve. Made-up people, companies and postings only.

/** The text read back from a printed PDF (the template-like stand-in), line by line. */
const readBack = async (pdf: Uint8Array) => (await fakePdfReader().read(pdf)).pages.flatMap((p) => p.lines);

/** The content a letter stand-in was printed from. */
const printedLetter = (pdf: Uint8Array) => JSON.parse(JSON.parse(new TextDecoder().decode(pdf).slice("%PDF-fake\n".length)).pages[0].lines[1]) as LetterContent;

const englishTitles = ["Summary", "Experience", "Skills", "Education", "Languages and courses"];
const englishDates = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b|\bpresent\b/;

const question = (pkg: PackageView, start: string) => pkg.answers!.questions.find((q) => q.question.startsWith(start))!;

describe("a Bulgarian posting", () => {
  it("gets the whole package in Bulgarian: the template's own titles, MM.YYYY dates, \"досега\", the Cyrillic name and tool names in Latin", async () => {
    const t = mira();

    const pkg = await started(t, vitoshaJob());

    expect(pkg).toMatchObject({ language: "bg", postingLanguage: "bg", cv: { language: "bg" } });
    const cv = await readBack((await t.preparation.packageCv(pkg.id))!.pdf);
    expect(cv).toEqual([
      "Мира Петрова",
      "Security Analyst",
      "Sofia, Bulgaria · mira.petrova@example.com · +359 88 000 0175 · www.linkedin.com/in/mira-petrova-example",
      "Профил",
      "Анализатор по сигурност в банка, който пише правила за откриване в SIEM и провежда реакцията при инциденти.",
      "Професионален опит",
      "Security Analyst · Northwind Bank, Sofia 03.2022 – досега",
      "Проведох реакцията при фишинг кампания срещу екипа по искове",
      "Написах 30 правила за откриване, които намалиха фалшивите сигнали с една четвърт",
      "Умения",
      "Wazuh",
      "Образование",
      "BSc Computer Science · Danube Institute of Technology 09.2018 – 06.2022",
    ]);
    expect(cv.filter((l) => englishTitles.includes(l) || englishDates.test(l))).toEqual([]);
    // Every part was asked for in Bulgarian.
    const calls = (t.writer as unknown as { calls: { task: string; input: { language?: string } }[] }).calls;
    expect((calls.find((c) => c.task === "tailor-cv")!.input as TailorCvInput).language).toBe("bg");
    expect((calls.find((c) => c.task === "write-letter")!.input as WriteLetterInput).language).toBe("bg");
    expect(calls.filter((c) => c.task === "draft-answer").map((c) => (c.input as DraftAnswerInput).language)).not.toContain("en");
  });

  it("writes the letter in Bulgarian with the Bulgarian letterhead, and asks the standard questions in Bulgarian", async () => {
    const t = mira();

    const pkg = await started(t, vitoshaJob());

    const letter = printedLetter((await t.preparation.packageLetter(pkg.id))!.pdf);
    expect(letter).toMatchObject({ letterhead: { name: "Мира Петрова" }, greeting: "Здравейте,", closing: "Поздрави," });
    expect(pkg.letter!.checks.filter((c) => c.state !== "ok")).toEqual([]);
    expect(pkg.answers!.questions.map((q) => q.question)).toEqual([
      "Имате ли право да работите в тази държава?", "Какъв е срокът ви на предизвестие?", "Какви са очакванията ви за възнаграждение?", "Откъде научихте за позицията?", "Профил в LinkedIn",
    ]);
  });

  it("passes the parse check reading Bulgarian dates and section titles", async () => {
    const t = mira();
    const pkg = await started(t, vitoshaJob());

    const checks = pkg.cv!.ats!.checks;

    expect(checks.filter((c) => ["sections", "dates", "single-column", "contact"].includes(c.check)).map((c) => [c.check, c.passed])).toEqual([
      ["single-column", true], ["contact", true], ["sections", true], ["dates", true],
    ]);
  });
});

describe("switching the package's language", () => {
  it("states what rewriting costs before Kris switches", async () => {
    const t = mira();

    const pkg = await started(t);

    // The fake writer's estimate: the CV, the letter and three drafted answers at $0.002 each.
    expect(pkg.languageOptions).toEqual([
      { language: "en", current: true, fromPosting: true, costUsd: 0, kept: null },
      { language: "bg", current: false, fromPosting: false, costUsd: 0.01, kept: null },
    ]);
  });

  it("rewrites the CV, the letter and the answers together in the new language", async () => {
    const t = mira();
    const pkg = await started(t);

    const switched = await t.preparation.setPackageLanguage(pkg.id, "bg");

    expect(switched).toMatchObject({ changed: true, package: { language: "bg", chip: { label: "Preparing package" } } });
    const bg = (await t.preparation.packageSettled(pkg.id))!;
    const cv = await readBack((await t.preparation.packageCv(pkg.id))!.pdf);
    expect(cv).toContain("Проведох реакцията при фишинг кампания срещу екипа по искове");
    expect(cv.filter((l) => englishTitles.includes(l) || englishDates.test(l))).toEqual([]);
    expect(bg.letter).toMatchObject({ language: "bg", greeting: "Здравейте,", draft: 2, drafts: 2 });
    expect(question(bg, "Describe a security incident")).toMatchObject({ origin: "new", text: expect.stringMatching(/^В Northwind Bank проведох реакцията/) });
    const calls = (t.writer as unknown as { calls: { task: string; input: { language?: string } }[] }).calls;
    expect(calls.filter((c) => c.task === "tailor-cv" || c.task === "write-letter").map((c) => [c.task, c.input.language])).toEqual([
      ["tailor-cv", "en"], ["write-letter", "en"], ["tailor-cv", "bg"], ["write-letter", "bg"],
    ]);
  });

  it("keeps the earlier drafts and decisions: switching back brings them back without the model", async () => {
    const t = mira();
    const pkg = await started(t);
    const edited = `${pkg.letter!.text.replace("Kind regards,", "Best,")}`;
    await t.preparation.editLetter(pkg.id, 1, edited);
    t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3400");
    await t.preparation.setPackageLanguage(pkg.id, "bg");
    const bg = (await t.preparation.packageSettled(pkg.id))!;
    expect(bg.languageOptions.find((o) => o.language === "en")).toMatchObject({ costUsd: 0, kept: { letterDrafts: 1 } });
    const calls = (t.writer as unknown as { calls: unknown[] }).calls.length;

    const back = await t.preparation.setPackageLanguage(pkg.id, "en");

    expect((t.writer as unknown as { calls: unknown[] }).calls).toHaveLength(calls);
    expect(back.package).toMatchObject({ language: "en", generating: false, letter: { language: "en", draft: 1, drafts: 2, closing: "Best," } });
    expect(question(back.package, "What are your salary")).toMatchObject({ text: "3400", yours: true });
    expect(await readBack((await t.preparation.packageCv(pkg.id))!.pdf)).toContain("Experience");
    // The Bulgarian draft is still a page away.
    expect((await t.preparation.showLetterDraft(pkg.id, 2)).package.letter).toMatchObject({ language: "bg", greeting: "Здравейте," });
  });

  it("never approves a letter draft in the other language", async () => {
    const t = mira();
    const pkg = await started(t);
    await t.preparation.setPackageLanguage(pkg.id, "bg");
    await t.preparation.packageSettled(pkg.id);
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");

    await t.preparation.showLetterDraft(pkg.id, 1);

    expect(t.preparation.approveStep(pkg.id, "letter")).toMatchObject({
      approved: false, reason: "Draft 1 is in English and the package is in Bulgarian. Show a Bulgarian draft, or ask for a new one.",
    });
  });

  it("can't switch while parts are being written", async () => {
    const t = mira();
    const r = t.preparation.startPackage(kestrelJob());
    if (!r.started) throw new Error(r.reason);

    expect(await t.preparation.setPackageLanguage(r.package.id, "bg")).toMatchObject({
      changed: false, reason: "The package is still being written. Switch the language once it's done, or stop generating first.",
    });
  });
});

describe("decisions on flags when the language switches", () => {
  /** Mira, whose tailoring words the phishing bullet more strongly in either language, for a job that also asks for Kubernetes. */
  async function withFlags() {
    const ids: Record<string, string> = {};
    const stronger = (cv: TailoredCv, draft: string, honest: string): TailoredCv => {
      const out = withIds(cv, ids);
      out.roles[0]!.bullets[0] = { ...out.roles[0]!.bullets[0]!, text: draft, claim: "stronger", honest };
      return out;
    };
    const writer = fakeWriter({
      tailorCv: (input) => (input.language === "bg"
        ? stronger(recordedTailoredCvBg, "Ръководих реакцията при фишинг кампания срещу екипа по искове", "Проведох и описах реакцията при фишинг кампания срещу екипа по искове")
        : stronger(recordedTailoredCv, "Led the response to a phishing campaign against the claims team", "Ran and wrote up the response to a phishing campaign against the claims team")),
      writeLetter: (input) => withIds(input.language === "bg" ? recordedLetterBg : recordedLetter, ids),
    });
    const t = mira({ writer });
    Object.assign(ids, t.ids);
    const job = kestrelJob({ requirements: [...kestrelJob().requirements, { text: "Kubernetes", category: "skill" }] });
    const pkg = await started(t, job);
    const flag = (p: PackageView, kind: string) => p.cvVersion!.flags.find((f) => f.kind === kind)!;
    return { t, pkg, flag };
  }

  it("carry over when the piece is the same: the option Kris chose, in the new language's words", async () => {
    const { t, pkg, flag } = await withFlags();
    await t.preparation.decideFlag(pkg.id, flag(pkg, "near-the-line").id, { option: "honest" });
    await t.preparation.decideFlag(pkg.id, flag(pkg, "gap").id, { option: "letter" });

    await t.preparation.setPackageLanguage(pkg.id, "bg");
    const bg = (await t.preparation.packageSettled(pkg.id))!;

    expect(bg.cvVersion!.flags.map((f) => [f.kind, f.decision?.option ?? null])).toEqual([["near-the-line", "honest"], ["gap", "letter"]]);
    expect(await readBack((await t.preparation.packageCv(pkg.id))!.pdf)).toContain("Проведох и описах реакцията при фишинг кампания срещу екипа по искове");
    expect(bg.cvVersion!.notes).toContain("Kept 2 decisions from your English draft.");
  });

  it("leave Kris's own wording to be decided again, saying why", async () => {
    const { t, pkg, flag } = await withFlags();
    await t.preparation.decideFlag(pkg.id, flag(pkg, "near-the-line").id, { own: "Ran the response to a phishing campaign, start to finish" });

    await t.preparation.setPackageLanguage(pkg.id, "bg");
    const bg = (await t.preparation.packageSettled(pkg.id))!;

    expect(flag(bg, "near-the-line").decision).toBeNull();
    expect(bg.cvVersion!.notes).toContain("Decide again: your own wording for \"Ran the response to a phishing campaign against the…\" was in English.");
  });
});

describe("an answer the bank has only in English, in a Bulgarian package", () => {
  async function translatedPackage() {
    const t = mira();
    const saved = t.preparation.saveAnswer({ question: "Describe a security incident you handled", category: "screening", versions: { en: "I ran the response to a phishing campaign against the claims team." } });
    if (!saved.saved) throw new Error(saved.problems[0]!.message);
    const pkg = await started(t, kestrelJob({ packageLanguage: "bg" }));
    return { t, pkg, bankId: saved.answer.id, q: question(pkg, "Describe a security incident") };
  }

  it("is a translated draft marked for review, never filled silently", async () => {
    const { q } = await translatedPackage();

    expect(q).toMatchObject({
      origin: "translated", label: "Answer bank · translated", needsYou: true,
      text: expect.stringMatching(/^В Northwind Bank проведох реакцията/), note: "Translated from your English answer: check it, then confirm.",
    });
  });

  it("needs Kris's approval before it's in the approved package", async () => {
    const { t, pkg, q } = await translatedPackage();
    for (const step of ["target", "cv", "letter"] as const) expect(t.preparation.approveStep(pkg.id, step)).toMatchObject({ approved: true });
    t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3400");
    // The form's own options are in English: Kris chooses one.
    t.preparation.setScreeningAnswer(pkg.id, question(pkg, "Do you have the right").id, "Yes");

    expect(t.preparation.approveStep(pkg.id, "answers")).toMatchObject({ approved: false, reason: "1 answer needs you: describe a security incident you handled" });

    t.preparation.setScreeningAnswer(pkg.id, q.id, q.text);
    expect(t.preparation.approveStep(pkg.id, "answers")).toMatchObject({ approved: true });
    const approved = await t.preparation.approvePackage(pkg.id);
    expect(approved.approved && approved.package.approved!.answers).toContainEqual({ question: q.question, answer: q.text });
  });

  it("can be saved back to the bank as the answer's Bulgarian version", async () => {
    const { t, pkg, bankId, q } = await translatedPackage();
    expect(q.save).toMatchObject({ offered: true });

    const r = t.preparation.saveScreeningAnswerToBank(pkg.id, q.id);

    expect(r).toMatchObject({ changed: true });
    expect(t.preparation.answer(bankId)!.versions).toEqual({ en: "I ran the response to a phishing campaign against the claims team.", bg: q.text });
    expect(question(r.package, "Describe a security incident").save).toMatchObject({ offered: false, savedTo: bankId });
  });
});
