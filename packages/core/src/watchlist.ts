// The Sofia starter watchlist (docs/design/watchlist-draft.md, verified 2026-10-11): 75 employers for
// computer-science work in Sofia or remote within Europe. 46 have a public job feed and become Sources
// in one step; the rest have no feed apply-kit may read, so each comes with the email-alert route that
// still catches its jobs. Public company data only: nothing personal lives here.

/** Where a company sits on the watchlist, as the draft groups them. */
export type WatchlistGroup = "international" | "local" | "startup" | "remote";

/** The profile angles a company hires for. */
export type WatchlistField = "dev" | "sec" | "design";

/**
 * How to still catch a company's jobs without a feed: a job alert, sent to the job address so it lands
 * in the job mailbox and is read by that sender's email-alert Source.
 * - linkedin: follow the company on LinkedIn and turn on its job alerts (Sofia, or remote);
 * - jobsbg: a jobs.bg alert for the company (local employers post there first).
 */
export type AlertRoute = "linkedin" | "jobsbg";

interface Base {
  company: string;
  group: WatchlistGroup;
  fields: WatchlistField[];
  /** What the draft noted when it was verified. */
  note: string;
}

export interface WatchlistFeedEntry extends Base {
  /** The Source to add, as addSource takes it (config in the adapter's object form). */
  feed: { kind: string; config: unknown };
}

export interface WatchlistAlertEntry extends Base {
  feed: null;
  /** The company's own careers page (to read by hand or capture). */
  careers: string;
  /** Why there's no feed, in plain words. */
  why: string;
  route: AlertRoute;
}

export type WatchlistEntry = WatchlistFeedEntry | WatchlistAlertEntry;

const gh = (board: string) => ({ kind: "greenhouse", config: { board } });
const lever = (site: string, company: string) => ({ kind: "lever", config: { site, company } });
const ashby = (board: string, company: string) => ({ kind: "ashby", config: { board, company } });
const recruitee = (host: string) => ({ kind: "recruitee", config: { host } });
const teamtailor = (host: string) => ({ kind: "teamtailor", config: { host } });
/** SmartRecruiters companies list thousands of jobs worldwide: only Bulgaria's are read. */
const sr = (company: string) => ({ kind: "smartrecruiters", config: { company, country: "bg" } });
/** Workday tenants are far too big to page through: only Bulgaria's jobs are read. */
const wd = (url: string, company: string) => ({ kind: "workday", config: { url, country: "Bulgaria", company } });

const feed = (company: string, group: WatchlistGroup, fields: WatchlistField[], f: WatchlistFeedEntry["feed"], note = ""): WatchlistFeedEntry =>
  ({ company, group, fields, feed: f, note });

const alert = (
  company: string, group: WatchlistGroup, fields: WatchlistField[], careers: string, why: string, note = "",
): WatchlistAlertEntry =>
  // Local employers post on jobs.bg first; everyone else is caught best by a LinkedIn company alert.
  ({ company, group, fields, feed: null, careers, why, route: group === "local" ? "jobsbg" : "linkedin", note });

const ownSite = "Runs its own careers site with no public job feed";

