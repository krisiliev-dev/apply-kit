// A portal's own reference to a job, from a posting's link (the URL patterns in
// docs/research/implementation/portals.md). Pure. Apply matches the page Kris is on to her approved
// package by it; null for a link that isn't one of the six portals' job pages.
import type { PortalJobReference } from "./contracts.ts";

const patterns: [PortalJobReference["portal"], RegExp, (m: RegExpExecArray, url: URL) => { board: string; jobId: string } | null][] = [
  ["greenhouse", /greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9_-]+)\/jobs\/(\d+)/i, (m) => ({ board: m[1]!.toLowerCase(), jobId: m[2]! })],
  ["greenhouse", /greenhouse\.io\/([a-z0-9_-]+)/i, (m, url) => {
    const id = url.searchParams.get("gh_jid") ?? url.searchParams.get("token");
    return id && /^\d+$/.test(id) ? { board: m[1]!.toLowerCase(), jobId: id } : null;
  }],
  ["lever", /jobs\.(?:eu\.)?lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i, (m) => ({ board: m[1]!.toLowerCase(), jobId: m[2]!.toLowerCase() })],
  ["ashby", /jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i, (m) => ({ board: decodeURIComponent(m[1]!), jobId: m[2]!.toLowerCase() })],
  ["workday", /([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/)?[^/]+\/job\/(?:[^?#]*\/)?[^/?#]*_([A-Za-z0-9-]+)(?:[/?#]|$)/i, (m) => ({ board: m[1]!.toLowerCase(), jobId: m[2]! })],
  ["smartrecruiters", /jobs\.smartrecruiters\.com\/([^/?#]+)\/(\d+)/i, (m) => ({ board: m[1]!, jobId: m[2]! })],
  ["workable", /apply\.workable\.com\/([^/?#]+)\/j\/([0-9a-z]+)/i, (m) => ({ board: m[1]!.toLowerCase(), jobId: m[2]!.toUpperCase() })],
];

export function portalJobReference(link: string): PortalJobReference | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  for (const [portal, re, read] of patterns) {
    const m = re.exec(link);
    const ref = m && read(m, url);
    if (ref) return { portal, ...ref };
  }
  return null;
}
