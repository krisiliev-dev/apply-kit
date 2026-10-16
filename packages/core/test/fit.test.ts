import { describe, expect, it } from "vitest";
import type { FeedJob, PostingFacts, SearchSettings } from "../src/index.ts";
import { defaultSearchSettings } from "../src/index.ts";
import { cannedFacts, createTestEngine, fakeExtractor } from "./harness.ts";

interface BoardJob {
  title: string;
  location?: string | null;
  /** ISO date the job was first published. */
  posted?: string | null;
  text?: string;
}

/** An engine with one Greenhouse board listing `jobs`, read by a fake extractor with `facts` per title. */
async function feedOf(jobs: BoardJob[], facts: Record<string, PostingFacts> = {}, { read = true, searchSettings }: { read?: boolean; searchSettings?: SearchSettings } = {}) {
  const board = {
    jobs: jobs.map((j, i) => ({
      id: i + 1,
      title: j.title,
      absolute_url: `https://example.test/jobs/${i + 1}`,
      company_name: "Example Co",
      location: { name: j.location === undefined ? "Sofia, Bulgaria" : j.location },
      first_published: j.posted === undefined ? "2026-10-11T09:00:00Z" : j.posted,
      content: `&lt;p&gt;${j.text ?? `About the ${j.title} role.`}&lt;/p&gt;`,
    })),
  };
  // These tests are about ranking, so nothing is hidden: dealbreakers are covered in dealbreakers.test.ts.
  const settings = searchSettings ?? defaultSearchSettings;
  const noDealbreakers = { ...settings, dealbreakers: { languagesNotSpoken: [], maxYearsRequired: null, salaryBelowMinimum: false, outsideLocations: false } };
  const t = createTestEngine({ fetch: async () => Response.json(board), extractor: fakeExtractor(facts), searchSettings: noDealbreakers });
  await t.engine.addSource({ kind: "greenhouse", config: "example" });
  await t.engine.checkAll();
  if (read) await t.engine.readPending();
  return t;
}

const row = (jobs: FeedJob[], title: string) => jobs.find((j) => j.title === title)!;

describe("Fit: every Job gets a Fit with its reasons", () => {
  it("gives each Feed row a Fit from 0 to 100 with a reason for every part of it", async () => {
    const { engine } = await feedOf([{ title: "Security Engineer" }]);

    const { jobs } = await engine.queryFeed({ view: "new" });
    const fit = jobs[0]!.fit;

    expect(fit.value).toBeGreaterThanOrEqual(0);
    expect(fit.value).toBeLessThanOrEqual(100);
    expect(fit.reasons.map((r) => r.factor)).toEqual(["requirements", "angle", "location", "salary", "freshness"]);
    // The points of every reason add up to the Fit.
    expect(Math.round(fit.reasons.reduce((n, r) => n + r.points, 0))).toBe(fit.value);
  });

  it("orders the Feed by Fit, best first", async () => {
    const { engine } = await feedOf([
      { title: "Office Manager", location: "Plovdiv" },
      { title: "Security Engineer", location: "Sofia, Bulgaria" },
      { title: "Frontend Developer", location: "Remote, US" },
    ]);

    const { jobs } = await engine.queryFeed({ view: "new" });

    expect(jobs.map((j) => j.title)).toEqual(["Security Engineer", "Frontend Developer", "Office Manager"]);
    expect(jobs[0]!.fit.value).toBeGreaterThan(jobs[1]!.fit.value);
    expect(jobs[1]!.fit.value).toBeGreaterThan(jobs[2]!.fit.value);
  });
});