export const sofiaWatchlist: readonly WatchlistEntry[] = [
  // International companies with a Sofia office.
  alert("SAP Labs Bulgaria", "international", ["dev", "sec", "design"], "https://jobs.sap.com/go/Bulgaria/8806301",
    "Its SuccessFactors careers site is behind bot protection", "Biggest Sofia R&D employer."),
  feed("Broadcom", "international", ["dev", "sec"], wd("https://broadcom.wd1.myworkdayjobs.com/External_Career", "Broadcom"),
    "Ex-VMware. No Sofia postings on 2026-10-11; a low-volume watch."),
  alert("Uber", "international", ["dev", "sec"], "https://www.uber.com/careers/locations/sofia",
    "Its careers search is a private API", "Sofia engineering since 2014."),
  feed("Experian", "international", ["dev", "sec", "design"], sr("Experian"), "Strong Sofia hub."),
  feed("Bosch", "international", ["dev"], sr("BoschGroup")),
  feed("Playtech", "international", ["dev", "design"], sr("Playtech"), "Large Sofia gaming-tech centre."),
  feed("Ubisoft Sofia", "international", ["dev", "design"], sr("Ubisoft2"), "The SmartRecruiters id really is Ubisoft2."),
  feed("Gameloft Sofia", "international", ["dev", "design"], sr("Gameloft")),
  feed("DXC Technology", "international", ["dev", "sec"], wd("https://dxctechnology.wd1.myworkdayjobs.com/DXCJobs", "DXC Technology")),
  feed("Hewlett Packard Enterprise", "international", ["dev", "sec"], wd("https://hpe.wd5.myworkdayjobs.com/Jobsathpe", "Hewlett Packard Enterprise")),
  feed("Mastercard", "international", ["dev", "sec"], wd("https://mastercard.wd1.myworkdayjobs.com/CorporateCareers", "Mastercard")),
  feed("Visa", "international", ["dev", "sec"], wd("https://visa.wd5.myworkdayjobs.com/Visa", "Visa"), "Small Sofia footprint."),
  alert("Progress (Telerik)", "international", ["dev", "design"], "https://jobs.jobvite.com/progress",
    "Jobvite's job API needs a key"),
  alert("Paysafe", "international", ["dev", "sec"], "https://jobs.paysafe.com", ownSite),
  feed("Endava", "international", ["dev", "design"], sr("Endava"), "No Bulgarian postings on 2026-10-11; they surface now and then."),
  feed("Ocado Technology", "international", ["dev", "design"], gh("ocadogroup"), "Sofia development centre."),
  feed("Tide", "international", ["dev", "sec", "design"], gh("tide"), "Big Sofia hub."),
  feed("SumUp", "international", ["dev", "sec", "design"], gh("sumup"), "Sofia engineering hub."),
  feed("Workato", "international", ["dev"], gh("workato"), "Sofia engineering office."),
  feed("Insurify", "international", ["dev"], gh("insurify")),
  feed("Appfire", "international", ["dev"], gh("appfire")),
  feed("Coherent Solutions", "international", ["dev"], gh("coherentsolutions")),
  feed("Dext", "international", ["dev"], ashby("Dext-Careers", "Dext"), "Dev team mostly remote within Bulgaria."),
  feed("Avenga", "international", ["dev", "design"], teamtailor("avenga.teamtailor.com"), "Ex-Musala Soft."),
  feed("Nortal", "international", ["dev"], gh("nortal"), "Ex-Questers. No Bulgarian postings on 2026-10-11."),
  alert("UKG", "international", ["dev", "design"], "https://www.ukg.com/company/careers", ownSite, "Sofia and Varna innovation hub."),
  alert("Skyscanner", "international", ["dev", "design"], "https://www.skyscanner.net/jobs/sofia", ownSite),
  alert("HedgeServ", "international", ["dev"], "https://www.hedgeserv.com", ownSite, "Also posts on dev.bg."),
  alert("Creative Assembly Sofia", "international", ["dev", "design"], "https://www.creative-assembly.com/careers", ownSite),
  alert("Coca-Cola HBC", "international", ["dev", "sec"], "https://www.coca-colahellenic.com/en/careers",
    "Its SuccessFactors careers site has no readable feed", "Sofia IT hub."),
  alert("EPAM Bulgaria", "international", ["dev"], "https://www.epam.com/careers", ownSite),
  alert("Scalefocus", "international", ["dev"], "https://www.scalefocus.com/careers", ownSite),
  alert("IBM Bulgaria", "international", ["dev", "sec"], "https://www.ibm.com/careers", ownSite),
  alert("Accenture Bulgaria", "international", ["dev", "sec", "design"], "https://www.accenture.com/bg-en/careers", ownSite),
  alert("Proxiad", "international", ["dev"], "https://www.proxiad.com", ownSite, "Sofia presence not re-verified for 2026."),

  // Local Bulgarian companies.
  feed("Chaos", "local", ["dev", "design"], recruitee("chaos.recruitee.com"), "V-Ray maker; Sofia HQ."),
  feed("Payhawk", "local", ["dev", "sec", "design"], gh("payhawkio")),
  feed("Trading 212", "local", ["dev", "sec", "design"], ashby("trading212", "Trading 212")),
  feed("Crypto.com", "local", ["dev", "sec"], lever("crypto", "Crypto.com")),
  feed("myPOS", "local", ["dev", "sec"], teamtailor("mypos.teamtailor.com"), "Sofia fintech HQ."),
  feed("TBI Bank", "local", ["dev", "sec"], recruitee("tbibank.recruitee.com")),
  feed("SiteGround", "local", ["dev", "sec"], lever("siteground", "SiteGround"), "Sofia HQ."),
  feed("Delasport", "local", ["dev"], gh("delasportbulgaria"), "Sofia and Plovdiv."),
  feed("Accedia", "local", ["dev"], recruitee("accedia.recruitee.com")),
  feed("Strypes", "local", ["dev"], recruitee("strypes.recruitee.com"), "Low volume."),
  feed("SuperHosting.BG", "local", ["dev", "sec"], teamtailor("superhosting.teamtailor.com"), "Low volume."),
  feed("WorkBoard", "local", ["dev"], gh("workboard"), "Ex-Quantive (Gtmhub); Sofia engineering continues."),
  alert("Nexo", "local", ["dev", "sec", "design"], "https://nexo.com", ownSite, "Many Sofia roles appear on aggregators."),
  alert("Shelly Group", "local", ["dev", "design"], "https://shellygroup.careers.hibob.com/jobs", "HiBob's job API needs a key"),
  alert("EGT Digital", "local", ["dev", "sec"], "https://egt-digital.com/careers/", ownSite),
  alert("Yettel Bulgaria", "local", ["dev", "sec"], "https://jobs.ceetelcogroup.com/", "Its SuccessFactors careers site has no readable feed"),
  alert("A1 Bulgaria", "local", ["dev", "sec"], "https://jobs.a1.com/bg/", ownSite),
  alert("Vivacom", "local", ["dev", "sec"], "https://www.vivacom.bg/bg/kariera", ownSite),
  alert("DSK Bank", "local", ["dev", "sec"], "https://dskbank.bg", ownSite),
  alert("UBB", "local", ["dev", "sec"], "https://www.ubb.bg", "Its careers page refuses apps"),
  alert("Sirma Group", "local", ["dev", "sec"], "https://careers.sirma.com", ownSite),
  alert("Bianor", "local", ["dev"], "https://www.bianor.com", ownSite),
  alert("Infragistics", "local", ["dev", "design"], "https://www.infragistics.com/about-us/careers", ownSite, "Sofia R&D."),
  alert("Dreamix", "local", ["dev"], "https://apply.workable.com/dreamix/", "Its Workable board lists no jobs, so it looks unused"),
  alert("Imagga", "local", ["dev"], "https://apply.workable.com/imagga/", "Its Workable board lists no jobs, so it looks unused"),

  // Startups.
  feed("Dronamics", "startup", ["dev"], recruitee("careers.dronamics.com"), "Mostly aerospace and systems roles."),
  feed("AMPECO", "startup", ["dev", "design"], lever("ampeco-global", "AMPECO"), "EV-charging SaaS scale-up."),
  alert("EnduroSat", "startup", ["dev"], "https://www.endurosat.com/careers/", ownSite),
  feed("Hyperscience", "startup", ["dev"], ashby("hyperscience", "Hyperscience"), "Sofia office; quiet on 2026-10-11."),
  alert("Enhancv", "startup", ["dev", "design"], "https://enhancv.com/careers/", ownSite, "No open positions on 2026-10-11."),

  // Remote-first companies hiring in Bulgaria or across Europe.
  feed("Canonical", "remote", ["dev", "sec"], gh("canonical")),
  feed("GitLab", "remote", ["dev", "sec", "design"], gh("gitlab")),
  feed("Grafana Labs", "remote", ["dev", "sec"], gh("grafanalabs")),
  feed("Elastic", "remote", ["dev", "sec"], gh("elastic"), "Check country eligibility per posting."),
  feed("Kraken", "remote", ["dev", "sec"], ashby("kraken.com", "Kraken")),
  feed("Smartsheet", "remote", ["dev"], gh("smartsheet"), "Hires in Bulgaria through an employer of record."),
  feed("ClickHouse", "remote", ["dev"], ashby("clickhouse", "ClickHouse")),
  feed("1Password", "remote", ["dev", "sec"], ashby("1password", "1Password")),
  feed("n8n", "remote", ["dev", "design"], ashby("n8n", "n8n")),
  feed("Toptal", "remote", ["dev", "design"], lever("toptal", "Toptal")),
];
