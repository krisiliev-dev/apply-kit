import { describe, expect, it } from "vitest";
import { embeddedForm, recognisePortal } from "./portal.ts";

// Every URL pattern in docs/research/implementation/portals.md, with made-up companies and ids.
describe("which portal and which job a page address is", () => {
  it.each([
    ["https://kestrelpayments.wd3.myworkdayjobs.com/en-US/Kestrel_Careers/job/Sofia/Security-Engineer_R-10482", "kestrelpayments", "R-10482"],
    ["https://kestrelpayments.wd3.myworkdayjobs.com/en-US/Kestrel_Careers/job/Sofia/Security-Engineer_R-10482/apply", "kestrelpayments", "R-10482"],
    ["https://kestrelpayments.wd3.myworkdayjobs.com/en-US/Kestrel_Careers/job/Sofia/Security-Engineer_R-10482/apply/applyManually", "kestrelpayments", "R-10482"],
    ["https://kestrelpayments.wd3.myworkdayjobs.com/Kestrel_Careers/job/Sofia/Security-Engineer_R-10482/apply/autofillWithResume?source=LinkedIn", "kestrelpayments", "R-10482"],
    ["https://orbitalbank.wd1.myworkdayjobs.com/External/job/Sofia-Bulgaria/SOC-Analyst_JR0001234", "orbitalbank", "JR0001234"],
    ["https://orbitalbank.wd1.myworkdayjobs.com/External/job/Sofia_Bulgaria/SOC-Analyst_JR0001234/apply/useMyLastApplication", "orbitalbank", "JR0001234"],
    ["https://orbitalbank.wd103.myworkdaysite.com/recruiting/orbitalbank/External/job/Sofia/SOC-Analyst_JR0001234/apply", "orbitalbank", "JR0001234"],
    ["https://orbitalbank.wd103.myworkdaysite.com/en-US/recruiting/orbitalbank/External/job/SOC-Analyst_JR0001234", "orbitalbank", "JR0001234"],
  ])("Workday: %s", (url, board, jobId) => {
    expect(recognisePortal(url)).toEqual({ portal: "workday", ref: { portal: "workday", board, jobId } });
  });

  it("knows a Workday page that isn't one job (the tenant's job list, the candidate home)", () => {
    expect(recognisePortal("https://kestrelpayments.wd3.myworkdayjobs.com/en-US/Kestrel_Careers")).toEqual({ portal: "workday", ref: null });
    expect(recognisePortal("https://kestrelpayments.wd3.myworkdayjobs.com/en-US/Kestrel_Careers/userHome")).toEqual({ portal: "workday", ref: null });
  });

  it.each([
    ["https://boards.greenhouse.io/vireohealth/jobs/4471029", "vireohealth", "4471029"],
    ["https://boards.greenhouse.io/vireohealth/jobs/4471029?gh_src=a1b2c3#app", "vireohealth", "4471029"],
    ["https://job-boards.greenhouse.io/vireohealth/jobs/4471029", "vireohealth", "4471029"],
    ["https://job-boards.eu.greenhouse.io/vireohealth/jobs/4471029", "vireohealth", "4471029"],
    ["https://job-boards.greenhouse.io/vireohealth/jobs/4471029/confirmation", "vireohealth", "4471029"],
    // The embedded form's frame src on a company's own page.
    ["https://boards.greenhouse.io/embed/job_app?for=vireohealth&token=4471029", "vireohealth", "4471029"],
    ["https://job-boards.greenhouse.io/embed/job_app?for=vireohealth&token=4471029&b=https%3A%2F%2Fcareers.vireo.example", "vireohealth", "4471029"],
    // A company's own careers page carrying the Greenhouse job id: the board isn't in the address.
    ["https://careers.vireo.example/open-roles/?gh_jid=4471029", null, "4471029"],
  ])("Greenhouse: %s", (url, board, jobId) => {
    expect(recognisePortal(url)).toEqual({ portal: "greenhouse", ref: { portal: "greenhouse", board, jobId } });
  });

  it("knows a Greenhouse board that isn't one job", () => {
    expect(recognisePortal("https://job-boards.greenhouse.io/vireohealth")).toEqual({ portal: "greenhouse", ref: null });
    expect(recognisePortal("https://careers.vireo.example/open-roles/?gh_jid=not-a-number")).toEqual({ portal: "unknown", ref: null });
  });

  const leverId = "5f1c2a9e-3b7d-4e21-9a0c-7d2e8b4f6a10";
  const ashbyId = "0c9e1d2a-8f3b-4a6c-b5d7-2e1f9a8c4b30";
  const publication = "a3e5c7d9-1b2f-4e6a-8c0d-9f7b5a3e1c22";
  it.each([
    [`https://jobs.lever.co/nordlicht/${leverId}`, "lever", "nordlicht", leverId],
    [`https://jobs.lever.co/nordlicht/${leverId}/apply?lever-source=LinkedIn`, "lever", "nordlicht", leverId],
    [`https://jobs.eu.lever.co/nordlicht/${leverId}/thanks`, "lever", "nordlicht", leverId],
    ["https://jobs.smartrecruiters.com/NordlichtSecurity/744000012345678-application-security-engineer", "smartrecruiters", "NordlichtSecurity", "744000012345678"],
    // The OneClick application carries the publication's uuid, not the posting's numeric id.
    [`https://jobs.smartrecruiters.com/oneclick-ui/company/NordlichtSecurity/publication/${publication}?dcr_ci=NordlichtSecurity`, "smartrecruiters", "NordlichtSecurity", publication],
    ["https://apply.workable.com/dreamwire/j/A1B2C3D4E5/", "workable", "dreamwire", "A1B2C3D4E5"],
    ["https://apply.workable.com/dreamwire/j/A1B2C3D4E5/apply/", "workable", "dreamwire", "A1B2C3D4E5"],
    [`https://jobs.ashbyhq.com/vireo-health/${ashbyId}`, "ashby", "vireo-health", ashbyId],
    [`https://jobs.ashbyhq.com/vireo-health/${ashbyId}/application?utm_source=x`, "ashby", "vireo-health", ashbyId],
  ])("%s", (url, portal, board, jobId) => {
    expect(recognisePortal(url)).toEqual({ portal, ref: { portal, board, jobId } });
  });

  it("knows these portals' pages that aren't one job, including Ashby's embed", () => {
    expect(recognisePortal("https://jobs.lever.co/nordlicht")).toEqual({ portal: "lever", ref: null });
    expect(recognisePortal("https://jobs.smartrecruiters.com/NordlichtSecurity")).toEqual({ portal: "smartrecruiters", ref: null });
    expect(recognisePortal("https://apply.workable.com/dreamwire/")).toEqual({ portal: "workable", ref: null });
    expect(recognisePortal("https://jobs.ashbyhq.com/vireo-health/embed?version=2")).toEqual({ portal: "ashby", ref: null });
  });

  it("knows one job in Ashby's embed by its ashby_jid, in the frame and on the company page around it", () => {
    const id = "a2b4c6d8-1e3f-4a5b-8c7d-9e0f1a2b3c4d";
    expect(recognisePortal(`https://jobs.ashbyhq.com/quillfeather/embed?version=2&ashby_jid=${id}`)).toEqual({ portal: "ashby", ref: { portal: "ashby", board: "quillfeather", jobId: id } });
    expect(recognisePortal(`https://quillfeather.example/careers?ashby_jid=${id.toUpperCase()}`)).toEqual({ portal: "ashby", ref: { portal: "ashby", board: null, jobId: id } });
    expect(recognisePortal("https://quillfeather.example/careers?ashby_jid=not-a-job")).toEqual({ portal: "unknown", ref: null });
  });

  it.each([
    "https://careers.ostravabank.example/bg/kandidatstvai/it-security-specialist",
    "https://www.linkedin.com/jobs/view/4100000009/",
    "https://myworkdayjobs.com.evil.example/x/job/y/Title_R-1",
    "https://greenhouse.io.evil.example/vireohealth/jobs/4471029",
    "chrome://extensions/",
    "about:blank",
    "",
    undefined,
  ])("anything else is not a portal apply-kit knows: %s", (url) => {
    expect(recognisePortal(url)).toEqual({ portal: "unknown", ref: null });
  });
});

