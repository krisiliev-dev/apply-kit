import {
  detectAts,
  fetchAtsSchema,
  type AtsJobSchema,
  type AtsPointer,
} from "@/lib/jobs/ats";

// GET /api/jobs/ats-schema?url=<posting-url>
// Proxies to the detected ATS provider (Greenhouse, Lever, Ashby, Workday,
// SmartRecruiters, Teamtailor) and returns a normalised AtsJobSchema the
// client can render as a prefilled form.
//
// Providers whose public APIs don't expose a form definition return a stub
// schema with standard fields (`isStub: true`) rather than an error, so the
// UI always has something to render.

export const runtime = "nodejs";
export const maxDuration = 30;

// Providers that either a) have no public form-definition API, or b) may
// legitimately 404 without it being a system failure. For these we degrade to
// a stub schema instead of surfacing a 502 to the client.
const STUB_FALLBACK_PROVIDERS: ReadonlySet<AtsPointer["provider"]> = new Set([
  "workday",
  "smartrecruiters",
  "teamtailor",
]);

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
          "Couldn't detect a supported ATS. Supported: Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Teamtailor.",
      },
      404,
    );
  }

  try {
    const schema = await fetchAtsSchema(ptr);
    return json({ schema });
  } catch (e) {
    // For stub-friendly providers, fall back to a minimal schema rather than
    // failing — their fetchers already try/catch, but belt-and-suspenders.
    if (STUB_FALLBACK_PROVIDERS.has(ptr.provider)) {
      const schema = stubSchemaFor(ptr, url);
      return json({ schema });
    }
    return json(
      {
        error:
          e instanceof Error ? e.message : "Failed to fetch ATS schema.",
      },
      502,
    );
  }
}

function stubSchemaFor(ptr: AtsPointer, sourceUrl: string): AtsJobSchema {
  return {
    provider: ptr.provider,
    sourceUrl,
    title: `${ptr.provider} posting`,
    company: ptr.company,
    applyUrl: sourceUrl,
    fields: [
      { name: "first_name", label: "First name", type: "text", required: true },
      { name: "last_name", label: "Last name", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone", label: "Phone", type: "text", required: false },
      {
        name: "linkedin",
        label: "LinkedIn URL",
        type: "url",
        required: false,
      },
      { name: "resume", label: "Resume / CV", type: "file", required: true },
      {
        name: "cover_letter",
        label: "Cover letter",
        type: "textarea",
        required: false,
      },
    ],
    isStub: true,
    stubLabel: `${ptr.provider} — standard fields`,
    fields_source: "stub",
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