describe("Fit: location matching", () => {
  it("matches 'София' and 'Sofia' as the same first-priority place", async () => {
    const { engine } = await feedOf([
      { title: "Security Engineer", location: "София, България" },
      { title: "Security Analyst", location: "Sofia, Bulgaria" },
    ]);

    const { jobs } = await engine.queryFeed({ view: "new" });

    expect(row(jobs, "Security Engineer").fit.place.tier).toBe("first");
    expect(row(jobs, "Security Analyst").fit.place.tier).toBe("first");
    const locationPoints = (j: FeedJob) => j.fit.reasons.find((r) => r.factor === "location")!.points;
    expect(locationPoints(row(jobs, "Security Engineer"))).toBe(locationPoints(row(jobs, "Security Analyst")));
  });

  it("matches whole words only: 'UK' does not match 'Ukraine'", async () => {
    const searchSettings: SearchSettings = { ...defaultSearchSettings, locations: { ...defaultSearchSettings.locations, relocation: ["UK"] } };
    const { engine } = await feedOf([
      { title: "Security Engineer", location: "Kyiv, Ukraine" },
      { title: "Security Analyst", location: "London, UK" },
    ], {}, { searchSettings });

    const { jobs } = await engine.queryFeed({ view: "new", relocation: true });

    expect(row(jobs, "Security Engineer").fit.place.tier).toBe("other");
    expect(row(jobs, "Security Analyst").fit.place.tier).toBe("relocation");
  });

  it("matches whole words only: the security keyword 'IAM' does not match 'William'", async () => {
    const { engine } = await feedOf([{ title: "Assistant to William Jones" }, { title: "IAM Engineer" }]);

    const { jobs } = await engine.queryFeed({ view: "new" });

    expect(row(jobs, "Assistant to William Jones").fit.angle).toBeNull();
    expect(row(jobs, "IAM Engineer").fit.angle).toBe("security");
  });

  it("counts remote within European time zones as first, like Sofia, and remote elsewhere as outside", async () => {
    const { engine } = await feedOf([
      { title: "Security Engineer", location: "Remote - Europe" },
      { title: "Security Analyst", location: "Remote, US" },
    ]);

    const { jobs } = await engine.queryFeed({ view: "new" });

    expect(row(jobs, "Security Engineer").fit.place).toEqual({ tier: "first", label: "Remote · Europe" });
    expect(row(jobs, "Security Analyst").fit.place.tier).toBe("other");
  });
  it("doesn't call a job that only says 'Bulgaria' outside Kris's locations: the city isn't stated", async () => {
    const { engine } = await feedOf([{ title: "Security Engineer", location: "Bulgaria · Hybrid" }]);

    const fit = (await engine.queryFeed({ view: "new" })).jobs[0]!.fit;

    expect(fit.place).toEqual({ tier: "unknown", label: "Bulgaria, city not stated" });
  });
});

describe("Fit: relocation jobs are a separate list", () => {
  const jobs = [
    { title: "Security Engineer", location: "Zürich, Switzerland" },
    { title: "Security Analyst", location: "Sofia, Bulgaria" },
    { title: "Office Manager", location: "Plovdiv" },
    { title: "Detection Engineer", location: "Madrid, Spain" },
  ];

  it("leaves relocation jobs out of the main list, and counts them, while the Relocation filter is off", async () => {
    const { engine } = await feedOf(jobs);

    const feed = await engine.queryFeed({ view: "new" });

    expect(feed.jobs.map((j) => j.title)).toEqual(["Security Analyst", "Office Manager"]);
    expect(feed.counts.new).toBe(2);
    expect(feed.counts.relocation).toBe(2);
  });

  it("shows relocation jobs after the main list, ranked among themselves, when the filter is on", async () => {
    const { engine } = await feedOf(jobs);

    const feed = await engine.queryFeed({ view: "new", relocation: true });

    expect(feed.jobs.map((j) => j.title)).toEqual(["Security Analyst", "Office Manager", "Security Engineer", "Detection Engineer"]);
    expect(feed.jobs.slice(2).map((j) => j.fit.place.label)).toEqual(["Relocation: Switzerland", "Relocation: Spain"]);
  });
});

const quote = (q: string) => ({ quote: q, translation: null });
const salary = (min: number, max: number, q: string, confidence = 0.95): PostingFacts["salary"] =>
  ({ stated: true, min, max, currency: "EUR", period: "month", basis: "gross", source: quote(q), confidence });

