import {
  ingestPostings,
  listOpenPostings,
  listPostings,
} from "@/lib/doc/serverStore";
import type { JobPosting } from "@/lib/discovery/types";

// The shared postings pool.
//   GET  /api/discover/postings            → { postings }  (open only)
//   GET  /api/discover/postings?includeClosed=1 → includes expired roles
//   POST /api/discover/postings ← { postings: JobPosting[] }  (merge by id)

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const includeClosed =
      new URL(req.url).searchParams.get("includeClosed") === "1";
    const postings = includeClosed
      ? await listPostings()
      : await listOpenPostings();
    return Response.json({ postings });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { postings?: JobPosting[] };
    if (!Array.isArray(body?.postings)) {
      return Response.json({ error: "Body must be { postings: [] }." }, { status: 400 });
    }
    const added = await ingestPostings(body.postings);
    const total = (await listPostings()).length;
    return Response.json({ added, total });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 400 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed.";
}
