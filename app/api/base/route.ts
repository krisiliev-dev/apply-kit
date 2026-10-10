import { readBase, writeBase } from "@/lib/doc/serverStore";
import type { CVContent, Profile } from "@/lib/types";

// The base identity (profile + CVContent) the AI tailors FROM, in the shared
// store. Lets the agent set up the user's CV (write_base) and lets the browser
// pull it into localStorage.
//   GET /api/base  → { base: { profile, cv, updatedAt } | null }
//   PUT /api/base  ← { profile, cv }  (or { base: { profile, cv } })

export const runtime = "nodejs";

export async function GET() {
  try {
    const base = await readBase();
    return Response.json({ base });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as {
      profile?: Profile;
      cv?: CVContent;
      base?: { profile?: Profile; cv?: CVContent };
    };
    const profile = body?.profile ?? body?.base?.profile;
    const cv = body?.cv ?? body?.base?.cv;
    if (!profile || typeof profile.name !== "string" || !profile.name.trim()) {
      return Response.json({ error: "profile.name is required." }, { status: 400 });
    }
    if (!cv || !Array.isArray(cv.experiences)) {
      return Response.json(
        { error: "cv.experiences (array) is required." },
        { status: 400 },
      );
    }
    const saved = await writeBase({ profile, cv });
    return Response.json({ base: saved });
  } catch (err) {
    return Response.json({ error: msg(err) }, { status: 400 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed.";
}
