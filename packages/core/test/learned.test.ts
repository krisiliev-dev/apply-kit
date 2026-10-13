import { describe, expect, it } from "vitest";
import type { FeedJob, PostingFacts, SearchSettings } from "../src/index.ts";
import { defaultSearchSettings } from "../src/index.ts";
import { cannedFacts, createTestEngine, fakeExtractor } from "./harness.ts";

interface BoardJob {
  title: string;
  company: string;
  location?: string;
  posted?: string;
}

/** An engine with one Greenhouse board listing `jobs` (each at its own company), all read. */
async function feedOf(jobs: BoardJob[], facts: Record<string, PostingFacts> = {}, searchSettings?: SearchSettings) {
  const board = () => ({
    jobs: jobs.map((j, i) => ({
      id: i + 1,
      title: j.title,
      absolute_url: `https://example.test/jobs/${i + 1}`,
      company_name: j.company,
      location: { name: j.location ?? "Sofia, Bulgaria" },
      first_published: j.posted ?? "2026-10-11T09:00:00Z",
      content: `&lt;p&gt;About the ${j.title} role.&lt;/p&gt;`,
    })),
  });
  const t = createTestEngine({ fetch: async () => Response.json(board()), extractor: fakeExtractor(facts), searchSettings });
  await t.engine.addSource({ kind: "greenhouse", config: "example" });
  await t.engine.checkAll();
  await t.engine.readPending();
  const ids: Record<string, string> = {};
  for (const view of ["open", "hidden"] as const) {
    for (const j of (await t.engine.queryFeed({ view, relocation: true })).jobs) ids[j.title] = j.id;
  }
  const job = async (title: string): Promise<FeedJob> => {
    for (const view of ["open", "passed", "hidden"] as const) {
      const found = (await t.engine.queryFeed({ view, relocation: true })).jobs.find((j) => j.title === title);
      if (found) return found;
    }
    throw new Error(`No job "${title}"`);
  };
  return { ...t, ids, job };
}

const bankJobs: BoardJob[] = [
  { title: "Security Analyst", company: "Unity Bank" },
  { title: "SOC Analyst", company: "Unity Bank" },
  { title: "Security Engineer", company: "Kestrel" },
];

describe("learned adjustments: only when Kris opts in", () => {
  it("passing with a reason but without ticking the box learns nothing and changes no Fit", async () => {
    const { engine, ids, job } = await feedOf(bankJobs);
    const before = await job("SOC Analyst");

    await engine.pass([ids["Security Analyst"]!], { reason: "company" });

    expect(await engine.learnedAdjustments()).toEqual([]);
    expect((await engine.queryFeed({ view: "new" })).ranking.learnedAdjustments).toBe(0);
    expect((await job("SOC Analyst")).fit).toEqual(before.fit);
  });
});

describe("learned adjustments: from a pass reason", () => {
  it("a company pass with the box ticked ranks that company's other jobs lower, says so in their why-line, and is listed with what created it", async () => {
    const { engine, ids, job } = await feedOf(bankJobs);
    const soc = await job("SOC Analyst");
    const kestrel = await job("Security Engineer");

    const decision = await engine.pass([ids["Security Analyst"]!], { reason: "company", learn: true });

    const list = await engine.learnedAdjustments();
    expect(list).toEqual([
      expect.objectContaining({
        origin: "pass",
        effect: "lower",
        points: -8,
        applies: "Jobs at Unity Bank",
        text: "ranked lower: you passed a job at Unity Bank",
        createdBy: "You passed Security Analyst at Unity Bank: Not interested in this company",
        job: { id: ids["Security Analyst"], title: "Security Analyst", company: "Unity Bank" },
        decisionId: decision.id,
        undoneAt: null,
        jobsAffected: 1,
      }),
    ]);
    expect(decision.learned).toEqual(list);
    expect((await engine.queryFeed({ view: "new" })).ranking.learnedAdjustments).toBe(1);

    const after = await job("SOC Analyst");
    expect(after.fit.value).toBe(soc.fit.value - 8);
    expect(after.fit.why).toBe(`${soc.fit.why} · ranked lower: you passed a job at Unity Bank`);
    expect(after.fit.reasons.at(-1)).toMatchObject({ factor: "adjustment", adjustmentId: list[0]!.id, points: -8 });
    expect((await job("Security Engineer")).fit).toEqual(kestrel.fit);
  });
});

