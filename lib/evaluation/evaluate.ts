import type { CvDocument } from "@/lib/doc/types";
import type { ParsedJob } from "@/lib/app/types";
import type { CvEvaluation, SixSecondReport } from "./types";
import { parseCv } from "./affinda";
import { renderCvToPdf } from "./render";
import { scoreCvDocumentKeywords } from "./keywords";
import { recruiterEyePass } from "./recruiterEye";
import { composeEvaluation, scoreParseability } from "./score";
import { runSixSecondTest } from "./sixSecondTest";
import { inspectNumbers } from "./numberInspector";
import { inspectProof } from "./proofInspector";
import { detectArchetypes } from "./archetypeDetector";
import { inspectTenure } from "./tenureInspector";

// ————————————————————————————————————————————————
// Top-level evaluator — orchestrates all layers where possible and composes
// the result.
//
// Render + Affinda is a serial pair (parse needs the PDF). The recruiter-eye
// pass and the six-second test are both LLM calls; recruiter uses flattened
// text (no render dependency), six-second needs the PDF so it runs only
// after render succeeds. Both kick off as soon as their dependencies resolve.
//
// The number inspector is static and always runs.
// ————————————————————————————————————————————————

export type EvaluateOptions = {
  doc: CvDocument;
  job: ParsedJob | null;
};

export type ProgressUpdate = {
  stage:
    | "render"
    | "parse"
    | "keywords"
    | "recruiter"
    | "six-second"
    | "numbers"
    | "proof"
    | "archetype"
    | "tenure"
    | "score"
    | "done"
    | "error";
  message: string;
};

export async function evaluateCv(
  opts: EvaluateOptions,
  onProgress?: (p: ProgressUpdate) => void,
): Promise<CvEvaluation> {
  const emit = (p: ProgressUpdate) => {
    try {
      onProgress?.(p);
    } catch {
      // swallow — emit must never break the eval
    }
  };

  emit({ stage: "render", message: "Rendering CV to PDF…" });

  // PDF render is a shared dependency for parseability + six-second. Kick it
  // off once, then fan out.
  const pdfPromise: Promise<Buffer | null> = safeRender(opts.doc).catch((err) => {
    emit({ stage: "error", message: `Render failed: ${formatErr(err)}` });
    return null;
  });

  const parseResultPromise = pdfPromise.then(async (pdf) => {
    if (!pdf) {
      return null;
    }
    emit({ stage: "parse", message: "Parsing with Affinda…" });
    try {
      return await parseCv(pdf);
    } catch (err) {
      emit({ stage: "error", message: `Parse layer failed: ${formatErr(err)}` });
      return null;
    }
  });

  emit({ stage: "recruiter", message: "Running recruiter-eye pass…" });
  const recruiterPromise = recruiterEyePass(opts.doc, opts.job);

  // Six-second test: requires both the PDF and (ideally) the Affinda extract
  // for mismatch checks. Skips cleanly when either dependency is missing.
  const sixSecondPromise: Promise<SixSecondReport | undefined> = (async () => {
    const pdf = await pdfPromise;
    if (!pdf) {
      return {
        strongestSignal: "",
        oneThingRemembered: "",
        misreadings: [],
        scannabilityScore: 60,
        warnings: [],
        unavailable: true,
        unavailableReason:
          "Six-second test requires Affinda + Puppeteer (needs the PDF render).",
      } satisfies SixSecondReport;
    }
    const affindaKey = process.env.AFFINDA_API_KEY;
    if (!affindaKey) {
      return {
        strongestSignal: "",
        oneThingRemembered: "",
        misreadings: [],
        scannabilityScore: 60,
        warnings: [],
        unavailable: true,
        unavailableReason:
          "Six-second test requires Affinda + Puppeteer (needs the PDF render).",
      } satisfies SixSecondReport;
    }

    emit({ stage: "six-second", message: "Running 6-second skim simulation…" });
    const parseResult = await parseResultPromise;
    const extracted =
      parseResult && !parseResult.unavailable ? parseResult.extracted : null;
    return await runSixSecondTest({
      doc: opts.doc,
      pdf,
      extracted,
    });
  })();

  const [parseResult, recruiterResult, sixSecondResult] = await Promise.all([
    parseResultPromise,
    recruiterPromise,
    sixSecondPromise,
  ]);

  emit({ stage: "numbers", message: "Inspecting bullets for metrics…" });
  const numbersReport = inspectNumbers(opts.doc);

  emit({ stage: "proof", message: "Checking proof-of-work links…" });
  const proofReport = inspectProof(opts.doc);

  emit({ stage: "archetype", message: "Scanning for boilerplate phrases…" });
  const archetypeReport = detectArchetypes(opts.doc);

  emit({ stage: "tenure", message: "Analysing tenure pattern…" });
  const tenureReport = inspectTenure(opts.doc);

  emit({ stage: "keywords", message: "Scoring keyword alignment…" });

  const extractedForKeywords =
    parseResult && !parseResult.unavailable ? parseResult.extracted : null;
  const keywordScore = scoreCvDocumentKeywords({
    doc: opts.doc,
    job: opts.job,
    extracted: extractedForKeywords,
  });

  emit({ stage: "score", message: "Composing composite score…" });

  const parseabilityScore = scoreParseability(
    opts.doc,
    parseResult ?? {
      extracted: { workExperience: [], education: [], skills: [] },
      missing: [
        "name",
        "email",
        "phone",
        "location",
        "summary",
        "workExperience",
        "education",
        "skills",
      ],
      rawDocumentId: "",
      unavailable: true,
      unavailableReason: "Render failed before reaching Affinda.",
    },
  );

  const evaluation = composeEvaluation({
    doc: opts.doc,
    job: opts.job,
    parseability: parseabilityScore,
    keywords: keywordScore,
    recruiter: recruiterResult,
    sixSecond: sixSecondResult,
    numbers: numbersReport,
    proof: proofReport,
    archetype: archetypeReport,
    tenure: tenureReport,
  });

  emit({ stage: "done", message: `Overall ${evaluation.overall}/100.` });

  return evaluation;
}

async function safeRender(doc: CvDocument): Promise<Buffer> {
  return await renderCvToPdf(doc);
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
