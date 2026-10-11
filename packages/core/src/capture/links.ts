// Pasted job links: reading what was pasted, comparing links, and which sites must never be read
// by the app (they forbid it or sit behind bot protection: Kris captures those himself).

/** A pasted link (with or without https://), or null if the text isn't a web link. */
export function jobLinkFrom(text: string): URL | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") || u.username || u.password) return null;
    u.hash = "";
    return canonical(u);
  } catch {
    return null;
  }
}

/** Query parameters that only track where a click came from: never part of a job's identity. */
const tracking = /^(utm_\w+|trk|trkinfo|trackingid|refid|ref|src|source|gh_src|lever-source|lever-origin|fbclid|gclid|msclkid|mc_[a-z]+|_hs\w+|ccuid|mcid|from)$/i;

/** The link with tracking parameters and fragment dropped; LinkedIn search links point at the job's own page. */
function canonical(u: URL): URL {
  const host = u.hostname.toLowerCase();
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const id = /\/jobs\/view\/(?:[^/]*?-)?(\d+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("currentJobId");
    if (id && /^\d+$/.test(id)) return new URL(`https://www.linkedin.com/jobs/view/${id}/`);
  }
  for (const name of [...u.searchParams.keys()]) if (tracking.test(name)) u.searchParams.delete(name);
  return u;
}

/**
 * What two links to the same job share: host without "www.", path without a trailing slash, and
 * the query parameters that matter (sorted). Scheme, fragment and tracking parameters are ignored.
 */
export function linkKey(link: string): string {
  let u: URL;
  try {
    u = canonical(new URL(link));
  } catch {
    return link.trim().toLowerCase();
  }
  u.searchParams.sort();
  const query = u.searchParams.toString();
  return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
}

/** A site the app never reads, with what Kris can do instead. */
export interface ProtectedSite {
  name: string;
  /** The alert email Source that covers it, when there is one. */
  alertSender: string | null;
}

const protectedSites: { host: RegExp; path?: RegExp; site: ProtectedSite }[] = [
  { host: /(^|\.)linkedin\.com$/, site: { name: "LinkedIn", alertSender: "linkedin" } },
  { host: /(^|\.)jobs\.bg$/, site: { name: "jobs.bg", alertSender: "jobsbg" } },
  { host: /(^|\.)google\.com$/, path: /^\/about\/careers\//, site: { name: "Google Careers", alertSender: "google" } },
  { host: /(^|\.)jobs\.apple\.com$/, site: { name: "Apple Jobs", alertSender: null } },
  { host: /(^|\.)metacareers\.com$/, site: { name: "Meta Careers", alertSender: null } },
  { host: /(^|\.)indeed\.[a-z.]+$/, site: { name: "Indeed", alertSender: null } },
  { host: /(^|\.)glassdoor\.[a-z.]+$/, site: { name: "Glassdoor", alertSender: null } },
];

/**
 * The site, if the link is on one that forbids apps reading it or blocks them (LinkedIn, jobs.bg,
 * Google, Apple and Meta careers, Indeed, Glassdoor). Those are never fetched: Kris pastes the text,
 * captures the page with the extension, or relies on the site's alert emails.
 */
export function protectedSite(link: URL): ProtectedSite | null {
  const host = link.hostname.toLowerCase();
  for (const p of protectedSites) {
    if (p.host.test(host) && (!p.path || p.path.test(link.pathname))) return p.site;
  }
  return null;
}

/**
 * Whether robots.txt lets `agent` read `path`: the group naming the agent (else `*`), longest
 * matching rule wins, Allow winning a tie. `*` and `$` in rules are understood. No rule means allowed.
 */
export function robotsAllows(robots: string, path: string, agent: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (field === "allow" || field === "disallow")) current.rules.push({ allow: field === "allow", pattern: value });
    }
  }
  const name = agent.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && name.startsWith(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: { allow: boolean; length: number } | null = null;
  for (const r of rules) {
    if (!r.pattern) continue; // "Disallow:" with nothing allows everything
    if (!ruleMatches(r.pattern, path)) continue;
    const length = r.pattern.length;
    if (!best || length > best.length || (length === best.length && r.allow)) best = { allow: r.allow, length };
  }
  return best?.allow ?? true;
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}
