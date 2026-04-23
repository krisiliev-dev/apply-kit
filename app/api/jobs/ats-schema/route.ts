import { detectAts, fetchAtsSchema } from "@/lib/jobs/ats";

// GET /api/jobs/ats-schema?url=<posting-url>
// Proxies to the detected ATS provider (Greenhouse, Lever, Ashby) and returns
// a normalised AtsJobSchema the client can render as a prefilled form.

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) {
    return json({ error: "Missing `url` query parameter." }, 400);
  }

  const ptr = detectAts(url);
  if (!ptr) {
    return json(
      {
        error:
          "Couldn't detect a supported ATS. Supported: Greenhouse, Lever, Ashby.",
      },
      404,
    );
  }

  try {
    const schema = await fetchAtsSchema(ptr);
    return json({ schema });
  } catch (e) {
    return json(
      {
        error:
          e instanceof Error ? e.message : "Failed to fetch ATS schema.",
      },
      502,
    );
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
