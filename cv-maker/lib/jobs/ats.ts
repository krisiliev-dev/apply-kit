// ATS detection + public schema fetch. Runs server-side from the ats-schema
// route; the client only needs the detection helper, so that part is pure.
//
// We support six providers, three with real form-definition APIs and three
// that fall back to a stub of standard fields when the ATS doesn't expose a
// scraping-free public form schema:
//   * Greenhouse:      https://boards-api.greenhouse.io/v1/boards/<company>/jobs/<id>  (real)
//   * Lever:           https://api.lever.co/v0/postings/<company>/<id>                 (partial — stub fields)
//   * Ashby:           https://api.ashbyhq.com/posting-api/job-board/<company>/<id>    (real)
//   * Workday:         <tenant>.<dc>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/job/<id> (stub — tenants differ wildly)
//   * SmartRecruiters: https://api.smartrecruiters.com/v1/companies/<company>/postings/<id> (metadata + stub form)
//   * Teamtailor:      https://api.teamtailor.com/v1/public/jobs/<id>                   (metadata + stub form)
//
// None of them accepts submissions anonymously. We only read the schema to
// render a prefilled form — the user copies fields into the real application.

export type AtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "smartrecruiters"
  | "teamtailor";

// Back-compat alias — the feature brief refers to this as `AtsKind`.
export type AtsKind = AtsProvider;

export type AtsPointer = {
  provider: AtsProvider;
  company: string; // board slug / tenant / company id
  jobId: string;
  // Workday needs extra tenant routing info; optional so the type stays flat.
  workdayHost?: string; // e.g. "wd1.myworkdayjobs.com"
  workdaySite?: string; // e.g. "External"
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
  // When true, `fields` is a generic fallback rather than the real form
  // definition (provider doesn't expose one publicly, or extraction failed
  // gracefully). UI should show a note so the user double-checks the real form.
  isStub?: boolean;
  // Short label explaining the stub — e.g. "Workday tenant — standard fields".
  stubLabel?: string;
  fields_source?: "api" | "stub";
  raw?: unknown;
};

// Alias to match the naming used elsewhere in the brief.
export type AtsFormSchema = AtsJobSchema;

// ———————————————————————————————————————————————
// Detection (safe to call anywhere)
// ———————————————————————————————————————————————

// Detection examples (kept inline instead of a test runner):
//   https://boards.greenhouse.io/vercel/jobs/1234                 -> greenhouse
//   https://job-boards.greenhouse.io/airbnb/jobs/5678              -> greenhouse
//   https://jobs.lever.co/stripe/abc-def                           -> lever
//   https://jobs.ashbyhq.com/linear/9999                           -> ashby
//   https://nvidia.wd5.myworkdayjobs.com/en-US/External/job/...    -> workday
//   https://foo.wd1.myworkdayjobs.com/en-US/Careers/job/.../R-1    -> workday
//   https://careers.smartrecruiters.com/Bosch/12345                -> smartrecruiters
//   https://jobs.smartrecruiters.com/Acme/900000000                -> smartrecruiters
//   https://acme.teamtailor.com/jobs/123456-senior-engineer        -> teamtailor
//   https://careers.acme.com/listing/5                             -> null
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

  // Workday: <tenant>.<wdN>.myworkdayjobs.com/.../<site>/job/<slug>/<reqId>
  // Hostname always ends with `.myworkdayjobs.com`. The tenant is the leftmost
  // label, then a data-centre label (wd1/wd3/wd5/etc), then the suffix.
  if (host.endsWith(".myworkdayjobs.com")) {
    const hostLabels = host.split(".");
    // Expect at least: tenant . wdN . myworkdayjobs . com
    if (hostLabels.length >= 4) {
      const tenant = hostLabels[0];
      const dcLabel = hostLabels[1]; // wd1, wd3, wd5, wd103, ...
      const workdayHost = `${dcLabel}.myworkdayjobs.com`;
      // Path commonly: /<locale>/<site>/job/<slug>/<jobId>  OR
      //                /<site>/job/<slug>/<jobId>
      const jobIdx = parts.indexOf("job");
      if (tenant && jobIdx >= 0 && parts.length > jobIdx + 1) {
        // The job id is the last path segment (Workday requisition id like R-12345).
        const jobId = parts[parts.length - 1] || parts[jobIdx + 1];
        // Site is whatever segment sits immediately before "job".
        const workdaySite = jobIdx > 0 ? parts[jobIdx - 1] : undefined;
        if (jobId) {
          return {
            provider: "workday",
            company: tenant,
            jobId,
            workdayHost,
            workdaySite,
          };
        }
      }
    }
  }

  // SmartRecruiters: careers.smartrecruiters.com/<Company>/<JobId>
  //             or:  jobs.smartrecruiters.com/<Company>/<JobId>
  if (
    host === "careers.smartrecruiters.com" ||
    host === "jobs.smartrecruiters.com"
  ) {
    const [company, jobId] = parts;
    if (company && jobId) {
      return { provider: "smartrecruiters", company, jobId };
    }
  }

  // Teamtailor: <subdomain>.teamtailor.com/jobs/<id>[-slug]
  if (host.endsWith(".teamtailor.com")) {
    const tenant = host.split(".")[0];
    const jobsIdx = parts.indexOf("jobs");
    if (tenant && jobsIdx >= 0 && parts.length > jobsIdx + 1) {
      // Teamtailor job URLs look like /jobs/123456-senior-engineer — the numeric
      // prefix is the actual job id for the public API.
      const segment = parts[jobsIdx + 1];
      const jobId = segment.split("-")[0] || segment;
      if (jobId) return { provider: "teamtailor", company: tenant, jobId };
    }
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
    case "workday":
      return fetchWorkday(ptr);
    case "smartrecruiters":
      return fetchSmartRecruiters(ptr);
    case "teamtailor":
      return fetchTeamtailor(ptr);
  }
}

