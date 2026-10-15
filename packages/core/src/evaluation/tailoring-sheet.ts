// The tailoring evaluation's two documents (#69): the readable report (the summary per model, then
// every package with each line the honesty validator refused, in full) and the blind comparison
// sheet (each case's two versions, unlabelled and in an order only the key knows) where Kris
// records a verdict per case. The verdicts are read back, and the models revealed, only once every
// case has one.
import type { PackageResult, TailoringReport } from "./tailoring.ts";

const languageName = { en: "English", bg: "Bulgarian" } as const;
const usd = (n: number) => `$${Math.round(n * 10_000) / 10_000}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- the blind sheet

/** Which model wrote Version A and Version B of each case. */
export interface BlindKey {
  cases: { caseId: string; A: string; B: string }[];
}

export interface Verdict {
  caseId: string;
  job: string;
  choice: "A" | "B" | "same";
  /** The model whose version was preferred, or null for "same". */
  preferred: string | null;
  why: string;
}

export type VerdictReading =
  | { complete: false; /** Cases with no verdict yet. */ missing: string[]; /** Verdicts that aren't A, B or same, with what they say. */ unreadable: string[] }
  | { complete: true; verdicts: Verdict[]; /** Cases each model was preferred in, and how many were the same. */ tally: Record<string, number> };

const VERDICT = "Verdict (A, B or same):";
const marker = (caseId: string) => `<!-- case: ${caseId} -->`;

/** One version of a package as Kris reads it: nothing that says which model wrote it. */
function version(p: PackageResult | undefined): string[] {
  if (!p || p.status !== "written") return ["_This version wasn't written._", ""];
  const out: string[] = [];
  const missing = p.missing.map((m) => m.part);
  if (missing.length) out.push(`_Not written: ${missing.join(", ")}._`, "");
  if (p.cv) {
    out.push("**CV summary**", "", p.cv.summary ?? "_(the angle's own summary)_", "", "**CV bullets**", "");
    for (const r of p.cv.roles) {
      out.push(`_${r.heading}_`, "");
      out.push(...(r.bullets.length ? r.bullets.map((b) => `- ${b}`) : ["- (none)"]), "");
    }
  }
  if (p.letter) out.push("**Cover letter**", "", ...p.letter.text.split("\n").map((l) => (l ? `> ${l}` : ">")), "");
  const answers = p.answers.filter((a) => a.drafted);
  if (answers.length) {
    out.push("**Answers**", "");
    for (const a of answers) out.push(`_${a.question}_${a.limit ? ` (at most ${a.limit})` : ""}`, "", a.text, "");
  }
  return out;
}

/** The sheet for a report of exactly two models. `random` decides, per case, which model is Version A. */
export function blindSheet(report: TailoringReport, random: () => number = Math.random): { sheet: string; key: BlindKey } {
  if (report.models.length !== 2) throw new Error("A blind comparison needs exactly two models.");
  const [first, second] = report.models as [string, string];
  const caseIds = [...new Set(report.packages.map((p) => p.caseId))];
  const key: BlindKey = { cases: [] };
  const lines = [
    "# Blind comparison · tailoring evaluation",
    "",
    "Two models wrote each package below from the same profile and posting. Which wrote which is hidden, and the order changes from case to case.",
    "",
    "For each case, read Version A and Version B, then fill in the verdict line with **A**, **B** or **same**, and say why in a few words.",
    "Judge voice and quality: does it sound like a person rather than a template, is it concrete, would you send it?",
    "When every case has a verdict, run `pnpm eval:tailoring:verdicts` to record them and see which model wrote which.",
    "",
  ];
  caseIds.forEach((caseId, i) => {
    const a = random() < 0.5 ? first : second;
    const b = a === first ? second : first;
    key.cases.push({ caseId, A: a, B: b });
    const of = (model: string) => report.packages.find((p) => p.caseId === caseId && p.model === model);
    const any = of(a) ?? of(b)!;
    lines.push(
      "---", "", marker(caseId), "",
      `## Case ${i + 1} of ${caseIds.length} · ${any.job} (${languageName[any.language]})`, "",
      `Profile: ${any.profile} · posting: ${any.posting}`, "",
      "### Version A", "", ...version(of(a)),
      "### Version B", "", ...version(of(b)),
      `${VERDICT} `, "Why: ", "",
    );
  });
  return { sheet: lines.join("\n"), key };
}

