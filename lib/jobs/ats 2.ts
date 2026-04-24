// ATS detection + public schema fetch. Runs server-side from the ats-schema
// route; the client only needs the detection helper, so that part is pure.
//
// We support three providers that expose a public JSON endpoint per job:
//   * Greenhouse: https://boards-api.greenhouse.io/v1/boards/<company>/jobs/<id>
//   * Lever:      https://api.lever.co/v0/postings/<company>/<id>
//   * Ashby:      https://api.ashbyhq.com/posting-api/job-board/<company>/<id>
//
// None of them accepts submissions anonymously. We only read the schema to
// render a prefilled form — the user copies fields into the real application.

export type AtsProvider = "greenhouse" | "lever" | "ashby";

export type AtsPointer = {
  provider: AtsProvider;
  company: string; // board slug (e.g. "vercel")
  jobId: string;
};

export type AtsField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "email" | "url" | "file" | "select";
  required: boolean;
  options?: { label: string; value: string }[];
  help?: string;
};

export type AtsJobSchema = {
  provider: AtsProvider;
  sourceUrl: string;
  title: string;
  company: string;
  location?: string;
  applyUrl?: string;
  fields: AtsField[];
  raw?: unknown;
};

// ———————————————————————————————————————————————
// Detection (safe to call anywhere)
// ———————————————————————————————————————————————

export function detectAts(input: string): AtsPointer | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  // Greenhouse: boards.greenhouse.io/<company>/jobs/<id>
  // New variant: job-boards.greenhouse.io/<company>/jobs/<id>
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const company = parts[0];
    const jobsIdx = parts.indexOf("jobs");
    const jobId = jobsIdx >= 0 ? parts[jobsIdx + 1] : undefined;
    if (company && jobId) return { provider: "greenhouse", company, jobId };
  }

  // Lever: jobs.lever.co/<company>/<id>
  if (host === "jobs.lever.co") {
    const [company, jobId] = parts;
    if (company && jobId) return { provider: "lever", company, jobId };
  }

  // Ashby: jobs.ashbyhq.com/<company>/<id>
  if (host === "jobs.ashbyhq.com") {
    const [company, jobId] = parts;
    if (company && jobId) return { provider: "ashby", company, jobId };
  }

  return null;
}

// ———————————————————————————————————————————————
// Fetchers (server-only — called from the route handler)
// ———————————————————————————————————————————————

export async function fetchAtsSchema(ptr: AtsPointer): Promise<AtsJobSchema> {
  switch (ptr.provider) {
    case "greenhouse":
      return fetchGreenhouse(ptr);
    case "lever":
      return fetchLever(ptr);
    case "ashby":
      return fetchAshby(ptr);
  }
}

// ---- Greenhouse --------------------------------------------------------
// Docs: https://developers.greenhouse.io/job-board.html
// Endpoint returns `questions` as an array of { label, required, fields: [...] }.

type GhQuestionField = {
  name: string;
  type: string; // input_text | textarea | input_file | multi_value_single_select | ...
  values?: { label: string; value: string | number }[];
};
type GhQuestion = {
  label: string;
  required: boolean;
  description?: string;
  fields: GhQuestionField[];
};
type GhJob = {
  id: number;
  title: string;
  absolute_url: string;
  company_name?: string;
  location?: { name: string };
  questions?: GhQuestion[];
  content?: string;
};

async function fetchGreenhouse(ptr: AtsPointer): Promise<AtsJobSchema> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    ptr.company,
  )}/jobs/${encodeURIComponent(ptr.jobId)}?questions=true`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Greenhouse API returned ${res.status}`);
  }
  const data = (await res.json()) as GhJob;

  const fields: AtsField[] = (data.questions ?? []).flatMap((q) =>
    q.fields.map<AtsField>((f) => {
      const type = mapGreenhouseType(f.type);
      return {
        name: f.name,
        label: q.label,
        type,
        required: q.required,
        help: q.description,
        options: f.values?.map((v) => ({
          label: v.label,
          value: String(v.value),
        })),
      };
    }),
  );

  return {
    provider: "greenhouse",
    sourceUrl: data.absolute_url,
    title: data.title,
    company: data.company_name ?? ptr.company,
    location: data.location?.name,
    applyUrl: data.absolute_url,
    fields,
    raw: data,
  };
}

