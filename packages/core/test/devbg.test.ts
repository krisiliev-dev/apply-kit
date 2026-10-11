import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch, loadFixture } from "./harness.ts";
import { routedFetch } from "./http.ts";

const itSecurity = "https://dev.bg/company/jobs/it-security/";

describe("dev.bg source", () => {
  it("lists a dev.bg category's jobs from its server-rendered page", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [itSecurity]: "devbg-it-security.html" }) });
    const source = await engine.addSource({ kind: "devbg", config: "it-security" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(source).toEqual({ id: "devbg:it-security", kind: "devbg", name: "dev.bg · it-security" });
    expect(check.sources[0]).toMatchObject({ ok: true, found: 3, newPostings: 3 });
    expect(feed.jobs.map((j) => [j.id, j.title, j.company, j.location, j.url])).toEqual([
      ["job:devbg:it-security:563042", "IT Governance, Risk, and Compliance Manager", "emerchantpay", "Fully Remote", "https://dev.bg/company/jobads/emerchantpay-it-governance-risk-and-compliance-manager/"],
      ["job:devbg:it-security:563068", "Information Security Expert (f/m/d) @ A1 Competence Delivery Center", "A1 Bulgaria", "София", "https://dev.bg/company/jobads/a1-bulgaria-information-security-expert-f-m-d-a1-competence-delivery-center/"],
      ["job:devbg:it-security:563152", "Expert Information security – ISO Ref #: HQ1463", "UBB / DZI", "София", "https://dev.bg/company/jobads/ubb-dzi-expert-information-security-iso-ref-hq1463/"],
    ]);
    // "9 окт." has no year, and adapters don't read the clock, so the date stays unknown.
    expect(feed.jobs.every((j) => j.postedAt === null)).toBe(true);
    expect((await engine.sourceHealth()).sources[0]).toMatchObject({ label: "dev.bg", category: "aggregator", history: [{ inLocations: 2, total: 3 }] });
  });

  it("follows the category's numbered pages", async () => {
    const page1 = loadFixture("devbg-it-security.html").replace("</div></body>", `</div><a class="page-numbers" href="${itSecurity}page/2/">2</a></body>`);
    const page2 = `<div class="job-list-item" data-job-id="999001"><a href="https://dev.bg/company/jobads/acme-soc-analyst/" class="overlay-link"></a>
      <span class="company-name">Acme</span><h6 class="job-title"> SOC Analyst </h6><span class="badge">Пловдив</span></div>`;
    const http = routedFetch((r) => {
      if (r.url === itSecurity) return new Response(page1);
      if (r.url === `${itSecurity}page/2/`) return new Response(page2);
      return undefined;
    });
    const { engine } = createTestEngine({ fetch: http.fetch });
    await engine.addSource({ kind: "devbg", config: { category: "it-security" } });

    const check = await engine.checkAll();

    expect(check.sources[0]).toMatchObject({ ok: true, found: 4 });
    expect(http.requests.map((r) => r.url)).toEqual([itSecurity, `${itSecurity}page/2/`]);
  });

  it("fails the check when the page has no job cards it can read", async () => {
    const { engine } = createTestEngine({ fetch: async () => new Response("<html><body>Maintenance</body></html>") });
    await engine.addSource({ kind: "devbg", config: "it-security" });

    const check = await engine.checkAll();

    expect(check.sources[0]).toMatchObject({ ok: false, error: "dev.bg's it-security page has no job list (the page layout may have changed)" });
  });

  it("rejects a category that isn't a dev.bg category slug", async () => {
    const { engine } = createTestEngine();
    await expect(engine.addSource({ kind: "devbg", config: "../../wp-admin" })).rejects.toThrow(/category/);
  });
});