/** Reads the verdicts back from the filled-in sheet. Complete only when every case has A, B or same. */
export function readVerdicts(sheet: string, key: BlindKey): VerdictReading {
  const missing: string[] = [];
  const unreadable: string[] = [];
  const verdicts: Verdict[] = [];
  key.cases.forEach((c, i) => {
    const name = `Case ${i + 1} (${c.caseId})`;
    const start = sheet.indexOf(marker(c.caseId));
    const next = key.cases[i + 1] ? sheet.indexOf(marker(key.cases[i + 1]!.caseId)) : -1;
    const section = start < 0 ? "" : sheet.slice(start, next > start ? next : undefined);
    const said = [...section.matchAll(/^Verdict \(A, B or same\):[ \t]*(.*)$/gm)].at(-1)?.[1]?.trim() ?? "";
    const why = [...section.matchAll(/^Why:[ \t]*(.*)$/gm)].at(-1)?.[1]?.trim() ?? "";
    const job = /^## Case \d+ of \d+ · (.*) \((?:English|Bulgarian)\)$/m.exec(section)?.[1] ?? "";
    if (!said) { missing.push(name); return; }
    const choice = /^a\.?$/i.test(said) ? "A" : /^b\.?$/i.test(said) ? "B" : /^same\.?$/i.test(said) ? "same" : null;
    if (!choice) { unreadable.push(`${name}: "${said}"`); return; }
    verdicts.push({ caseId: c.caseId, job, choice, preferred: choice === "same" ? null : c[choice], why });
  });
  if (missing.length || unreadable.length) return { complete: false, missing, unreadable };
  const models = [...new Set(key.cases.flatMap((c) => [c.A, c.B]))].sort();
  const tally: Record<string, number> = Object.fromEntries(models.map((m) => [m, 0]));
  for (const v of verdicts) tally[v.preferred ?? "same"] = (tally[v.preferred ?? "same"] ?? 0) + 1;
  tally.same ??= 0;
  return { complete: true, verdicts, tally };
}

// ---------------------------------------------------------------- the report

export interface ReportInfo {
  startedAt: string;
  /** The verdicts, once recorded. */
  verdicts?: Extract<VerdictReading, { complete: true }>;
}

const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;

function packageLines(p: PackageResult): string[] {
  const out = [`#### ${p.model}`, ""];
  if (p.status === "failed") return [...out, `Failed: ${p.error ?? "unknown"}. Cost ${usd(p.costUsd)}.`, ""];
  const facts = [`Cost ${usd(p.costUsd)}`];
  if (p.answeredBy && p.answeredBy !== p.model) facts.push(`answered by ${p.answeredBy}`);
  if (p.cv) facts.push(`CV ${plural(p.cv.pages, "page")}${p.cv.linesOnPage2 ? ` (${plural(p.cv.linesOnPage2, "line")} on page 2)` : ""}, summary ${plural(p.cv.summaryWords, "word")}`);
  if (p.letter) facts.push(`letter ${plural(p.letter.words, "word")} (target ${p.letter.target})${p.letter.pages ? `, ${plural(p.letter.pages, "page")}` : ""}`);
  out.push(`${facts.join(" · ")}.`, "");

  const list = (title: string, items: string[], none = "None.") => out.push(`**${title}**${items.length ? ` (${items.length})` : ""}`, "", ...(items.length ? items : [none]), "");
  list("Refused by the honesty validator", p.rejected.map((r) => `- ${r.where}: "${r.line}": ${r.problems.join("; it ")}.`));
  list("Flags", p.flags.map((f) => `- ${f.kind}: ${f.title}. ${f.detail}`));
  if (p.heldBack) out.push(`${plural(p.heldBack, "stronger wording")} held back for a decision (near the line).`, "");
  list("Stock phrases", p.stock.map((s) => `- "${s.phrase}" in ${s.in}: "${s.text}"`));
  if (p.letter) list("Cover letter checks not passed", p.letter.checks.map((c) => `- ${c.state}: ${c.label}${c.detail ? `. ${c.detail}` : ""}`));
  if (p.cv?.tooLong.length) list("Too long for the ATS check", p.cv.tooLong.map((t) => `- ${t}`));
  if (p.answers.length) {
    list("Answers", p.answers.map((a) => (a.drafted
      ? `- ${a.question}${a.limit ? ` (at most ${a.limit})` : ""}: ${plural(a.words, "word")}${a.overLimit ? ", over the limit" : ""}`
      : `- ${a.question}: not drafted. ${a.text}`)));
  }
  if (p.missing.length) list("Not written", p.missing.map((m) => `- ${m.part} (${m.state}): ${m.why}`));
  return out;
}