// Three jobs whose Fits differ by freshness only: Unity Bank's is the freshest, so it ranks first.
const rankedJobs: BoardJob[] = [
  { title: "Security Analyst", company: "Unity Bank", posted: "2026-10-12T06:00:00Z" },
  { title: "SOC Analyst", company: "Unity Bank", posted: "2026-10-12T05:00:00Z" },
  { title: "Security Engineer", company: "Kestrel", posted: "2026-10-06T09:00:00Z" },
  { title: "Detection Engineer", company: "Halden", posted: "2026-09-20T09:00:00Z" },
];
const order = async (engine: Awaited<ReturnType<typeof feedOf>>["engine"]) =>
  (await engine.queryFeed({ view: "new" })).jobs.map((j) => [j.title, j.fit.value]);

describe("learned adjustments: undo", () => {
  it("undoing an adjustment restores every rank and Fit as it was, and the list keeps it marked undone", async () => {
    const { engine, ids, clock } = await feedOf(rankedJobs);
    const plain = await engine.pass([ids["Security Analyst"]!], { reason: "company" });
    const before = await order(engine);
    expect(before.map(([t]) => t)).toEqual(["SOC Analyst", "Security Engineer", "Detection Engineer"]);

    // Undone and passed again, this time with the box ticked.
    await engine.undo(plain.id);
    await engine.pass([ids["Security Analyst"]!], { reason: "company", learn: true });
    expect((await order(engine)).map(([t]) => t)).toEqual(["Security Engineer", "SOC Analyst", "Detection Engineer"]);

    await clock.advance(60_000);
    const [learned] = await engine.learnedAdjustments();
    const undone = await engine.undoAdjustment(learned!.id);

    expect(await order(engine)).toEqual(before);
    expect(undone).toMatchObject({ id: learned!.id, undoneAt: "2026-10-12T07:31:00.000Z", jobsAffected: 0 });
    expect((await engine.queryFeed({ view: "new" })).ranking.learnedAdjustments).toBe(0);
    expect((await engine.queryFeed({ view: "new" })).jobs.map((j) => j.fit.why).join()).not.toContain("ranked lower");
  });

  it("undoing the pass it came with undoes what it learned too", async () => {
    const { engine, ids } = await feedOf(rankedJobs);
    const before = await engine.queryFeed({ view: "new" });

    const pass = await engine.pass([ids["Security Analyst"]!], { reason: "company", learn: true });
    await engine.undo(pass.id);

    expect(await engine.queryFeed({ view: "new" })).toMatchObject({ jobs: before.jobs, ranking: { learnedAdjustments: 0 } });
    expect((await engine.learnedAdjustments())[0]!.undoneAt).not.toBeNull();
  });
});

const quote = (q: string) => ({ quote: q, translation: null });
const requiresGerman = cannedFacts({
  languages: [{ language: "German", level: "fluent", kind: "required", source: quote("About the Penetration Tester role."), confidence: 0.95 }],
});
const noGerman: SearchSettings = { ...defaultSearchSettings, dealbreakers: { ...defaultSearchSettings.dealbreakers, languagesNotSpoken: ["German"] } };
const halden: BoardJob[] = [
  { title: "Penetration Tester", company: "Halden Systems" },
  { title: "Detection Engineer", company: "Halden Systems" },
  { title: "Security Engineer", company: "Kestrel" },
];

