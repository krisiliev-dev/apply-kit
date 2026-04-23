import type { CapturedJob, JobSource } from "../shared/types";
import { sendToBackground } from "../shared/message";

// Job-posting capture for LinkedIn, Indeed, and Glassdoor.
//
// Strict rules:
//   - The extension reads ONLY the DOM of pages the user is already viewing.
//   - No background fetches to these sites.
//   - No iframe hits, no link crawling, no pagination.
//   - Clicking the pill is the ONLY way to persist anything — no auto-capture.

type JobFields = Omit<CapturedJob, "id" | "capturedAt" | "syncedToWebApp">;

interface SiteAdapter {
  source: JobSource;
  /** Return true if the current URL is a job-detail page we can extract. */
  isJobPage: () => boolean;
  /** Extract the posting from the live DOM. Return null if not enough data yet. */
  extract: () => JobFields | null;
}

// --- utilities ---

function cleanText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim();
}

function textFromSelectors(selectors: string[], root: ParentNode = document): string {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) {
      const t = cleanText(el.textContent);
      if (t) return t;
    }
  }
  return "";
}

function longTextFromSelectors(
  selectors: string[],
  root: ParentNode = document,
): string {
  for (const sel of selectors) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) {
      // Preserve rough paragraph structure for downstream parsing.
      const t = (el.innerText ?? el.textContent ?? "").trim();
      if (t.length > 80) return t;
    }
  }
  return "";
}

function canonicalUrl(): string {
  const canon = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canon?.href) return canon.href;
  return location.href;
}

// --- LinkedIn ---

const linkedIn: SiteAdapter = {
  source: "linkedin",
  isJobPage: () =>
    /(^|\.)linkedin\.com$/i.test(location.hostname) &&
    /\/jobs\/view\//.test(location.pathname),
  extract: () => {
    // LinkedIn serves two variants: signed-in SPA and public posting. Selectors below
    // cover both. We prefer the semantic markup first, then fall back to testids.
    const title = textFromSelectors([
      "h1.top-card-layout__title",
      ".job-details-jobs-unified-top-card__job-title h1",
      ".jobs-unified-top-card__job-title",
      "h1.jobs-unified-top-card__job-title",
      "h1",
    ]);
    const company = textFromSelectors([
      ".topcard__org-name-link",
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name",
    ]);
    const jobLocation = textFromSelectors([
      ".topcard__flavor--bullet",
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__bullet",
    ]);
    const salary = textFromSelectors([
      ".salary",
      ".compensation__salary",
      "[data-test-job-salary]",
    ]);
    const description = longTextFromSelectors([
      ".description__text",
      ".jobs-description__content",
      "#job-details",
      ".jobs-description-content__text",
    ]);
    const postedAt = textFromSelectors([
      ".posted-time-ago__text",
      ".jobs-unified-top-card__posted-date",
      "time",
    ]);

    if (!title || !company) return null;
    return {
      source: "linkedin",
      url: canonicalUrl(),
      title,
      company,
      location: jobLocation || undefined,
      salary: salary || undefined,
      description: description || undefined,
      postedAt: postedAt || undefined,
    };
  },
};

// --- Indeed ---

const indeed: SiteAdapter = {
  source: "indeed",
  isJobPage: () => {
    if (!/(^|\.)indeed\.[a-z.]+$/i.test(location.hostname)) return false;
    if (location.pathname.includes("/viewjob")) return true;
    if (location.pathname === "/jobs" && location.search.length > 0) {
      // List pages with a selected posting show the detail pane in the DOM.
      return document.querySelector(".jobsearch-JobInfoHeader-title") !== null;
    }
    return false;
  },
  extract: () => {
    const title = textFromSelectors([
      "h1.jobsearch-JobInfoHeader-title",
      'h2[data-testid="jobsearch-JobInfoHeader-title"]',
      "h1.jobsearch-JobInfoHeader-title span",
      'h1[data-testid="simpler-jobTitle"]',
    ]);
    const company = textFromSelectors([
      '[data-testid="inlineHeader-companyName"] a',
      '[data-testid="inlineHeader-companyName"]',
      '[data-company-name="true"]',
      ".jobsearch-CompanyInfoContainer a",
      ".jobsearch-InlineCompanyRating-companyHeader",
    ]);
    const jobLocation = textFromSelectors([
      '[data-testid="inlineHeader-companyLocation"]',
      '[data-testid="job-location"]',
      ".jobsearch-JobInfoHeader-subtitle > div:nth-child(2)",
    ]);
    const salary = textFromSelectors([
      '[data-testid="attribute_snippet_testid"]',
      "#salaryInfoAndJobType",
      ".jobsearch-JobMetadataHeader-item",
    ]);
    const description = longTextFromSelectors([
      "#jobDescriptionText",
      ".jobsearch-jobDescriptionText",
      '[data-testid="jobsearch-JobComponent-description"]',
    ]);
    const postedAt = textFromSelectors([
      ".jobsearch-JobMetadataFooter > div",
      '[data-testid="myJobsStateDate"]',
    ]);

    if (!title || !company) return null;

    // Prefer the job's canonical jk-based URL when we can see one, so the
    // queue doesn't fill with ?from=serp noise.
    let url = canonicalUrl();
    const jk = new URLSearchParams(window.location.search).get("jk");
    if (jk && !/[?&]jk=/.test(url)) {
      url = `${window.location.origin}/viewjob?jk=${encodeURIComponent(jk)}`;
    }

    return {
      source: "indeed",
      url,
      title,
      company,
      location: jobLocation || undefined,
      salary: salary || undefined,
      description: description || undefined,
      postedAt: postedAt || undefined,
    };
  },
};

