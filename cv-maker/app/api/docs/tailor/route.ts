import {
  makeSlug,
  readBase,
  upsertVariant,
  writeDoc,
} from "@/lib/doc/serverStore";
import { seedFromContent } from "@/lib/jobs/seedFromContent";
import type { CVContent } from "@/lib/types";
import type { ParsedJob } from "@/lib/app/types";

// POST /api/docs/tailor
// Body: { jobText?, jobUrl?, company?, role? }
//
// One-shot "rework my CV for this job" used by the MCP `tailor_cv` tool (and
// usable from the UI). Reads the stored base CV, parses the posting, drafts a
// tailored variant, seeds it into a document, and saves it to the shared store
// + variant registry. Reuses the existing /api/jobs/parse and /api/jobs/draft
// endpoints via an internal self-call so there's one drafting code path.

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  jobText?: string;
  jobUrl?: string;
  company?: string;
  role?: string;
};

type TailoredCv = {
  targetRole?: string;
  profile?: CVContent["profile"];
  experiences?: CVContent["experiences"];
  education?: CVContent["education"];
  skills?: CVContent["skills"];
  interests?: CVContent["interests"];
  tailoringNotes?: string[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const jobText = body.jobText?.trim();
  const jobUrl = body.jobUrl?.trim();
  if (!jobText && !jobUrl) {
    return json({ error: "Provide jobText or jobUrl." }, 400);
  }

  const base = await readBase();
  if (!base) {
    return json(
      {
        error:
          "No base CV in the store. Set it first via Settings → Data (Load), or the write_base tool.",
      },
      400,
    );
  }

  const origin = new URL(req.url).origin;
  const headers = { "content-type": "application/json" };

  // 1. Parse the posting into a structured ParsedJob.
  let job: ParsedJob;
  try {
    const res = await fetch(`${origin}/api/jobs/parse`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: jobText, url: jobUrl }),
    });
    const data = (await res.json()) as { job?: ParsedJob; error?: string };
    if (!res.ok || !data.job) {
      return json({ error: data.error ?? "Failed to parse the posting." }, 502);
    }
    job = data.job;
  } catch (err) {
    return json({ error: `Parse step failed: ${errMsg(err)}` }, 502);
  }

  // 2. Draft a tailored CV from the stored base. Skip the heavy refine loop —
  //    the agent can request a full evaluation separately.
  let tailored: TailoredCv;
  try {
    const res = await fetch(`${origin}/api/jobs/draft`, {
      method: "POST",
      headers,
      body: JSON.stringify({ job, baseCv: base.cv, skipEvaluation: true }),
    });
    const data = (await res.json()) as { cv?: TailoredCv; error?: string };
    if (!res.ok || !data.cv) {
      return json({ error: data.error ?? "Failed to draft the CV." }, 502);
    }
    tailored = data.cv;
  } catch (err) {
    return json({ error: `Draft step failed: ${errMsg(err)}` }, 502);
  }

  // 3. Assemble CVContent, preferring the tailored output, falling back to base.
  const slug = makeSlug(body.company || job.company, body.role || job.title);
  const content: CVContent = {
    slug,
    targetRole: tailored.targetRole || job.title || base.cv.targetRole,
    profile: tailored.profile ?? base.cv.profile,
    experiences: tailored.experiences ?? base.cv.experiences,
    education: tailored.education ?? base.cv.education,
    skills: tailored.skills ?? base.cv.skills,
    interests: tailored.interests ?? base.cv.interests,
  };

  // 4. Seed a document and persist it + register the variant.
  try {
    const doc = seedFromContent(slug, content);
    await writeDoc(doc);
    await upsertVariant({
      slug,
      targetRole: content.targetRole,
      company: job.company,
      createdAt: Date.now(),
      source: "job",
    });
    return json(
      {
        slug,
        company: job.company,
        role: job.title,
        targetRole: content.targetRole,
        tailoringNotes: tailored.tailoringNotes ?? [],
        doc,
      },
      200,
    );
  } catch (err) {
    return json({ error: `Save step failed: ${errMsg(err)}` }, 500);
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
