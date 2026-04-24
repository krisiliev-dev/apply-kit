import type { CvDocument } from "@/lib/doc/types";
import type { ParsedJob } from "@/lib/app/types";
import { evaluateCv } from "@/lib/evaluation/evaluate";

// POST /api/cv-evaluate
//
// Body:  { doc: CvDocument, parsedJob?: ParsedJob }
// Reply: CvEvaluation
//
// Non-streaming. The refine route (see /refine) streams iterative progress.

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  doc: CvDocument;
  parsedJob?: ParsedJob;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body?.doc) {
    return json({ error: "Missing `doc` in body." }, 400);
  }

  try {
    const evaluation = await evaluateCv({
      doc: body.doc,
      job: body.parsedJob ?? null,
    });
    return json(evaluation);
  } catch (err) {
    return json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Evaluation failed.",
      },
      500,
    );
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
