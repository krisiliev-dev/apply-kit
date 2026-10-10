import type {
  AffindaEducationEntry,
  AffindaExtracted,
  AffindaResult,
  AffindaWorkEntry,
} from "./types";

// ————————————————————————————————————————————————
// Layer 1a — Affinda Resume Parser client.
//
// Affinda's v3 API:
//   POST /v3/resumes                → uploads the file, returns a Document
//                                    (id, meta, and data object that's null
//                                     until parsing completes).
//   GET  /v3/documents/{identifier} → returns the document with data once
//                                     parsing completes.
//
// The API is async — on upload we typically get `ready: false` and must poll
// the GET endpoint for `ready: true`. We poll with exponential backoff up to
// ~30 seconds.
//
// Docs: https://docs.affinda.com/docs/api-reference-1/ and the OpenAPI
// definition at https://api.affinda.com/v3/redoc.
// ————————————————————————————————————————————————

const AFFINDA_API = "https://api.affinda.com/v3";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

type AffindaUploadResponse = {
  meta?: { identifier?: string; ready?: boolean };
  data?: AffindaRawData | null;
  error?: { errorCode?: string; errorDetail?: string };
};

type AffindaRawData = {
  name?: { raw?: string; first?: string; last?: string } | string;
  emails?: string[] | null;
  phoneNumbers?: string[] | null;
  location?: { formatted?: string; rawInput?: string } | string | null;
  summary?: string | null;
  objective?: string | null;
  skills?: Array<{ name?: string } | string> | null;
  languages?: Array<{ name?: string } | string> | null;
  workExperience?: Array<RawWorkEntry> | null;
  education?: Array<RawEducationEntry> | null;
};

type RawWorkEntry = {
  jobTitle?: string | null;
  organization?: string | null;
  dates?: { startDate?: string | null; endDate?: string | null } | null;
  jobDescription?: string | null;
};

type RawEducationEntry = {
  organization?: string | null;
  accreditation?: { education?: string | null; inputStr?: string | null } | null;
  dates?: {
    startDate?: string | null;
    completionDate?: string | null;
    endDate?: string | null;
  } | null;
};

export async function parseCv(pdfBuffer: Buffer): Promise<AffindaResult> {
  const apiKey = process.env.AFFINDA_API_KEY;

  if (!apiKey) {
    return buildUnavailable(
      "AFFINDA_API_KEY not set — layer 1 (parser) was skipped. Parseability score is treated as neutral.",
    );
  }

  try {
    const uploaded = await uploadResume(pdfBuffer, apiKey);
    const id = uploaded.meta?.identifier;
    if (!id) {
      return buildUnavailable("Affinda upload did not return a document id.");
    }

    const doc = uploaded.meta?.ready
      ? uploaded
      : await pollForDocument(id, apiKey);

    const extracted = normalizeAffindaData(doc.data ?? null);
    const missing = computeMissing(extracted);

    return {
      extracted,
      missing,
      rawDocumentId: id,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Affinda request failed.";
    return buildUnavailable(`Affinda failure: ${message}`);
  }
}

function buildUnavailable(reason: string): AffindaResult {
  return {
    extracted: {
      workExperience: [],
      education: [],
      skills: [],
    },
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
    unavailableReason: reason,
  };
}

async function uploadResume(
  pdf: Buffer,
  apiKey: string,
): Promise<AffindaUploadResponse> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
  form.append("file", blob, "cv.pdf");
  form.append("wait", "true");

  const res = await fetch(`${AFFINDA_API}/resumes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Affinda upload ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as AffindaUploadResponse;
  if (body.error?.errorCode) {
    throw new Error(
      `Affinda error ${body.error.errorCode}: ${body.error.errorDetail ?? ""}`,
    );
  }
  return body;
}

async function pollForDocument(
  id: string,
  apiKey: string,
): Promise<AffindaUploadResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${AFFINDA_API}/documents/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) continue;
    const body = (await res.json()) as AffindaUploadResponse;
    if (body.meta?.ready) return body;
  }

  throw new Error("Affinda parse timed out.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ————————————————————————————————————————————————
// Normalization — collapse Affinda's nested, optional-everywhere shape into
// our flat AffindaExtracted.
// ————————————————————————————————————————————————

function normalizeAffindaData(data: AffindaRawData | null): AffindaExtracted {
  if (!data) {
    return { workExperience: [], education: [], skills: [] };
  }

  const name = pickName(data.name);
  const email = first(data.emails);
  const phone = first(data.phoneNumbers);
  const location = pickLocation(data.location);
  const summary = data.summary ?? data.objective ?? undefined;

  const skills = pickStringList(data.skills);
  const languages = pickStringList(data.languages);

  const workExperience: AffindaWorkEntry[] = (data.workExperience ?? [])
    .filter((w): w is RawWorkEntry => Boolean(w))
    .map((w) => ({
      title: w.jobTitle ?? undefined,
      company: w.organization ?? undefined,
      start: w.dates?.startDate ?? undefined,
      end: w.dates?.endDate ?? undefined,
      bullets: splitDescription(w.jobDescription),
    }));

  const education: AffindaEducationEntry[] = (data.education ?? [])
    .filter((e): e is RawEducationEntry => Boolean(e))
    .map((e) => ({
      school: e.organization ?? undefined,
      degree:
        e.accreditation?.education ??
        e.accreditation?.inputStr ??
        undefined,
      start: e.dates?.startDate ?? undefined,
      end: e.dates?.completionDate ?? e.dates?.endDate ?? undefined,
    }));

  return {
    name: name || undefined,
    email: email || undefined,
    phone: phone || undefined,
    location: location || undefined,
    summary: summary ?? undefined,
    workExperience,
    education,
    skills,
    languages: languages.length > 0 ? languages : undefined,
  };
}

function pickName(raw: AffindaRawData["name"]): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw.trim() || undefined;
  if (raw.raw) return raw.raw.trim() || undefined;
  const full = [raw.first, raw.last].filter(Boolean).join(" ").trim();
  return full || undefined;
}

function pickLocation(raw: AffindaRawData["location"]): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw.trim() || undefined;
  return raw.formatted ?? raw.rawInput ?? undefined;
}

function pickStringList(
  raw: Array<{ name?: string } | string> | null | undefined,
): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push(s);
    } else if (item && typeof item.name === "string") {
      const s = item.name.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function first(arr: string[] | null | undefined): string | undefined {
  if (!arr) return undefined;
  for (const a of arr) {
    if (a && a.trim()) return a.trim();
  }
  return undefined;
}

function splitDescription(desc: string | null | undefined): string[] | undefined {
  if (!desc) return undefined;
  const lines = desc
    .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => l.trim().replace(/^[•\-*•]\s*/, ""))
    .filter((l) => l.length > 3);
  return lines.length > 0 ? lines : undefined;
}

function computeMissing(extracted: AffindaExtracted): string[] {
  const missing: string[] = [];
  if (!extracted.name) missing.push("name");
  if (!extracted.email) missing.push("email");
  if (!extracted.phone) missing.push("phone");
  if (!extracted.location) missing.push("location");
  if (!extracted.summary) missing.push("summary");
  if (extracted.workExperience.length === 0) missing.push("workExperience");
  if (extracted.education.length === 0) missing.push("education");
  if (extracted.skills.length === 0) missing.push("skills");
  return missing;
}
