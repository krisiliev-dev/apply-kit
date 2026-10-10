import { describe, expect, it } from "vitest";
import { isDevBg, parseDevBg } from "@/lib/discovery/sources/devbg";

const PAGE = "https://dev.bg/company/jobs/it-security/";

describe("dev.bg adapter", () => {
  it("detects dev.bg hosts", () => {
    expect(isDevBg("https://dev.bg/company/jobs/it-security/")).toBe(true);
    expect(isDevBg("https://en.dev.bg/x")).toBe(true);
    expect(isDevBg("https://www.jobs.bg/x")).toBe(false);
    expect(isDevBg("not a url")).toBe(false);
  });

  it("parses .job-list-item cards into postings, skipping non-jobs", () => {
    const html = `
      <div class="jobs-container">
        <div class="job-list-item is-premium">
          <div class="inner-left company-logo-wrap">
            <span class="company-name hide-for-small">A1 Bulgaria</span>
          </div>
          <div class="inner-right listing-content-wrap">
            <a href="https://dev.bg/company/jobads/a1-bulgaria-mfa-engineer/">
              <h6 class="job-title">Multi-Factor Authentication Engineer</h6>
            </a>
            <div class="tags-wrap"><span class="badge green bold remote">Remote</span></div>
          </div>
        </div>
        <div class="job-list-item">
          <div class="company-name">DSK Bank</div>
          <a href="https://dev.bg/company/jobads/dsk-bank-lead-product-security-engineer/">
            <div class="job-title">Lead Product Security Engineer</div>
          </a>
          <span class="badge hybrid">Sofia</span>
        </div>
        <div class="job-list-item"><a href="/about">no job link here</a></div>
      </div>`;

    const posts = parseDevBg(PAGE, html, 1000);
    expect(posts).toHaveLength(2);

    const mfa = posts.find((p) => p.title.includes("Multi-Factor"));
    expect(mfa?.company).toBe("A1 Bulgaria");
    expect(mfa?.url).toBe("https://dev.bg/company/jobads/a1-bulgaria-mfa-engineer/");
    expect(mfa?.location).toBe("Remote");
    expect(mfa?.source).toEqual({ kind: "careerpage", url: PAGE, site: "dev.bg" });

    const dsk = posts.find((p) => p.company === "DSK Bank");
    expect(dsk?.title).toBe("Lead Product Security Engineer");
    expect(dsk?.location).toBe("Sofia");
  });

  it("gives stable ids across runs", () => {
    const html = `<div class="job-list-item"><a href="https://dev.bg/company/jobads/x-sec-eng/"><div class="job-title">Security Engineer</div></a></div>`;
    const a = parseDevBg(PAGE, html, 1)[0];
    const b = parseDevBg(PAGE, html, 2)[0];
    expect(a.id).toBe(b.id);
  });
});