// --- Glassdoor ---

const glassdoor: SiteAdapter = {
  source: "glassdoor",
  isJobPage: () => {
    if (!/(^|\.)glassdoor\.[a-z.]+$/i.test(location.hostname)) return false;
    return (
      /\/job-listing\//i.test(location.pathname) ||
      /\/Jobs\//.test(location.pathname)
    );
  },
  extract: () => {
    const title = textFromSelectors([
      '[data-test="job-title"]',
      "h1.heading_Heading__BqX5J",
      ".JobDetails_jobTitle__Rw_gn",
      "h1",
    ]);
    const company = textFromSelectors([
      '[data-test="employer-name"]',
      ".EmployerProfile_employerName__7fz8z",
      ".EmployerProfile_profileContainer__d5rMb h4",
    ]);
    const jobLocation = textFromSelectors([
      '[data-test="location"]',
      ".JobDetails_location__mSg5h",
    ]);
    const salary = textFromSelectors([
      '[data-test="detailSalary"]',
      ".SalaryEstimate_salaryRange__brHFy",
      ".SalaryEstimate_averageEstimate__xF_7h",
    ]);
    const description = longTextFromSelectors([
      '[data-test="jobDescriptionContainer"]',
      ".JobDetails_jobDescription__uW_fK",
      ".JobDetails_jobDescriptionWrapper__BTDTA",
      ".jobDescriptionContent",
    ]);
    const postedAt = textFromSelectors([
      '[data-test="job-age"]',
      ".JobDetails_jobPostedDate__x6r3_",
    ]);

    if (!title || !company) return null;
    return {
      source: "glassdoor",
      url: canonicalUrl(),
      title,
      company,
      location: jobLocation || undefined,
      salary: salary || undefined,
      description: description || undefined,
      postedAt: postedAt || undefined,
    };
  },
};

const ADAPTERS: SiteAdapter[] = [linkedIn, indeed, glassdoor];

function currentAdapter(): SiteAdapter | null {
  for (const a of ADAPTERS) {
    if (a.isJobPage()) return a;
  }
  return null;
}

// --- Pill UI (shadow-DOM, matches the suggest.ts aesthetic) ---

type PillState = "idle" | "saving" | "saved" | "offline" | "error";

const HOST_ID = "cvaf-jobcap-host";
let hostEl: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let extractedCache: JobFields | null = null;

