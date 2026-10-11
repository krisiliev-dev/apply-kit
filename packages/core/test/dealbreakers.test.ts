import { describe, expect, it } from "vitest";
import type { FeedJob, PostingFacts, SearchSettings } from "../src/index.ts";
import { defaultSearchSettings } from "../src/index.ts";
import { cannedFacts, createTestEngine, fakeExtractor } from "./harness.ts";

interface BoardJob {
  title: string;
  location?: string;
}

/** Kris's settings with these dealbreakers (the rest as default). */
function settingsWith(dealbreakers: Partial<SearchSettings["dealbreakers"]>, rest: Partial<SearchSettings> = {}): SearchSettings {
  return { ...defaultSearchSettings, ...rest, dealbreakers: { ...defaultSearchSettings.dealbreakers, ...dealbreakers } };
}

/** An engine with one Greenhouse board listing `jobs`, all read by a fake extractor with `facts` per title. */
async function feedOf(jobs: BoardJob[], facts: Record<string, PostingFacts> = {}, searchSettings?: SearchSettings) {
  const listed = [...jobs];
  const board = () => ({
    jobs: listed.map((j, i) => ({
      id: i + 1,
      title: j.title,
      absolute_url: `https://example.test/jobs/${i + 1}`,
      company_name: "Example Co",
      location: { name: j.location ?? "Sofia, Bulgaria" },
      first_published: "2026-10-11T09:00:00Z",
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
  /** The board lists one more job; a check finds it and it is read. */
  const post = async (job: BoardJob) => {
    listed.push(job);
    await t.engine.checkAll();
    await t.engine.readPending();
  };
  return { ...t, ids, post };
}

const titles = (feed: { jobs: FeedJob[] }) => feed.jobs.map((j) => j.title);
const quote = (q: string) => ({ quote: q, translation: null });

const german = (kind: "required" | "preferred", confidence = 0.95) => cannedFacts({
  languages: [{ language: "German", level: "fluent", kind, source: quote("About the Penetration Tester role."), confidence }],
});

describe("dealbreakers: hiding with a reason", () => {
  it("hides a job that requires a language Kris doesn't speak, with the reason in plain words", async () => {
    const { engine } = await feedOf(
      [{ title: "Penetration Tester" }, { title: "Security Engineer" }],
      { "Penetration Tester": german("required") },
      settingsWith({ languagesNotSpoken: ["German"] }),
    );

    const feed = await engine.queryFeed({ view: "new" });
    expect(titles(feed)).toEqual(["Security Engineer"]);
    expect(feed.counts.hidden).toBe(1);

    const hidden = await engine.queryFeed({ view: "hidden" });
    expect(titles(hidden)).toEqual(["Penetration Tester"]);
    expect(hidden.jobs[0]!.dealbreakers).toEqual([
      expect.objectContaining({ rule: "language", text: "Requires German (fluent): a language you don't speak" }),
    ]);
  });

  it("never hides a job for a preferred requirement", async () => {
    const { engine } = await feedOf(
      [{ title: "Penetration Tester" }],
      { "Penetration Tester": german("preferred") },
      settingsWith({ languagesNotSpoken: ["German"] }),
    );

    const feed = await engine.queryFeed({ view: "new" });
    expect(titles(feed)).toEqual(["Penetration Tester"]);
    expect(feed.counts.hidden).toBe(0);
    expect(feed.jobs[0]!.dealbreakers).toEqual([]);
  });
});

const years = (title: string, min: number, kind: "required" | "preferred" = "required") => cannedFacts({
  years: [{ min, max: null, about: "security", kind, source: quote(`About the ${title} role.`), confidence: 0.95 }],
});
const salary = (title: string, min: number, max: number, basis: "gross" | "net" = "gross", currency = "EUR") => cannedFacts({
  salary: { stated: true, min, max, currency, period: "month", basis, source: quote(`About the ${title} role.`), confidence: 0.95 },
});
const reasonsOf = (j: FeedJob | undefined) => j?.dealbreakers.map((d) => d.text);

describe("dealbreakers: each rule, and the cautious cases that never hide", () => {
  it("doesn't hide a required language while Kris still has to confirm it is required", async () => {
    const { engine } = await feedOf(
      [{ title: "Penetration Tester" }],
      { "Penetration Tester": german("required", 0.4) },
      settingsWith({ languagesNotSpoken: ["German"] }),
    );

    const feed = await engine.queryFeed({ view: "new" });
    expect(titles(feed)).toEqual(["Penetration Tester"]);
    expect(feed.jobs[0]!.needsYou).toBe(1);
  });

  it("hides a job asking for more years than Kris's limit; preferred years never hide", async () => {
    const { engine } = await feedOf(
      [{ title: "Security Architect" }, { title: "Product Designer" }, { title: "SOC Analyst" }],
      {
        "Security Architect": years("Security Architect", 7),
        "Product Designer": years("Product Designer", 8, "preferred"),
        "SOC Analyst": years("SOC Analyst", 4),
      },
      settingsWith({ maxYearsRequired: 4 }),
    );

    expect(titles(await engine.queryFeed({ view: "new" })).sort()).toEqual(["Product Designer", "SOC Analyst"]);
    const hidden = await engine.queryFeed({ view: "hidden" });
    expect(reasonsOf(hidden.jobs[0])).toEqual(["Asks for 7+ years (your limit: 4)"]);
  });

  it("hides a job whose stated gross salary is entirely below the minimum; no salary, net pay or a range reaching it stay", async () => {
    const { engine } = await feedOf(
      [{ title: "Support Engineer" }, { title: "QA Engineer" }, { title: "Data Engineer" }, { title: "Web Developer" }, { title: "BG Developer" }],
      {
        "Support Engineer": salary("Support Engineer", 1200, 1500),
        "QA Engineer": salary("QA Engineer", 1500, 2200),
        "Web Developer": salary("Web Developer", 1500, 1800, "net"),
        // 3,000 BGN is about €1,534 a month.
        "BG Developer": salary("BG Developer", 3000, 3000, "gross", "BGN"),
      },
      settingsWith({}, { minMonthlySalaryEur: 2000 }),
    );

    expect(titles(await engine.queryFeed({ view: "new" })).sort()).toEqual(["Data Engineer", "QA Engineer", "Web Developer"]);
    const hidden = await engine.queryFeed({ view: "hidden" });
    expect(hidden.jobs.map((j) => [j.title, reasonsOf(j)]).sort()).toEqual([
      ["BG Developer", ["Salary 3,000 BGN gross/month, below your €2,000 minimum"]],
      ["Support Engineer", ["Salary €1,200–1,500 gross/month, below your €2,000 minimum"]],
    ]);
  });

  it("hides jobs outside Kris's location groups, but never relocation jobs or places it can't tell", async () => {
    const { engine } = await feedOf([
      { title: "Frontend Developer", location: "Plovdiv" },
      { title: "DevOps Engineer", location: "Remote, US" },
      { title: "Backend Developer", location: "Zürich, Switzerland" },
      { title: "Security Engineer", location: "Bulgaria" },
      { title: "Platform Engineer", location: "Sofia, Bulgaria" },
    ], {}, settingsWith({ outsideLocations: true }));

    const feed = await engine.queryFeed({ view: "new", relocation: true });
    expect(titles(feed).sort()).toEqual(["Backend Developer", "Platform Engineer", "Security Engineer"]);
    const hidden = await engine.queryFeed({ view: "hidden" });
    expect(hidden.jobs.map((j) => [j.title, reasonsOf(j)]).sort()).toEqual([
      ["DevOps Engineer", ["Remote, outside European time zones"]],
      ["Frontend Developer", ["Outside your locations"]],
    ]);
  });

  it("names every rule a job breaks", async () => {
    const { engine } = await feedOf(
      [{ title: "Penetration Tester", location: "Berlin, Germany" }],
      { "Penetration Tester": { ...german("required"), years: years("Penetration Tester", 6).years } },
      settingsWith({ languagesNotSpoken: ["German"], maxYearsRequired: 4 }),
    );

    const hidden = await engine.queryFeed({ view: "hidden" });
    expect(reasonsOf(hidden.jobs[0])).toEqual([
      "Requires German (fluent): a language you don't speak",
      "Asks for 6+ years (your limit: 4)",
      "Outside your locations",
    ]);
  });

  it("never hides a job that isn't read yet or is unscreened because the AI budget is used up", async () => {
    const board = {
      jobs: [{
        id: 1, title: "Frontend Developer", absolute_url: "https://example.test/jobs/1", company_name: "Example Co",
        location: { name: "Plovdiv" }, first_published: "2026-10-11T09:00:00Z", content: "&lt;p&gt;About it.&lt;/p&gt;",
      }],
    };
    const t = createTestEngine({ fetch: async () => Response.json(board), aiMonthlyCapUsd: 0, searchSettings: settingsWith({ outsideLocations: true }) });
    await t.engine.addSource({ kind: "greenhouse", config: "example" });
    await t.engine.checkAll();
    await t.engine.readPending();

    const feed = await t.engine.queryFeed({ view: "new" });
    expect(feed.jobs).toEqual([expect.objectContaining({ title: "Frontend Developer", reading: "unscreened", hidden: false })]);
    expect(feed.counts.hidden).toBe(0);
  });

  it("a hidden job Kris saves moves to Saved, where it is shown with its dealbreakers", async () => {
    const { engine, ids } = await feedOf(
      [{ title: "Security Architect" }],
      { "Security Architect": years("Security Architect", 7) },
      settingsWith({ maxYearsRequired: 4 }),
    );

    await engine.save([ids["Security Architect"]!]);

    const saved = await engine.queryFeed({ view: "saved" });
    expect(saved.jobs).toEqual([expect.objectContaining({ title: "Security Architect", hidden: false })]);
    expect(reasonsOf(saved.jobs[0])).toEqual(["Asks for 7+ years (your limit: 4)"]);
    expect(saved.counts.hidden).toBe(0);
  });
});

describe("dealbreakers: Show this job (unhide)", () => {
  it("returns the job to New and changes no rule: a similar job found later is still hidden", async () => {
    const { engine, ids, post } = await feedOf(
      [{ title: "Penetration Tester" }],
      { "Penetration Tester": german("required"), "Red Team Operator": cannedFacts({
        languages: [{ language: "German", level: null, kind: "required", source: quote("About the Red Team Operator role."), confidence: 0.95 }],
      }) },
      settingsWith({ languagesNotSpoken: ["German"] }),
    );

    const decision = await engine.unhide([ids["Penetration Tester"]!]);

    expect(decision).toMatchObject({ kind: "unhide", jobIds: [ids["Penetration Tester"]] });
    const feed = await engine.queryFeed({ view: "new" });
    expect(feed.jobs).toEqual([expect.objectContaining({ title: "Penetration Tester", hidden: false, shownByYou: true })]);
    expect(feed.counts).toMatchObject({ new: 1, hidden: 0 });

    await post({ title: "Red Team Operator" });
    expect(titles(await engine.queryFeed({ view: "hidden" }))).toEqual(["Red Team Operator"]);
    expect((await engine.getSearchSettings()).dealbreakers.languagesNotSpoken).toEqual(["German"]);
  });

  it("undoing it hides the job again", async () => {
    const { engine, ids } = await feedOf(
      [{ title: "Penetration Tester" }],
      { "Penetration Tester": german("required") },
      settingsWith({ languagesNotSpoken: ["German"] }),
    );
    const decision = await engine.unhide([ids["Penetration Tester"]!]);

    await engine.undo(decision.id);

    expect(titles(await engine.queryFeed({ view: "new" }))).toEqual([]);
    expect(titles(await engine.queryFeed({ view: "hidden" }))).toEqual(["Penetration Tester"]);
  });

  it("leaves jobs that aren't hidden out of the decision", async () => {
    const { engine, ids } = await feedOf([{ title: "Platform Engineer" }]);

    expect((await engine.unhide([ids["Platform Engineer"]!])).jobIds).toEqual([]);
  });
});

describe("dealbreakers: Not a dealbreaker for me", () => {
  it("removes a language from the ones Kris doesn't speak: the job and future ones like it stay in the Feed", async () => {
    const { engine, ids, post } = await feedOf(
      [{ title: "Penetration Tester" }],
      { "Penetration Tester": german("required"), "Red Team Operator": cannedFacts({
        languages: [{ language: "German", level: null, kind: "required", source: quote("About the Red Team Operator role."), confidence: 0.95 }],
      }) },
      settingsWith({ languagesNotSpoken: ["German", "French"] }),
    );

    const { change, settings } = await engine.notADealbreaker(ids["Penetration Tester"]!, "language:German");

    expect(change).toMatchObject({
      rule: "language",
      text: "German removed from the languages you don't speak",
      reason: "Requires German (fluent): a language you don't speak",
      job: { id: ids["Penetration Tester"], title: "Penetration Tester", company: "Example Co" },
      undoneAt: null,
    });
    expect(settings.dealbreakers.languagesNotSpoken).toEqual(["French"]);
    expect(titles(await engine.queryFeed({ view: "new" }))).toEqual(["Penetration Tester"]);

    await post({ title: "Red Team Operator" });
    expect(titles(await engine.queryFeed({ view: "new" })).sort()).toEqual(["Penetration Tester", "Red Team Operator"]);
    expect((await engine.queryFeed({ view: "new" })).counts.hidden).toBe(0);
  });

  it("raises the years limit to what the job asks, so jobs asking for more stay hidden", async () => {
    const { engine, ids } = await feedOf(
      [{ title: "Security Architect" }, { title: "Principal Engineer" }],
      { "Security Architect": years("Security Architect", 6), "Principal Engineer": years("Principal Engineer", 10) },
      settingsWith({ maxYearsRequired: 4 }),
    );

    const { change, settings } = await engine.notADealbreaker(ids["Security Architect"]!, "years");

    expect(change.text).toBe("Years limit raised from 4 to 6");
    expect(settings.dealbreakers.maxYearsRequired).toBe(6);
    expect(titles(await engine.queryFeed({ view: "new" }))).toEqual(["Security Architect"]);
    const hidden = await engine.queryFeed({ view: "hidden" });
    expect(reasonsOf(hidden.jobs[0])).toEqual(["Asks for 10+ years (your limit: 6)"]);
  });

  it("lowers the salary minimum to the job's salary", async () => {
    const { engine, ids } = await feedOf(
      [{ title: "Support Engineer" }],
      { "Support Engineer": salary("Support Engineer", 1500, 1800) },
      settingsWith({}, { minMonthlySalaryEur: 2000 }),
    );

    const { change, settings } = await engine.notADealbreaker(ids["Support Engineer"]!, "salary");

    expect(change.text).toBe("Salary minimum lowered from €2,000 to €1,800 a month");
    expect(settings.minMonthlySalaryEur).toBe(1800);
    expect(titles(await engine.queryFeed({ view: "new" }))).toEqual(["Support Engineer"]);
  });

  it("stops hiding jobs outside Kris's locations", async () => {
    const { engine, ids } = await feedOf([{ title: "Frontend Developer", location: "Plovdiv" }, { title: "QA Engineer", location: "Varna" }]);

    const { change } = await engine.notADealbreaker(ids["Frontend Developer"]!, "location");

    expect(change.text).toBe("Jobs outside your locations are no longer hidden (they stay ranked lower)");
    expect(titles(await engine.queryFeed({ view: "new" })).sort()).toEqual(["Frontend Developer", "QA Engineer"]);
  });

  it("lists each change, newest first, and undoing one puts the rule back and hides the job again", async () => {
    const { engine, ids, clock } = await feedOf(
      [{ title: "Penetration Tester" }, { title: "Security Architect" }],
      { "Penetration Tester": german("required"), "Security Architect": years("Security Architect", 6) },
      settingsWith({ languagesNotSpoken: ["German"], maxYearsRequired: 4 }),
    );
    const language = await engine.notADealbreaker(ids["Penetration Tester"]!, "language:German");
    await clock.advance(60_000);
    const yearsChange = await engine.notADealbreaker(ids["Security Architect"]!, "years");

    expect((await engine.ruleChanges()).map((c) => c.text)).toEqual([
      "Years limit raised from 4 to 6", "German removed from the languages you don't speak",
    ]);

    const { change, settings } = await engine.undoRuleChange(language.change.id);

    expect(change.undoneAt).not.toBeNull();
    // Only that rule goes back: the years change made since stays.
    expect(settings.dealbreakers).toMatchObject({ languagesNotSpoken: ["German"], maxYearsRequired: 6 });
    expect(titles(await engine.queryFeed({ view: "hidden" }))).toEqual(["Penetration Tester"]);
    expect(yearsChange.change.undoneAt).toBeNull();
  });

  it("refuses a reason the job doesn't have", async () => {
    const { engine, ids } = await feedOf([{ title: "Platform Engineer" }]);

    await expect(engine.notADealbreaker(ids["Platform Engineer"]!, "years")).rejects.toThrow(/isn't a dealbreaker on this job/);
  });
});

describe("dealbreakers: the Job page", () => {
  it("shows the dealbreaker check: every rule the job breaks and whether it is hidden", async () => {
    const { engine, ids } = await feedOf(
      [{ title: "Security Architect" }, { title: "Platform Engineer" }],
      { "Security Architect": years("Security Architect", 7) },
      settingsWith({ maxYearsRequired: 4 }),
    );

    const job = await engine.getJob(ids["Security Architect"]!);
    expect(job).toMatchObject({ hidden: true, shownByYou: false });
    expect(job!.dealbreakers).toEqual([
      { rule: "years", key: "years", text: "Asks for 7+ years (your limit: 4)", relax: "Raise your limit to 7 years" },
    ]);
    expect(await engine.getJob(ids["Platform Engineer"]!)).toMatchObject({ hidden: false, dealbreakers: [] });
  });
});

describe("dealbreakers: filtered to nothing", () => {
  it("explains which filters hold back the jobs when New shows none", async () => {
    const { engine } = await feedOf(
      [
        { title: "Security Architect" }, { title: "Principal Engineer" }, { title: "Penetration Tester" },
        { title: "Backend Developer", location: "Zürich, Switzerland" },
      ],
      {
        "Security Architect": years("Security Architect", 7),
        "Principal Engineer": years("Principal Engineer", 10),
        "Penetration Tester": german("required"),
      },
      settingsWith({ languagesNotSpoken: ["German"], maxYearsRequired: 4 }),
    );

    const feed = await engine.queryFeed({ view: "new" });

    expect(feed.jobs).toEqual([]);
    expect(feed.filteredToNothing).toEqual({
      relocation: 1,
      hidden: { total: 3, byRule: [{ rule: "language", jobs: 1 }, { rule: "years", jobs: 2 }] },
      text: "No new jobs to show. 1 job is a relocation job, left out while the Relocation filter is off. "
        + "3 jobs are hidden by your dealbreakers: 1 by a language you don't speak, 2 by your years limit.",
    });
  });

  it("is null when the view shows jobs, or when nothing is held back", async () => {
    const { engine } = await feedOf([{ title: "Platform Engineer" }]);

    expect((await engine.queryFeed({ view: "new" })).filteredToNothing).toBeNull();
    expect((await engine.queryFeed({ view: "saved" })).filteredToNothing).toBeNull();
  });
});

describe("dealbreakers: search settings", () => {
  it("are the defaults until Kris saves his own, which then drive hiding", async () => {
    const { engine } = await feedOf([{ title: "Penetration Tester" }], { "Penetration Tester": german("required") });
    expect(await engine.getSearchSettings()).toEqual(defaultSearchSettings);
    expect(titles(await engine.queryFeed({ view: "new" }))).toEqual(["Penetration Tester"]);

    const saved = await engine.saveSearchSettings(settingsWith({ languagesNotSpoken: [" German ", "german", ""] }));

    expect(saved.dealbreakers.languagesNotSpoken).toEqual(["German"]);
    expect(await engine.getSearchSettings()).toEqual(saved);
    expect(titles(await engine.queryFeed({ view: "hidden" }))).toEqual(["Penetration Tester"]);
  });

  it("refuses invalid settings with a plain message and keeps the old ones", async () => {
    const { engine } = await feedOf([]);

    await expect(engine.saveSearchSettings(settingsWith({ maxYearsRequired: -1 }))).rejects.toThrow(/whole number/);
    await expect(engine.saveSearchSettings({ ...defaultSearchSettings, minMonthlySalaryEur: "lots" })).rejects.toThrow(/minimum monthly salary/);
    expect(await engine.getSearchSettings()).toEqual(defaultSearchSettings);
  });
});
