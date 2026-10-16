// Which portal a page address belongs to, and which job on it (docs/research/implementation/portals.md).
// Pure: it reads only the address (a tab's URL, or an embedded form's frame src), never the page.

export type PortalName = "workday" | "greenhouse" | "lever" | "smartrecruiters" | "workable" | "ashby";

/** The job as the portal names it: the portal, its board or tenant (when the address shows it) and its job id. */
export interface PortalJobRef {
  portal: PortalName;
  board: string | null;
  jobId: string;
}

export interface PortalPage {
  portal: PortalName | "unknown";
  /** Null on a portal page that isn't one job (a job list, the candidate home) and on unknown sites. */
  ref: PortalJobRef | null;
}

const unknown: PortalPage = { portal: "unknown", ref: null };

export function recognisePortal(address: string | undefined): PortalPage {
  let url: URL;
  try {
    url = new URL(address ?? "");
  } catch {
    return unknown;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return unknown;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // {tenant}.wdN.myworkdayjobs.com/[locale/]{site}/job/[{location}/]{title}_{REQ-ID}[/apply/...]
  // {tenant}.wdN.myworkdaysite.com/[locale/]recruiting/{tenant}/{site}/job/...
  const workday = /^(?:([a-z0-9-]+)\.)?wd\d+\.myworkday(?:jobs|site)\.com$/.exec(host);
  if (workday) {
    const tenant = /\/recruiting\/([^/]+)\//.exec(path)?.[1]?.toLowerCase() ?? workday[1] ?? null;
    // The id is on the last segment before /apply (a location can contain "_" too).
    const job = /\/job\/(?:[^/]+\/)*[^/]*_([A-Za-z0-9-]+)(?:\/apply(?:\/[^/]*)?)?\/?$/.exec(path);
    return { portal: "workday", ref: job ? { portal: "workday", board: tenant, jobId: job[1]! } : null };
  }

  // boards.greenhouse.io/{board}/jobs/{id}, job-boards[.eu].greenhouse.io/{board}/jobs/{id}, and the
  // embedded form's frame: boards.greenhouse.io/embed/job_app?for={board}&token={id}
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const embed = /^\/embed\/job_app\/?$/.test(path) && /^\d+$/.test(url.searchParams.get("token") ?? "");
    if (embed) return { portal: "greenhouse", ref: { portal: "greenhouse", board: url.searchParams.get("for") || null, jobId: url.searchParams.get("token")! } };
    const job = /^\/([^/]+)\/jobs\/(\d+)(?:\/|$)/.exec(path);
    return { portal: "greenhouse", ref: job ? { portal: "greenhouse", board: job[1]!, jobId: job[2]! } : null };
  }
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

  // jobs[.eu].lever.co/{company}/{posting uuid}[/apply|/thanks]
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const job = new RegExp(`^/([^/]+)/(${uuid})(?:/|$)`, "i").exec(path);
    return { portal: "lever", ref: job ? { portal: "lever", board: job[1]!, jobId: job[2]!.toLowerCase() } : null };
  }

  // jobs.smartrecruiters.com/{Company}/{numeric id}-{slug}, and the OneClick application at
  // jobs.smartrecruiters.com/oneclick-ui/company/{Company}/publication/{publication uuid}
  if (host === "jobs.smartrecruiters.com") {
    const oneClick = new RegExp(`^/oneclick-ui/company/([^/]+)/publication/(${uuid})(?:/|$)`, "i").exec(path);
    if (oneClick) return { portal: "smartrecruiters", ref: { portal: "smartrecruiters", board: oneClick[1]!, jobId: oneClick[2]!.toLowerCase() } };
    const job = /^\/([^/]+)\/(\d+)(?:-[^/]*)?(?:\/|$)/.exec(path);
    return { portal: "smartrecruiters", ref: job ? { portal: "smartrecruiters", board: job[1]!, jobId: job[2]! } : null };
  }

  // apply.workable.com/{account}/j/{shortcode}/[apply/]
  if (host === "apply.workable.com") {
    const job = /^\/([^/]+)\/j\/([A-Za-z0-9]+)(?:\/|$)/.exec(path);
    return { portal: "workable", ref: job ? { portal: "workable", board: job[1]!, jobId: job[2]! } : null };
  }

  // jobs.ashbyhq.com/{company}/{job uuid}[/application]; jobs.ashbyhq.com/{company}/embed is a board,
  // showing one job's application when it carries ?ashby_jid={job uuid}.
  const ashbyJid = url.searchParams.get("ashby_jid") ?? "";
  const ashbyJob = new RegExp(`^${uuid}$`, "i").test(ashbyJid) ? ashbyJid.toLowerCase() : null;
  if (host === "jobs.ashbyhq.com") {
    const embed = /^\/([^/]+)\/embed\/?$/.exec(path);
    if (embed && ashbyJob) return { portal: "ashby", ref: { portal: "ashby", board: embed[1]!, jobId: ashbyJob } };
    const job = new RegExp(`^/([^/]+)/(${uuid})(?:/|$)`, "i").exec(path);
    return { portal: "ashby", ref: job ? { portal: "ashby", board: job[1]!, jobId: job[2]!.toLowerCase() } : null };
  }

  // A company's own careers page with a Greenhouse job on it carries ?gh_jid={id}.
  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid && /^\d+$/.test(ghJid)) return { portal: "greenhouse", ref: { portal: "greenhouse", board: null, jobId: ghJid } };

  // A company's own careers page showing Ashby's embedded board on one job carries ?ashby_jid={job uuid}.
  if (ashbyJob) return { portal: "ashby", ref: { portal: "ashby", board: null, jobId: ashbyJob } };

  return unknown;
}

/** A portal's job form embedded in a company page: the frame's address and the job it's for. */
export interface EmbeddedForm {
  src: string;
  portal: PortalName;
  ref: PortalJobRef;
}

/** The first of a page's frames (their `src`, in the page's order) that is a portal's form for one job, or null. */
export function embeddedForm(frameSources: string[]): EmbeddedForm | null {
  for (const src of frameSources) {
    const page = recognisePortal(src);
    if (page.portal !== "unknown" && page.ref) return { src, portal: page.portal, ref: page.ref };
  }
  return null;
}

/** The six portals in words, with the hosts Kris is asked to allow for them (optional host permissions). */
export const portals: { name: PortalName; label: string; hosts: string[] }[] = [
  { name: "workday", label: "Workday", hosts: ["myworkdayjobs.com", "myworkdaysite.com"] },
  { name: "greenhouse", label: "Greenhouse", hosts: ["greenhouse.io"] },
  { name: "lever", label: "Lever", hosts: ["lever.co"] },
  { name: "smartrecruiters", label: "SmartRecruiters", hosts: ["smartrecruiters.com"] },
  { name: "workable", label: "Workable", hosts: ["workable.com"] },
  { name: "ashby", label: "Ashby", hosts: ["ashbyhq.com"] },
];

/** The match patterns for "Allow the 6 portals": the manifest's optional_host_permissions, exactly. */
export const portalOrigins: string[] = portals.flatMap((p) => p.hosts.map((h) => `https://*.${h}/*`));
