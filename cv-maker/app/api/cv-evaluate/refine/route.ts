import type { CvDocument } from "@/lib/doc/types";
import type { ParsedJob } from "@/lib/app/types";
import type { Settings } from "@/lib/settings/types";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_TARGET_SCORE,
  refineCv,
  type RefineProgressUpdate,
} from "@/lib/evaluation/refine";
import { describeChoice } from "@/lib/ai/provider";
import { buildNdjsonUsageFrame, streamingUsageHeader } from "@/lib/ai/route";

// POST /api/cv-evaluate/refine
//
// Streams newline-delimited JSON progress frames as the iterative refinement
// loop runs, followed by a final `result` frame with the best doc + full
// iteration trace. Each frame is a JSON object followed by `\n`.
//
// Frame types (tagged `type`):
//   { type: "stage", iteration, stage, message }
//   { type: "iteration-done", iteration, score, delta, warningCount }
//   { type: "refining", iteration, message }
//   { type: "done", message }
//   { type: "result", best, iterations }
//   { type: "error", message }
//
// Why NDJSON and not SSE: the client just polls `.read()` on a text stream —
// no event-listener ceremony, and we don't need reconnection semantics.

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  doc: CvDocument;
  parsedJob?: ParsedJob;
  maxIterations?: number;
  targetScore?: number;
  settings?: Settings;
};

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!body?.doc) {
    return new Response(JSON.stringify({ error: "Missing `doc` in body." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const maxIterations = clamp(
    body.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    1,
    5,
  );
  const targetScore = clamp(body.targetScore ?? DEFAULT_TARGET_SCORE, 50, 100);

  const encoder = new TextEncoder();
  const choice = describeChoice("draft", body.settings);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // client disconnected
        }
      };

      const onProgress = (p: RefineProgressUpdate) => {
        if (p.kind === "stage") {
          write({ type: "stage", iteration: p.iteration, stage: p.stage, message: p.message });
        } else if (p.kind === "iteration-done") {
          write({
            type: "iteration-done",
            iteration: p.iteration,
            score: p.score,
            delta: p.delta,
            warningCount: p.warningCount,
          });
        } else if (p.kind === "refining") {
          write({ type: "refining", iteration: p.iteration, message: p.message });
        } else {
          write({ type: "done", message: p.message });
        }
      };

      try {
        const result = await refineCv(
          {
            doc: body.doc,
            job: body.parsedJob ?? null,
            settings: body.settings,
            maxIterations,
            targetScore,
          },
          onProgress,
        );

        write({
          type: "result",
          best: {
            doc: result.best.doc,
            evaluation: result.best.evaluation,
            appliedEdits: result.best.appliedEdits,
            index: result.best.index,
          },
          iterations: result.iterations.map((it) => ({
            index: it.index,
            doc: it.doc,
            evaluation: it.evaluation,
            appliedEdits: it.appliedEdits,
          })),
        });
      } catch (err) {
        write({
          type: "error",
          message:
            err instanceof Error ? err.message : "Refine loop failed.",
        });
      } finally {
        try {
          // Final usage frame for the client ledger. The internal refine
          // loop runs many `generateObject` calls whose individual usage
          // isn't currently aggregated here; we emit an envelope that
          // identifies feature/provider/model so the ledger at least
          // records the session. When `lib/evaluation/refine.ts` returns
          // aggregate usage, plumb it into `usage` here.
          controller.enqueue(
            encoder.encode(
              buildNdjsonUsageFrame({
                feature: "draft",
                choice,
                usage: null,
              }) + "\n",
            ),
          );
        } catch {
          // never block stream closure on ledger bookkeeping
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      ...streamingUsageHeader({ feature: "draft", choice }),
    },
  });
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
