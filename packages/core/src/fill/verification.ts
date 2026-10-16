export interface VerificationSession { portal: string; host: string; tenant: string | null; startedAt: string }
export interface VerificationMail { from: string; receivedAt: string; text: string; html: string }
const senderDomains: Record<string, string[]> = { workday: ["myworkday.com", "myworkdayjobs.com", "myworkdaysite.com"], greenhouse: ["greenhouse.io"], lever: ["lever.co"], ashby: ["ashbyhq.com"], workable: ["workable.com"], smartrecruiters: ["smartrecruiters.com"] };
const under = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Finds a link to offer; never fetches it or follows an email's instructions. */
export function findVerificationLink(session: VerificationSession, messages: VerificationMail[], now: Date): string | null {
  const domains = senderDomains[session.portal] ?? [];
  for (const m of [...messages].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))) {
    const at = Date.parse(m.receivedAt);
    if (!Number.isFinite(at) || at < Date.parse(session.startedAt) || at > now.getTime()) continue;
    const sender = /@([a-z0-9.-]+)(?:>|\s|$)/i.exec(m.from)?.[1]?.toLowerCase();
    if (!sender || !domains.some((d) => under(sender, d))) continue;
    for (const raw of `${m.text}\n${m.html}`.match(/https:\/\/[^\s<>"']+/gi) ?? []) {
      let url: URL;
      try { url = new URL(raw.replace(/&amp;/g, "&").replace(/[).,;]+$/, "")); } catch { continue; }
      if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !/verif|activat|confirm/i.test(url.pathname + url.search)) continue;
      const sameHost = url.hostname.toLowerCase() === session.host.toLowerCase();
      const tenant = /\/recruiting\/([^/]+)\//.exec(url.pathname)?.[1]?.toLowerCase() ?? /^([a-z0-9-]+)\.wd\d+\./.exec(url.hostname)?.[1] ?? null;
      if (!sameHost && !(session.portal === "workday" && session.tenant && tenant === session.tenant.toLowerCase() && ["myworkdayjobs.com", "myworkdaysite.com"].some((d) => under(url.hostname, d)))) continue;
      if (session.portal === "workday" && tenant && session.tenant && tenant !== session.tenant.toLowerCase()) continue;
      return url.href;
    }
  }
  return null;
}
