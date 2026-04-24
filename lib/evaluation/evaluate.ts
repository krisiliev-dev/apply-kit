import type { CvDocument } from "@/lib/doc/types";
import type { ParsedJob } from "@/lib/app/types";
import type { CvEvaluation } from "./types";
import { parseCv } from "./affinda";
import { renderCvToPdf } from "./render";
import { scoreCvDocumentKeywords } from "./keywords";
import { recruiterEyePass } from "./recruiterEye";
import { composeEvaluation, scoreParseability } from "./score";

// ————————————————————————————————————————————————
// Top-level evaluator — orchestrates all three layers in parallel where
// possible and composes the result.
//
// Render + Affinda is a serial pair (parse needs the PDF). The recruiter-eye
// pass is independent and runs concurrently.
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

  const pdfPromise = safeRender(opts.doc).then((r) => {
    emit({ stage: "parse", message: "Parsing with Affinda…" });
    return parseCv(r);
  });

  emit({ stage: "recruiter", message: "Running recruiter-eye pass…" });
  const recruiterPromise = recruiterEyePass(opts.doc, opts.job);

  const [parseResult, recruiterResult] = await Promise.all([
    pdfPromise.catch((err) => {
      emit({ stage: "error", message: `Parse layer failed: ${formatErr(err)}` });
      return null;
    }),
    recruiterPromise,
  ]);

  emit({ stage: "keywords", message: "Scoring keyword alignment…" });

  const extractedForKeywords = parseResult && !parseResult.unavailable
    ? parseResult.extracted
    : null;
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
