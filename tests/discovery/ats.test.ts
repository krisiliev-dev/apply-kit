import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPostings as fetchSmartRecruiters,
  parseRef as srParseRef,
} from "@/lib/discovery/sources/smartrecruiters";
import {
  fetchPostings as fetchWorkday,
  parseRef as wdParseRef,
} from "@/lib/discovery/sources/workday";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(json: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => json })),
  );
}

describe("smartrecruiters adapter", () => {
  it("parses ref with optional country", () => {
    expect(srParseRef("BoschGroup")).toEqual({ companyId: "BoschGroup", country: undefined });
    expect(srParseRef("BoschGroup:bg")).toEqual({ companyId: "BoschGroup", country: "bg" });
  });

  it("maps postings; source.company is the stable companyId, display from API", async () => {
    stubFetch({
      content: [
        {
          id: "744000128421239",
          name: "Security Engineer",
          company: { name: "Bosch Group" },
          location: { city: "Sofia", country: "bg" },
          releasedDate: "2026-05-01T00:00:00.000Z",
        },
      ],
    });
    const posts = await fetchSmartRecruiters("BoschGroup:bg");
    expect(posts).toHaveLength(1);
    const p = posts[0];
    expect(p.title).toBe("Security Engineer");
    expect(p.company).toBe("Bosch Group");
    expect(p.source).toEqual({ kind: "smartrecruiters", company: "BoschGroup" });
    expect(p.url).toContain("/BoschGroup/744000128421239");
    expect(p.location).toBe("Sofia, bg");
  });
});

describe("workday adapter", () => {
  it("derives origin/tenant/site from a careers URL", () => {
    expect(wdParseRef("https://a1group.wd3.myworkdayjobs.com/bg-BG/A1_Jobs")).toEqual({
      origin: "https://a1group.wd3.myworkdayjobs.com",
      tenant: "a1group",
      site: "A1_Jobs",
    });
    expect(wdParseRef("not a url")).toBeNull();
  });

  it("maps CXS jobPostings; source.company is the tenant, display is the label", async () => {
    stubFetch({
      total: 1,
      jobPostings: [
        { title: "Java Developer", locationsText: "София", externalPath: "/job/Java-Developer_REQ-7202-3" },
      ],
    });
    const posts = await fetchWorkday("https://a1group.wd3.myworkdayjobs.com/bg-BG/A1_Jobs", "A1");
    expect(posts).toHaveLength(1);
    const p = posts[0];
    expect(p.title).toBe("Java Developer");
    expect(p.company).toBe("A1"); // display label
    expect(p.source).toEqual({ kind: "workday", company: "a1group" }); // stable key
    expect(p.location).toBe("София");
    expect(p.url).toBe("https://a1group.wd3.myworkdayjobs.com/A1_Jobs/job/Java-Developer_REQ-7202-3");
  });
});