function mapGreenhouseType(t: string): AtsField["type"] {
  switch (t) {
    case "input_text":
      return "text";
    case "textarea":
      return "textarea";
    case "input_file":
      return "file";
    case "multi_value_single_select":
    case "single_select":
      return "select";
    default:
      if (t.includes("email")) return "email";
      if (t.includes("url")) return "url";
      return "text";
  }
}

// ---- Lever -------------------------------------------------------------
// Public posting API: https://api.lever.co/v0/postings/<site>/<id>
// Lever doesn't expose a field-by-field application schema publicly — but we
// can at minimum surface core job metadata + a stub of standard fields.

type LeverPosting = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  categories?: { location?: string; team?: string; commitment?: string };
  lists?: { text: string; content: string }[];
  additional?: string;
};

async function fetchLever(ptr: AtsPointer): Promise<AtsJobSchema> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(
    ptr.company,
  )}/${encodeURIComponent(ptr.jobId)}?mode=json`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Lever API returned ${res.status}`);
  const data = (await res.json()) as LeverPosting;

  // Lever's standard application form: name, email, phone, resume, cover
  // letter, LinkedIn, plus any custom questions (not exposed here).
  const fields: AtsField[] = [
    { name: "name", label: "Full name", type: "text", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone", type: "text", required: false },
    { name: "urls[LinkedIn]", label: "LinkedIn URL", type: "url", required: false },
    { name: "resume", label: "Resume / CV", type: "file", required: true },
    { name: "coverLetter", label: "Cover letter", type: "textarea", required: false },
  ];

  return {
    provider: "lever",
    sourceUrl: data.hostedUrl,
    title: data.text,
    company: ptr.company,
    location: data.categories?.location,
    applyUrl: data.applyUrl ?? data.hostedUrl,
    fields,
    raw: data,
  };
}

// ---- Ashby -------------------------------------------------------------
// Docs: https://developers.ashbyhq.com/reference/publicjobpostinginfo
// Posting API returns `applicationFormDefinition.sections[].fields`.

type AshbyFormField = {
  path: string;
  title: string;
  isRequired: boolean;
  type: string; // String | LongText | Email | File | ValueSelect | ...
  selectableValues?: { label: string; value: string }[];
  descriptionHtml?: string;
};
type AshbySection = { title: string; fields: AshbyFormField[] };
type AshbyPosting = {
  id: string;
  title: string;
  teamName?: string;
  locationName?: string;
  jobUrl?: string;
  applyUrl?: string;
  applicationFormDefinition?: { sections: AshbySection[] };
};

async function fetchAshby(ptr: AtsPointer): Promise<AtsJobSchema> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
    ptr.company,
  )}/${encodeURIComponent(ptr.jobId)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Ashby API returned ${res.status}`);
  const data = (await res.json()) as AshbyPosting;

  const fields: AtsField[] =
    data.applicationFormDefinition?.sections.flatMap((s) =>
      s.fields.map<AtsField>((f) => ({
        name: f.path,
        label: f.title,
        type: mapAshbyType(f.type),
        required: f.isRequired,
        options: f.selectableValues,
        help: f.descriptionHtml?.replace(/<[^>]+>/g, "").trim() || undefined,
      })),
    ) ?? [];

  return {
    provider: "ashby",
    sourceUrl: data.jobUrl ?? "",
    title: data.title,
    company: ptr.company,
    location: data.locationName,
    applyUrl: data.applyUrl ?? data.jobUrl,
    fields,
    raw: data,
  };
}

function mapAshbyType(t: string): AtsField["type"] {
  switch (t) {
    case "Email":
      return "email";
    case "File":
      return "file";
    case "LongText":
      return "textarea";
    case "ValueSelect":
      return "select";
    case "Url":
    case "URL":
      return "url";
    default:
      return "text";
  }
}