// ———————————————————————————————————————————————
// Shared: standard-field stub used when an ATS doesn't expose a public
// application form definition. Order matches the common "standard fields"
// block every ATS asks for.
// ———————————————————————————————————————————————

function standardStubFields(): AtsField[] {
  return [
    { name: "first_name", label: "First name", type: "text", required: true },
    { name: "last_name", label: "Last name", type: "text", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone", type: "text", required: false },
    { name: "location", label: "Current location", type: "text", required: false },
    { name: "linkedin", label: "LinkedIn URL", type: "url", required: false },
    { name: "website", label: "Website / portfolio", type: "url", required: false },
    { name: "resume", label: "Resume / CV", type: "file", required: true },
    { name: "cover_letter", label: "Cover letter", type: "textarea", required: false },
    {
      name: "work_authorization",
      label: "Are you authorized to work in the posted location?",
      type: "select",
      required: false,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    },
    {
      name: "requires_sponsorship",
      label: "Will you now or in the future require visa sponsorship?",
      type: "select",
      required: false,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    },
  ];
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
    fields_source: "api",
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
    fields_source: "stub",
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
    fields_source: "api",
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

// ---- Workday -----------------------------------------------------------
// Workday has a per-tenant CXS JSON API:
//   https://<tenant>.<dc>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/job/<jobId>
// It returns a `jobPostingInfo` object (title, location, externalUrl, etc).
// The application form itself is driven by Workday's internal "task service"
// which is tenant-configured, gated behind a CSRF-protected session, and
// frequently varies per tenant / per-job. Rather than try to reverse that
// (which would be brittle and violate ToS), we read the safe public metadata
// and ship the standard-field stub so the UI has something to render.

type WorkdayPostingInfo = {
  title?: string;
  externalUrl?: string;
  jobDescription?: string;
  location?: string;
  locationsText?: string;
  startDate?: string;
};
type WorkdayJobResponse = {
  jobPostingInfo?: WorkdayPostingInfo;
};

async function fetchWorkday(ptr: AtsPointer): Promise<AtsJobSchema> {
  const site = ptr.workdaySite ?? "External";
  const host = ptr.workdayHost ?? "wd1.myworkdayjobs.com";
  const tenant = ptr.company;
  const apiUrl = `https://${tenant}.${host}/wday/cxs/${encodeURIComponent(
    tenant,
  )}/${encodeURIComponent(site)}/job/${encodeURIComponent(ptr.jobId)}`;
  const publicUrl = `https://${tenant}.${host}/en-US/${site}/job/${encodeURIComponent(
    ptr.jobId,
  )}`;

  let title = "Workday posting";
  let location: string | undefined;
  let applyUrl: string | undefined = publicUrl;
  let raw: unknown;

  try {
    const res = await fetch(apiUrl, {
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as WorkdayJobResponse;
      raw = data;
      const info = data.jobPostingInfo;
      if (info?.title) title = info.title;
      location = info?.locationsText ?? info?.location;
      if (info?.externalUrl) applyUrl = info.externalUrl;
    }
    // Non-OK: fall through with stub. Workday tenants often block cross-site
    // JSON reads — that's expected, not fatal for our use case.
  } catch {
    // Network error — still return a usable stub.
  }

  return {
    provider: "workday",
    sourceUrl: publicUrl,
    title,
    company: tenant,
    location,
    applyUrl,
    fields: standardStubFields(),
    isStub: true,
    stubLabel: "Workday tenant — standard fields",
    fields_source: "stub",
    raw,
  };
}

// ---- SmartRecruiters ---------------------------------------------------
// Public docs: https://developers.smartrecruiters.com/reference/postingsbyid
// Endpoint:    GET https://api.smartrecruiters.com/v1/companies/{company}/postings/{id}
// The response contains `name`, `location`, `applyUrl`, `jobAd`, but the
// application form definition is not exposed in the public posting API — it
// sits on an authenticated applicant flow. We use the metadata and stub the
// fields.

type SrPostingLocation = {
  city?: string;
  region?: string;
  country?: string;
  fullLocation?: string;
};
type SrPosting = {
  id?: string;
  name?: string;
  ref?: string;
  company?: { identifier?: string; name?: string };
  location?: SrPostingLocation;
  applyUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
};

async function fetchSmartRecruiters(ptr: AtsPointer): Promise<AtsJobSchema> {
  const apiUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(
    ptr.company,
  )}/postings/${encodeURIComponent(ptr.jobId)}`;
  const publicUrl = `https://careers.smartrecruiters.com/${encodeURIComponent(
    ptr.company,
  )}/${encodeURIComponent(ptr.jobId)}`;

  let title = "SmartRecruiters posting";
  let location: string | undefined;
  let applyUrl: string | undefined = publicUrl;
  let company = ptr.company;
  let raw: unknown;

  try {
    const res = await fetch(apiUrl, {
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as SrPosting;
      raw = data;
      if (data.name) title = data.name;
      if (data.company?.name) company = data.company.name;
      const loc = data.location;
      const composed =
        [loc?.city, loc?.region, loc?.country].filter(Boolean).join(", ") ||
        undefined;
      location = loc?.fullLocation ?? composed;
      if (data.applyUrl) applyUrl = data.applyUrl;
    }
  } catch {
    // Graceful: return stub with whatever metadata we have.
  }

  return {
    provider: "smartrecruiters",
    sourceUrl: publicUrl,
    title,
    company,
    location,
    applyUrl,
    fields: standardStubFields(),
    isStub: true,
    stubLabel: "SmartRecruiters — standard fields",
    fields_source: "stub",
    raw,
  };
}

// ---- Teamtailor -------------------------------------------------------
// Public jobs API:
//   GET https://api.teamtailor.com/v1/public/jobs/{id}
// Returns JSON:API shaped data — { data: { id, attributes: { title, body,
// pinned, ... } } }. It doesn't expose the application form definition, so
// we use the metadata and stub the fields.

type TeamtailorJobAttrs = {
  title?: string;
  body?: string;
  "apply-button-text"?: string;
  "careersite-job-url"?: string;
  "careersite-job-apply-url"?: string;
  "careersite-job-apply-iframe-url"?: string;
  pitch?: string;
};
type TeamtailorJob = {
  data?: {
    id?: string;
    attributes?: TeamtailorJobAttrs;
    links?: { "careersite-job-url"?: string; "careersite-job-apply-url"?: string };
  };
};

async function fetchTeamtailor(ptr: AtsPointer): Promise<AtsJobSchema> {
  const apiUrl = `https://api.teamtailor.com/v1/public/jobs/${encodeURIComponent(
    ptr.jobId,
  )}`;
  const publicUrl = `https://${ptr.company}.teamtailor.com/jobs/${encodeURIComponent(
    ptr.jobId,
  )}`;

  let title = "Teamtailor posting";
  let applyUrl: string | undefined = publicUrl;
  let sourceUrl = publicUrl;
  let raw: unknown;

  try {
    const res = await fetch(apiUrl, {
      headers: { accept: "application/vnd.api+json" },
    });
    if (res.ok) {
      const data = (await res.json()) as TeamtailorJob;
      raw = data;
      const attrs = data.data?.attributes;
      if (attrs?.title) title = attrs.title;
      const careerUrl =
        attrs?.["careersite-job-url"] ??
        data.data?.links?.["careersite-job-url"];
      const applyHref =
        attrs?.["careersite-job-apply-url"] ??
        data.data?.links?.["careersite-job-apply-url"];
      if (careerUrl) sourceUrl = careerUrl;
      if (applyHref) applyUrl = applyHref;
      else if (careerUrl) applyUrl = careerUrl;
    }
  } catch {
    // Graceful: return stub with whatever metadata we have.
  }

  return {
    provider: "teamtailor",
    sourceUrl,
    title,
    company: ptr.company,
    applyUrl,
    fields: standardStubFields(),
    isStub: true,
    stubLabel: "Teamtailor — standard fields",
    fields_source: "stub",
    raw,
  };
}