describe("learned adjustments: from Show this job", () => {
  it("showing a hidden job learns nothing unless Kris ticks the box", async () => {
    const { engine, ids, job } = await feedOf(halden, { "Penetration Tester": requiresGerman }, noGerman);
    const before = await job("Detection Engineer");

    const d = await engine.unhide([ids["Penetration Tester"]!]);

    expect(d.learned).toBeUndefined();
    expect(await engine.learnedAdjustments()).toEqual([]);
    expect((await job("Detection Engineer")).fit).toEqual(before.fit);
  });

  it("with the box ticked, that company's jobs rank higher, named in their why-line", async () => {
    const { engine, ids, job } = await feedOf(halden, { "Penetration Tester": requiresGerman }, noGerman);
    const before = await job("Detection Engineer");

    const d = await engine.unhide([ids["Penetration Tester"]!], { learn: true });

    expect(d.learned).toEqual([expect.objectContaining({
      origin: "unhide", effect: "higher", points: 5, applies: "Jobs at Halden Systems",
      createdBy: "You showed Penetration Tester at Halden Systems from the hidden pile",
      text: "ranked higher: you showed a hidden job at Halden Systems",
      jobsAffected: 2,
    })]);
    const after = await job("Detection Engineer");
    expect(after.fit.value).toBe(before.fit.value + 5);
    expect(after.fit.why).toContain("ranked higher: you showed a hidden job at Halden Systems");
    expect((await job("Security Engineer")).fit.why).not.toContain("ranked higher");
  });
});

describe("learned adjustments: boosts", () => {
  it("a boost ranks the company's jobs of the same angle higher; other angles there are left alone", async () => {
    const { engine, ids, job } = await feedOf([
      { title: "Security Engineer", company: "Kestrel" },
      { title: "SOC Analyst", company: "Kestrel" },
      { title: "Product Designer", company: "Kestrel" },
      { title: "Security Analyst", company: "Unity Bank" },
    ]);
    const soc = await job("SOC Analyst");
    const designer = await job("Product Designer");

    const boost = await engine.boost(ids["Security Engineer"]!);

    expect(boost).toMatchObject({
      origin: "boost", effect: "higher", points: 8, applies: "Security jobs at Kestrel", decisionId: null,
      text: "ranked higher: you boosted Security jobs at Kestrel", jobsAffected: 2,
    });
    expect((await job("SOC Analyst")).fit.value).toBe(soc.fit.value + 8);
    expect((await job("Product Designer")).fit).toEqual(designer.fit);
    expect((await job("Security Analyst")).fit.why).not.toContain("boosted");
    expect((await engine.queryFeed({ view: "new" })).ranking.learnedAdjustments).toBe(1);
  });

  it("boosting the same thing twice keeps one adjustment", async () => {
    const { engine, ids } = await feedOf(bankJobs);
    const a = await engine.boost(ids["Security Engineer"]!);
    const b = await engine.boost(ids["Security Engineer"]!);
    expect(b.id).toBe(a.id);
    expect(await engine.learnedAdjustments()).toHaveLength(1);
  });
});

const kubernetes = (title: string) => cannedFacts({
  requirements: [
    { text: "Kubernetes security", kind: "required", category: "skill", source: quote(`About the ${title} role.`), confidence: 0.95 },
    { text: "English", kind: "required", category: "language", source: quote(`About the ${title} role.`), confidence: 0.95 },
  ],
});