describe("Fit: the parts and their reasons", () => {
  it("never counts a requirement it can't check yet as a gap (there is no master profile yet)", async () => {
    const facts = cannedFacts({
      requirements: [
        { text: "Kubernetes security", kind: "required", category: "skill", source: quote("Kubernetes security"), confidence: 0.95 },
        { text: "CISSP", kind: "preferred", category: "certificate", source: quote("CISSP"), confidence: 0.95 },
      ],
    });
    const { engine } = await feedOf([{ title: "Security Engineer", text: "Kubernetes security. CISSP." }], { "Security Engineer": facts });

    const fit = (await engine.queryFeed({ view: "new" })).jobs[0]!.fit;

    expect(fit.gaps).toEqual([]);
    const requirements = fit.reasons.find((r) => r.factor === "requirements")!;
    expect(requirements).toMatchObject({ score: null, points: 0 });
    expect(requirements.text).toMatch(/not checked yet/);
    expect(fit.why).toBe("Security angle · 2 requirements, not checked yet · Sofia");
  });

  it("ranks a salary above Kris's minimum over one below it, and says so", async () => {
    const { engine } = await feedOf(
      [{ title: "Security Engineer", text: "Pay: €3,000–4,000 a month." }, { title: "Security Analyst", text: "Pay: €1,200–1,500 a month." }],
      { "Security Engineer": cannedFacts({ salary: salary(3000, 4000, "€3,000–4,000 a month") }), "Security Analyst": cannedFacts({ salary: salary(1200, 1500, "€1,200–1,500 a month") }) },
    );

    const { jobs } = await engine.queryFeed({ view: "new" });

    expect(jobs.map((j) => j.title)).toEqual(["Security Engineer", "Security Analyst"]);
    expect(row(jobs, "Security Engineer").fit.why).toContain("salary above your minimum");
    expect(row(jobs, "Security Analyst").fit.why).toContain("salary below your minimum");
    expect(row(jobs, "Security Analyst").fit.reasons.find((r) => r.factor === "salary")!.text).toBe("€1,200–1,500 gross/month, below your minimum (€2,000/month)");
  });

  it("leaves an unstated salary out instead of counting it against the job", async () => {
    const { engine } = await feedOf([{ title: "Security Engineer" }]);

    const fit = (await engine.queryFeed({ view: "new" })).jobs[0]!.fit;

    expect(fit.reasons.find((r) => r.factor === "salary")).toMatchObject({ text: "Not stated", score: null, points: 0 });
  });

  it("ranks a fresh posting over a month-old one", async () => {
    const { engine } = await feedOf([
      { title: "Security Analyst", posted: "2026-09-01T09:00:00Z" },
      { title: "Security Engineer", posted: "2026-10-11T09:00:00Z" },
    ]);

    const { jobs } = await engine.queryFeed({ view: "new" });

    expect(jobs.map((j) => j.title)).toEqual(["Security Engineer", "Security Analyst"]);
    expect(row(jobs, "Security Analyst").fit.reasons.find((r) => r.factor === "freshness")!.text).toBe("Posted 40 days ago");
  });

  it("keeps the Fit provisional until the posting is read", async () => {
    const { engine } = await feedOf([{ title: "Security Engineer" }], {}, { read: false });

    const fit = (await engine.queryFeed({ view: "new" })).jobs[0]!.fit;

    expect(fit.provisional).toBe(true);
    expect(fit.why).toBe("Security angle · not read yet · Sofia");
  });

  it("uses the cautious reading while a fact needs Kris, and says the Fit is provisional", async () => {
    const unsure = cannedFacts({ salary: salary(1000, 1200, "€1,000–1,200", 0.3) });
    const { engine } = await feedOf([{ title: "Security Engineer", text: "€1,000–1,200" }], { "Security Engineer": unsure });

    const fit = (await engine.queryFeed({ view: "new" })).jobs[0]!.fit;

    expect(fit.provisional).toBe(true);
    // The doubtful salary is read as not stated, so it can't wrongly count against the job.
    expect(fit.reasons.find((r) => r.factor === "salary")).toMatchObject({ text: "Not stated", score: null });
    expect(fit.why).toContain("1 fact needs you, so the Fit is provisional");
  });

  it("is final once the posting is read and nothing needs Kris", async () => {
    const { engine } = await feedOf([{ title: "Security Engineer" }]);

    const fit = (await engine.queryFeed({ view: "new" })).jobs[0]!.fit;

    expect(fit.provisional).toBe(false);
  });

  it("sorts newest first when asked", async () => {
    const { engine } = await feedOf([
      { title: "Office Manager", posted: "2026-10-11T09:00:00Z" },
      { title: "Security Engineer", posted: "2026-10-10T09:00:00Z" },
    ]);

    expect((await engine.queryFeed({ view: "new" })).jobs.map((j) => j.title)).toEqual(["Security Engineer", "Office Manager"]);
    expect((await engine.queryFeed({ view: "new", sort: "newest" })).jobs.map((j) => j.title)).toEqual(["Office Manager", "Security Engineer"]);
  });
});

