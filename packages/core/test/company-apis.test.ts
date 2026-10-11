import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch } from "./harness.ts";

const microsoftSearch = "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=security+engineer&location=Dublin&start=0&sort_by=timestamp";
const amazonSearch = "https://www.amazon.jobs/en/search.json?base_query=security+engineer&result_limit=100&offset=0&sort=recent";

describe("Microsoft source", () => {
  it("lists Microsoft's jobs for a search, newest first, with their own ids and links", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [microsoftSearch]: "microsoft-security-dublin.json" }) });
    const source = await engine.addSource({ kind: "microsoft", config: "security engineer|Dublin" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(source).toEqual({ id: "microsoft:security engineer|dublin", kind: "microsoft", name: "Microsoft · security engineer · Dublin" });
    expect(check.sources[0]).toMatchObject({ ok: true, found: 3, newPostings: 3 });
    expect(feed.jobs[0]).toEqual({
      id: "job:microsoft:security engineer|dublin:1970393557007211", title: "Software Engineer - Observability", company: "Microsoft",
      location: "Ireland, Dublin, Dublin", salary: null, postedAt: "2026-10-08T13:15:24.000Z", postingCount: 1, state: "new",
      url: "https://apply.careers.microsoft.com/careers/job/1970393557007211",
    });
    expect(feed.jobs[1]!.location).toBe("Ireland, Dublin, Dublin; Germany, Multiple Locations, Multiple Locations; United Kingdom, Multiple Locations, Multiple Locations; Portugal, Lisbon, Lisbon; Netherlands, Multiple Locations, Multiple Locations");
    expect((await engine.sourceHealth()).sources[0]).toMatchObject({ label: "Microsoft", category: "api" });
  });

  it("reports an error answer from Microsoft as a failed check", async () => {
    const { engine } = createTestEngine({
      fetch: async () => Response.json({ status: 500, error: { message: "search unavailable", body: "" }, data: null }),
    });
    await engine.addSource({ kind: "microsoft", config: "security engineer|Dublin" });

    const check = await engine.checkAll();

    expect(check.sources[0]).toMatchObject({ ok: false, outcome: "error", error: "Microsoft search failed: search unavailable" });
  });
});

describe("Amazon source", () => {
  it("lists Amazon's jobs for a search with the qualifications in the description", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [amazonSearch]: "amazon-security.json" }) });
    await engine.addSource({ kind: "amazon", config: "security engineer" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(check.sources[0]).toMatchObject({ sourceId: "amazon:security engineer", name: "Amazon · security engineer", ok: true, found: 3 });
    expect(feed.jobs.map((j) => [j.title, j.company, j.location, j.postedAt, j.url])).toEqual([
      ["Security Engineer, AWS Security", "Amazon", "London, England, GBR", "2026-09-16T00:00:00.000Z", "https://www.amazon.jobs/en/jobs/10544617/security-engineer-aws-security"],
      ["Security Engineer, CS Security", "Amazon", "Seattle, Washington, USA", "2026-05-19T00:00:00.000Z", "https://www.amazon.jobs/en/jobs/10423968/security-engineer-cs-security"],
      ["Security Engineer, AWS Security", "Amazon", "Seattle, Washington, USA", "2026-04-28T00:00:00.000Z", "https://www.amazon.jobs/en/jobs/10406134/security-engineer-aws-security"],
    ]);
  });

  it("keeps only jobs in the chosen country, because Amazon's location search doesn't filter", async () => {
    const filtered = amazonSearch + "&normalized_country_code%5B%5D=GBR";
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [filtered]: "amazon-security.json" }) });
    await engine.addSource({ kind: "amazon", config: { query: "security engineer", country: "gbr" } });

    await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(feed.jobs.map((j) => j.location)).toEqual(["London, England, GBR"]);
    expect((await engine.sourceHealth()).sources[0]).toMatchObject({ id: "amazon:security engineer|gbr", label: "Amazon", category: "api" });
  });
});
