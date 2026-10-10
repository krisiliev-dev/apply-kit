import { computePacing } from "@/lib/advisor/pacing";
import type { Application } from "@/lib/app/types";

// POST /api/advisor/pacing
//
// Pure server-side math. No LLM call.
// Body: { applications: Application[], sustainablePerWeek?, monthlyTarget? }
// Reply: PacingSnapshot

export const runtime = "nodejs";
export const maxDuration = 10;

type Body = {
  applications: Pick<Application, "dateCreated">[];
  sustainablePerWeek?: number;
  monthlyTarget?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const apps = Array.isArray(body?.applications) ? body.applications : [];
  const snapshot = computePacing({
    applications: apps,
    sustainablePerWeek: body.sustainablePerWeek,
    monthlyTarget: body.monthlyTarget,
  });

  return json(snapshot);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
