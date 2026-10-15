import { describe, expect, it } from "vitest";
import { portalJobReference } from "../src/index.ts";

// A portal's job reference from a posting's link (ticket #67), for Apply to match pages to
// approved packages. Made-up boards and ids.

describe("the portal job reference", () => {
  it.each([
    ["https://job-boards.greenhouse.io/kestrel/jobs/4410", { portal: "greenhouse", board: "kestrel", jobId: "4410" }],
    ["https://boards.greenhouse.io/Kestrel/jobs/4410?gh_src=x", { portal: "greenhouse", board: "kestrel", jobId: "4410" }],
    ["https://job-boards.eu.greenhouse.io/kestrel?gh_jid=4410", { portal: "greenhouse", board: "kestrel", jobId: "4410" }],
    ["https://jobs.lever.co/corvid/8d5e1f7a-2b3c-4d5e-8f90-1a2b3c4d5e6f/apply", { portal: "lever", board: "corvid", jobId: "8d5e1f7a-2b3c-4d5e-8f90-1a2b3c4d5e6f" }],
    ["https://jobs.ashbyhq.com/Kestrel/0b5f1c2e-4d6a-4f1e-9a51-2c7d8e9f0a11", { portal: "ashby", board: "Kestrel", jobId: "0b5f1c2e-4d6a-4f1e-9a51-2c7d8e9f0a11" }],
    ["https://halden.wd3.myworkdayjobs.com/en-US/Careers/job/Sofia-Bulgaria/Security-Engineer_R-10442", { portal: "workday", board: "halden", jobId: "R-10442" }],
    ["https://jobs.smartrecruiters.com/OrbitBank/744000012345678-security-analyst", { portal: "smartrecruiters", board: "OrbitBank", jobId: "744000012345678" }],
    ["https://apply.workable.com/velora/j/4B1C2D3E4F/", { portal: "workable", board: "velora", jobId: "4B1C2D3E4F" }],
  ])("%s", (url, ref) => {
    expect(portalJobReference(url)).toEqual(ref);
  });

  it("is null for a job board's copy or a link that isn't one", () => {
    expect(portalJobReference("https://dev.bg/company/jobads/kestrel-security-engineer/")).toBeNull();
    expect(portalJobReference("not a link")).toBeNull();
  });
});