describe("learned adjustments: each pass reason", () => {
  it("skills gap: jobs that require the item Kris chose rank lower; jobs without it don't", async () => {
    const { engine, ids, job } = await feedOf(
      [{ title: "Cloud Security Engineer", company: "Kestrel" }, { title: "Platform Security Engineer", company: "Halden" }, { title: "SOC Analyst", company: "Unity Bank" }],
      { "Cloud Security Engineer": kubernetes("Cloud Security Engineer"), "Platform Security Engineer": kubernetes("Platform Security Engineer") },
    );
    const platform = await job("Platform Security Engineer");
    const soc = await job("SOC Analyst");

    const d = await engine.pass([ids["Cloud Security Engineer"]!], { reason: "skills-gap", learn: true, requirement: "Kubernetes security" });

    expect(d.learned).toEqual([expect.objectContaining({
      applies: "Jobs that require Kubernetes security",
      createdBy: "You passed Cloud Security Engineer at Kestrel: Skills gap too big",
    })]);
    expect((await job("Platform Security Engineer")).fit.value).toBe(platform.fit.value - 8);
    expect((await job("Platform Security Engineer")).fit.why).toContain("ranked lower: requires Kubernetes security, which you passed a job over");
    expect((await job("SOC Analyst")).fit).toEqual(soc.fit);
  });

  it("location: jobs at the same place rank lower", async () => {
    const { engine, ids, job } = await feedOf([
      { title: "Security Engineer", company: "Kestrel", location: "Remote, Europe" },
      { title: "SOC Analyst", company: "Unity Bank", location: "Remote - EMEA" },
      { title: "Security Analyst", company: "Halden", location: "Sofia, Bulgaria" },
    ]);
    const sofia = await job("Security Analyst");

    const d = await engine.pass([ids["Security Engineer"]!], { reason: "location", learn: true });

    expect(d.learned?.map((a) => a.applies)).toEqual(["Jobs in Remote · Europe"]);
    expect((await job("SOC Analyst")).fit.why).toContain("ranked lower: you passed a job in Remote · Europe");
    expect((await job("Security Analyst")).fit).toEqual(sofia.fit);
  });

  it("other, or no reason at all, learns nothing even with the box ticked", async () => {
    const { engine, ids } = await feedOf(bankJobs);
    const a = await engine.pass([ids["Security Analyst"]!], { reason: "other", learn: true });
    const b = await engine.pass([ids["SOC Analyst"]!], { learn: true });
    expect([a.learned, b.learned]).toEqual([[], []]);
    expect(await engine.learnedAdjustments()).toEqual([]);
  });

  it("a company pass tells companies with Cyrillic names apart", async () => {
    const { engine, ids, job } = await feedOf([
      { title: "Security Analyst", company: "Банка ДСК" },
      { title: "SOC Analyst", company: "Банка ДСК АД" },
      { title: "Security Engineer", company: "Телелинк" },
    ]);
    const telelink = await job("Security Engineer");

    await engine.pass([ids["Security Analyst"]!], { reason: "company", learn: true });

    expect((await job("SOC Analyst")).fit.why).toContain("ranked lower: you passed a job at Банка ДСК");
    expect((await job("Security Engineer")).fit).toEqual(telelink.fit);
  });

  it("a company pass on a job whose company isn't stated learns nothing", async () => {
    const { engine, ids, job } = await feedOf([
      { title: "Security Analyst", company: "Company not stated" },
      { title: "SOC Analyst", company: "Company not stated" },
    ]);
    const soc = await job("SOC Analyst");

    const d = await engine.pass([ids["Security Analyst"]!], { reason: "company", learn: true });

    expect(d.learned).toEqual([]);
    expect((await job("SOC Analyst")).fit).toEqual(soc.fit);
  });
});

describe("learned adjustments: the why-line", () => {
  it("doesn't name an adjustment that didn't change a job's Fit", async () => {
    // Nothing about these jobs matches: no angle, outside the locations, a month old. Fit is 0 and can't go lower.
    const { engine, ids, job } = await feedOf([
      { title: "Account Executive", company: "Orbit", location: "New York, NY", posted: "2026-08-01T09:00:00Z" },
      { title: "Sales Manager", company: "Orbit", location: "New York, NY", posted: "2026-08-01T09:00:00Z" },
    ]);
    expect((await job("Sales Manager")).fit.value).toBe(0);

    const d = await engine.pass([ids["Account Executive"]!], { reason: "company", learn: true });

    const sales = await job("Sales Manager");
    expect(sales.fit.why).not.toContain("ranked lower");
    expect(sales.fit.reasons.some((r) => r.factor === "adjustment")).toBe(false);
    expect(d.learned?.[0]?.jobsAffected).toBe(0);
  });
});
