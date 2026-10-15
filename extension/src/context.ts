// What the Fill view says about the tab before anything is filled: which view the panel opens on,
// which state the Fill view is in, and the context card (portal, company, job). Pure, like report.ts.
import { portals, type PortalPage } from "./portal.ts";

export type PanelView = "fill" | "capture";

/** Fill on a portal apply-kit knows, Capture everywhere else. */
export function openingView(page: PortalPage): PanelView {
  return page.portal === "unknown" ? "capture" : "fill";
}

/** Whether Kris has been asked for the six portals: not yet, allowed, or "Not now". */
export type PortalsAccess = "not-asked" | "granted" | "not-now";

export type FillState =
  /** First use on a portal: the one-time "Allow the 6 portals" step. */
  | "allow-portals"
  /** A recognised portal, with its context card. */
  | "portal"
  /** A site that isn't one of the six. */
  | "not-portal"
  /** Chrome doesn't show the panel this tab's address (no click on the icon or command on it yet). */
  | "no-access"
  /** Chrome's own pages and the Web Store, which no extension may read. */
  | "chrome-page";

export function fillStateFor({ address, page, portals: access }: { address: string | undefined; page: PortalPage; portals: PortalsAccess }): FillState {
  if (!address) return "no-access";
  if (/^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(address) || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\b/i.test(address)) return "chrome-page";
  if (page.portal === "unknown") return "not-portal";
  return access === "not-asked" ? "allow-portals" : "portal";
}

export interface ContextCard {
  /** "Workday · kestrelpayments": the portal and whose it is. */
  where: string;
  /** The job, as the tab's title names it; the panel's h1. */
  job: string;
  /** Why the panel thinks so, in one line. */
  why: string;
}

const untouched = "Nothing on the page has been read or filled.";

export function contextCard(page: PortalPage, tab: { address: string; title: string | undefined }): ContextCard {
  const title = (tab.title ?? "").trim();
  const host = hostOf(tab.address);
  if (page.portal === "unknown") {
    return { where: `Not a portal apply-kit knows · ${host}`, job: title || host, why: "apply-kit fills nothing here by default. You can still capture the job." };
  }
  const label = portals.find((p) => p.name === page.portal)!.label;
  const fromTitle = page.portal === "greenhouse" ? /^Job Application for (.+) at (.+)$/.exec(title) : null;
  const company = fromTitle?.[2] ?? page.ref?.board ?? host;
  if (!page.ref) return { where: label, job: "No job on this page yet", why: "Open the job's application form, then come back to this panel." };
  const embedded = page.ref.board === null && page.portal === "greenhouse" ? ` (a ${label} form inside the company's page)` : "";
  return { where: `${label} · ${company}`, job: fromTitle?.[1] ?? (title || `This job on ${label}`), why: `Job ${page.ref.jobId}, from the page address${embedded}. ${untouched}` };
}

function hostOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return "this page";
  }
}