export function formatTailoringReport(report: TailoringReport, info: ReportInfo): string {
  const s = report.summaries;
  const cases = [...new Set(report.packages.map((p) => p.caseId))];
  const at = info.startedAt.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC");
  const out = [
    "# Tailoring evaluation",
    "",
    `Started ${at} · ${plural(cases.length, "case")} · ${s.map((m) => m.model).join(" and ")} · cost ${usd(report.costUsd)}.`,
    "",
    "## Summary",
    "",
    row(["", ...s.map((m) => m.model)]),
    row(["---", ...s.map(() => "---")]),
    row(["Packages written", ...s.map((m) => `${m.written} of ${m.packages}`)]),
    row(["Parts not written", ...s.map((m) => m.missingParts)]),
    row(["Lines the honesty validator refused", ...s.map((m) => m.rejected)]),
  ];
  const kinds = [...new Set(s.flatMap((m) => Object.keys(m.rejectedBy)))].sort();
  for (const k of kinds) out.push(row([`· ${k}`, ...s.map((m) => m.rejectedBy[k] ?? 0)]));
  out.push(row(["Stronger wordings held back", ...s.map((m) => m.heldBack)]));
  const flagKinds = [...new Set(s.flatMap((m) => Object.keys(m.flags)))].sort();
  out.push(row(["Flags", ...s.map((m) => Object.values(m.flags).reduce((a, b) => a + b, 0))]));
  for (const k of flagKinds) out.push(row([`· ${k}`, ...s.map((m) => m.flags[k] ?? 0)]));
  out.push(
    row(["Stock phrases", ...s.map((m) => m.stockPhrases)]),
    row(["Cover letter problems (stop Approve)", ...s.map((m) => m.letterProblems)]),
    row(["CV on one page", ...s.map((m) => `${m.cvOnOnePage} of ${m.packages}`)]),
    row(["Letters within a fifth of the target length", ...s.map((m) => `${m.lettersNearTarget} of ${m.letters}`)]),
    row(["Answers over the form's limit", ...s.map((m) => `${m.answersOverLimit} of ${m.answers}`)]),
    row(["Cost", ...s.map((m) => usd(m.costUsd))]),
    "",
  );

  if (info.verdicts) {
    const t = info.verdicts.tally;
    const models = Object.keys(t).filter((k) => k !== "same").sort((a, b) => t[b]! - t[a]! || a.localeCompare(b));
    out.push("## Your verdicts", "", `${[...models.map((m) => `${m} preferred ${t[m]}`), `the same ${t.same ?? 0}`].join(" · ")}.`, "",
      row(["Case", "Preferred", "Why"]), row(["---", "---", "---"]),
      ...info.verdicts.verdicts.map((v) => row([`${v.caseId} · ${v.job}`, v.preferred ? `${v.preferred} (${v.choice})` : "the same", v.why.replace(/\|/g, "/") || "–"])), "");
  }

  out.push("## Package by package", "");
  for (const c of cases) {
    const ps = report.packages.filter((p) => p.caseId === c);
    const p = ps[0]!;
    out.push(`### ${c} · ${p.job} · ${languageName[p.language]} · ${p.profile}`, "", `Posting: ${p.posting}`, "");
    for (const x of ps) out.push(...packageLines(x));
  }
  return out.join("\n");
}