describe("a portal's form embedded in a company page", () => {
  const leverForm = "https://jobs.lever.co/larkspur/3f6c2a1e-8b4d-4c7a-9e21-5d0b7a6c4f18/apply";

  it("finds the portal's job form among the page's frames, by the frame's address", () => {
    const found = embeddedForm(["https://maps.example/embed?q=Sofia", leverForm]);
    expect(found).toEqual({ src: leverForm, portal: "lever", ref: { portal: "lever", board: "larkspur", jobId: "3f6c2a1e-8b4d-4c7a-9e21-5d0b7a6c4f18" } });
  });

  it("finds Greenhouse's and Ashby's embedded forms, and nothing on a page without one", () => {
    expect(embeddedForm(["https://boards.greenhouse.io/embed/job_app?for=vireohealth&token=4471029"])?.ref).toEqual({ portal: "greenhouse", board: "vireohealth", jobId: "4471029" });
    expect(embeddedForm(["https://jobs.ashbyhq.com/quillfeather/embed?version=2&ashby_jid=a2b4c6d8-1e3f-4a5b-8c7d-9e0f1a2b3c4d"])?.portal).toBe("ashby");
    // A board without one job open isn't a form to fill.
    expect(embeddedForm(["https://jobs.ashbyhq.com/quillfeather/embed?version=2", "https://maps.example/embed", "about:blank", ""])).toBeNull();
  });
});