describe("Fit on the Job page", () => {
  it("replaces the Fit placeholder with the same Fit the Feed row shows", async () => {
    const { engine } = await feedOf([{ title: "Security Engineer" }]);
    const [job] = (await engine.queryFeed({ view: "new" })).jobs;

    const detail = await engine.getJob(job!.id);

    expect(detail!.fit).toEqual(job!.fit);
  });
});

describe("Bulgarian postings", () => {
  const bulgarian = cannedFacts({ language: "bg", titleTranslation: "SOC Analyst L2" });

  it("shows a Bulgarian posting's title in English with the original kept, and starts its package in Bulgarian", async () => {
    const { engine } = await feedOf([{ title: "Анализатор SOC, ниво 2", text: "Търсим анализатор." }], { "Анализатор SOC, ниво 2": bulgarian });
    const [job] = (await engine.queryFeed({ view: "new" })).jobs;

    const detail = await engine.getJob(job!.id);

    expect(job).toMatchObject({ title: "Анализатор SOC, ниво 2", titleTranslation: "SOC Analyst L2", language: "bg" });
    expect(detail).toMatchObject({ titleTranslation: "SOC Analyst L2", language: "bg", packageLanguage: "bg" });
    // The original posting stays available ("View original").
    expect(detail!.postingText).toContain("Търсим анализатор.");
  });

  it("uses Bulgarian for cached readings that stored the model's language name", async () => {
    const { engine } = await feedOf([{ title: "Анализатор SOC" }], { "Анализатор SOC": cannedFacts({ language: "Bulgarian" }) });
    const [job] = (await engine.queryFeed({ view: "new" })).jobs;
    expect(job).toMatchObject({ language: "bg" });
    expect(await engine.getJob(job!.id)).toMatchObject({ language: "bg", packageLanguage: "bg" });
  });

  it("matches angles on the English title of a Bulgarian posting", async () => {
    const tester = cannedFacts({ language: "bg", titleTranslation: "Penetration Tester" });
    const { engine } = await feedOf([{ title: "Тестер, ниво 2" }], { "Тестер, ниво 2": tester });

    const [job] = (await engine.queryFeed({ view: "new" })).jobs;

    expect(job!.fit.angle).toBe("security");
    expect(job!.fit.reasons.find((r) => r.factor === "angle")!.text).toBe("Security: “penetration tester”");
  });

  it("starts an English posting's package in English", async () => {
    const { engine } = await feedOf([{ title: "Security Engineer" }]);
    const [job] = (await engine.queryFeed({ view: "new" })).jobs;

    expect(await engine.getJob(job!.id)).toMatchObject({ language: "en", titleTranslation: null, packageLanguage: "en" });
  });
});
