import { describe, expect, it } from "vitest";
import type { DraftAnswerInput, LetterContent, PackageView, TailorCvInput, WriteLetterInput } from "../src/index.ts";
import { fakePdfReader } from "./preparation-harness.ts";
import { kestrelJob, mira, started, vitoshaJob } from "./package-fixtures.ts";

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