function ensureHost(): { host: HTMLDivElement; root: ShadowRoot } {
  if (hostEl && shadow) return { host: hostEl, root: shadow };
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = [
    "position:fixed",
    "bottom:16px",
    "right:16px",
    "z-index:2147483646",
    "pointer-events:none",
  ].join(";");
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .pill {
        pointer-events: auto;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: #fafaf7;
        color: #111;
        border: 1px solid #111;
        border-radius: 999px;
        box-shadow: 0 8px 24px rgba(0,0,0,.14);
        padding: 8px 12px 8px 10px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        user-select: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity .16s ease, transform .16s ease;
        max-width: 320px;
      }
      .pill.open { opacity: 1; transform: translateY(0); }
      .pill:hover { background: #111; color: #fafaf7; }
      .pill:hover .mark { background: #fafaf7; color: #d64933; }
      .pill[data-state="saving"] { cursor: progress; }
      .pill[data-state="saved"] { border-color: #2e7d32; color: #2e7d32; }
      .pill[data-state="saved"]:hover { background: #2e7d32; color: #fafaf7; }
      .pill[data-state="offline"] { border-color: #a06a00; color: #a06a00; }
      .pill[data-state="offline"]:hover { background: #a06a00; color: #fafaf7; }
      .pill[data-state="error"] { border-color: #d64933; color: #d64933; }
      .pill[data-state="error"]:hover { background: #d64933; color: #fafaf7; }
      .mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        background: #d64933;
        color: #fafaf7;
        font-family: ui-serif, Georgia, "Times New Roman", serif;
        font-size: 12px;
        font-weight: 600;
        font-style: italic;
      }
      .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .close {
        pointer-events: auto;
        background: transparent;
        border: none;
        color: inherit;
        opacity: .6;
        cursor: pointer;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        padding: 0 2px;
      }
      .close:hover { opacity: 1; }
    </style>
    <div class="pill" role="button" tabindex="0" data-state="idle">
      <span class="mark">cv</span>
      <span class="text" data-text>Save to discovery queue</span>
      <button class="close" data-act="dismiss" title="Dismiss">X</button>
    </div>
  `;
  hostEl = host;
  shadow = root;
  return { host, root };
}

function setPillState(state: PillState, label: string): void {
  const { root } = ensureHost();
  const pill = root.querySelector<HTMLDivElement>(".pill");
  const text = root.querySelector<HTMLElement>("[data-text]");
  if (!pill || !text) return;
  pill.setAttribute("data-state", state);
  text.textContent = label;
}

function openPill(): void {
  const { root } = ensureHost();
  const pill = root.querySelector<HTMLDivElement>(".pill");
  pill?.classList.add("open");
}

function hidePill(): void {
  const { root } = ensureHost();
  const pill = root.querySelector<HTMLDivElement>(".pill");
  pill?.classList.remove("open");
}

let dismissed = false;
let dismissedForUrl = "";
let wired = false;

function wirePillEvents(): void {
  if (wired) return;
  const { root } = ensureHost();
  const pill = root.querySelector<HTMLDivElement>(".pill");
  if (!pill) return;

  const onActivate = async (ev: Event): Promise<void> => {
    const target = ev.target as HTMLElement;
    if (target?.getAttribute?.("data-act") === "dismiss") {
      ev.stopPropagation();
      dismissed = true;
      dismissedForUrl = location.href;
      hidePill();
      return;
    }
    if (pill.getAttribute("data-state") === "saving") return;
    if (!extractedCache) return;
    setPillState("saving", "Saving…");
    const resp = await sendToBackground({
      kind: "captureJob",
      job: extractedCache,
    });
    if (resp.kind === "error") {
      setPillState("error", "Save failed");
      return;
    }
    if (resp.synced) {
      setPillState("saved", "Saved and synced");
    } else {
      setPillState("offline", "Saved (sync pending)");
    }
    // Auto-hide after a short beat so it doesn't loiter forever.
    window.setTimeout(() => hidePill(), 2500);
  };

  pill.addEventListener("click", (ev) => void onActivate(ev));
  pill.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      void onActivate(ev);
    }
  });
  wired = true;
}

function update(): void {
  const adapter = currentAdapter();
  if (!adapter) {
    hidePill();
    extractedCache = null;
    return;
  }
  // Honor the user's dismissal until they navigate to a different posting.
  if (dismissed && dismissedForUrl === location.href) return;
  if (location.href !== dismissedForUrl) {
    dismissed = false;
    dismissedForUrl = "";
  }

  const fields = adapter.extract();
  if (!fields) {
    // DOM not ready yet — keep polling via the mutation observer.
    return;
  }
  extractedCache = fields;
  ensureHost();
  wirePillEvents();
  const currentState = shadow
    ?.querySelector(".pill")
    ?.getAttribute("data-state");
  if (currentState !== "saving" && currentState !== "saved") {
    setPillState("idle", "Save to discovery queue");
  }
  openPill();
}

function boot(): void {
  update();

  const mo = new MutationObserver(() => {
    queueMicrotask(update);
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // SPA navigations on LinkedIn/Indeed/Glassdoor swap content without a full
  // document reload. Patch history methods once so we notice route changes.
  const emit = (): void => {
    dismissed = false;
    dismissedForUrl = "";
    update();
  };
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    const r = origPush(...args);
    emit();
    return r;
  };
  history.replaceState = function (
    ...args: Parameters<typeof history.replaceState>
  ) {
    const r = origReplace(...args);
    emit();
    return r;
  };
  window.addEventListener("popstate", emit);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
