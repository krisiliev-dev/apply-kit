import { describe, expect, it } from "vitest";
import { cannedFacts, createTestEngine, fakeExtractor, fixtureFetch, loadFixture } from "./harness.ts";

const kestrelBoard = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs?content=true";

const linkedinSearch = {
  url: "https://www.linkedin.com/jobs/search/?currentJobId=4100000002&keywords=security%20engineer&location=Sofia",
  html: loadFixture("capture-linkedin-search.html"),
};

describe("capturing a LinkedIn search results page", () => {
  it("previews every listing visible on the page without adding anything", async () => {
    const { engine } = createTestEngine();

    const preview = await engine.previewCapture(linkedinSearch);

    expect(preview).toMatchObject({ kind: "search", site: "LinkedIn", notLoaded: 2 });
    expect(preview.listings.map((l) => [l.title, l.company, l.status])).toEqual([
      ["Security Engineer", "Kestrel Payments", "new"],
      ["Backend Developer (Node.js)", "Lumen Freight", "new"],
      ["Cloud Security Analyst", "Halden Energy", "new"],
      ["Penetration Tester", null, "new"],
      [null, null, "unreadable"],
    ]);
    expect(preview.listings[0]).toMatchObject({ url: "https://www.linkedin.com/jobs/view/4100000001/", location: "Sofia, Sofia City, Bulgaria · Hybrid" });
    expect(preview.listings[3]!.missing).toEqual(["company", "location"]);
    expect(preview.listings[4]!.problem).toMatch(/title/i);
    expect(preview.counts).toEqual({ new: 4, inFeed: 0, hidden: 0, unreadable: 1 });

    const feed = await engine.queryFeed({ view: "new" });
    expect(feed.jobs).toHaveLength(0);
  });

  it("adds the readable listings to the Feed, merging one the company's own job system already lists", async () => {
    const { engine } = createTestEngine({ fetch: fixtureFetch({ [kestrelBoard]: "greenhouse-kestrel.json" }) });
    await engine.addSource({ kind: "greenhouse", config: "kestrel" });
    await engine.checkAll();

    const preview = await engine.previewCapture(linkedinSearch);
    expect(preview.listings[0]).toMatchObject({ title: "Security Engineer", status: "in-feed", merged: true });
    expect(preview.counts).toEqual({ new: 3, inFeed: 1, hidden: 0, unreadable: 1 });

    const captured = await engine.capturePage(linkedinSearch);
    expect(captured.source).toBe("Captured · LinkedIn");
    expect(captured.counts).toEqual({ new: 3, inFeed: 1, hidden: 0, unreadable: 1 });

    const { jobs } = await engine.queryFeed({ view: "new" });
    const titles = jobs.map((j) => j.title).sort();
    expect(titles).toEqual(["Backend Developer (Node.js)", "Cloud Security Analyst", "Office Manager", "Penetration Tester", "SOC Analyst L2", "Security Engineer"]);
    const security = jobs.find((j) => j.title === "Security Engineer")!;
    expect(security).toMatchObject({ postingCount: 2, siteCount: 2, url: "https://job-boards.eu.greenhouse.io/kestrel/jobs/7001" });
    const pentest = jobs.find((j) => j.title === "Penetration Tester")!;
    expect(pentest).toMatchObject({ company: "Company not stated", url: "https://www.linkedin.com/jobs/view/4100000004/" });

    // The open detail pane's text is kept with its listing.
    const backend = (await engine.getJob(jobs.find((j) => j.title === "Backend Developer (Node.js)")!.id))!;
    expect(backend.postingText).toContain("3+ years with Node.js in production");
    expect(backend.postings[0]!.source).toMatchObject({ name: "Captured · LinkedIn", category: "capture" });
  });

  it("recognises listings captured before: capturing the same page again adds nothing", async () => {
    const { engine } = createTestEngine();
    await engine.capturePage(linkedinSearch);

    const again = await engine.capturePage(linkedinSearch);

    expect(again.counts).toEqual({ new: 0, inFeed: 4, hidden: 0, unreadable: 1 });
    expect(again.listings.every((l) => !l.merged)).toBe(true);
    expect((await engine.queryFeed({ view: "new" })).jobs).toHaveLength(4);
  });
});

const linkedinJob = { url: "https://www.linkedin.com/jobs/view/4100000009/?trk=public_jobs_topcard", html: loadFixture("capture-linkedin-job.html") };
const sixYears = cannedFacts({
  years: [{ min: 6, max: null, about: "application security", kind: "required", source: { quote: "3+ years in application security", translation: null }, confidence: 0.95 }],
});

describe("capturing a job page", () => {
  it("adds the LinkedIn job Kris is viewing, read from the page, and reads it straight away", async () => {
    const { engine } = createTestEngine();

    const preview = await engine.previewCapture(linkedinJob);
    expect(preview).toMatchObject({ kind: "job", site: "LinkedIn", counts: { new: 1, inFeed: 0, hidden: 0, unreadable: 0 } });

    const captured = await engine.capturePage(linkedinJob);
    expect(captured.listings).toEqual([expect.objectContaining({
      title: "Application Security Engineer", company: "Nordlicht Bank", location: "Sofia, Sofia City, Bulgaria · Hybrid",
      url: "https://www.linkedin.com/jobs/view/4100000009/", status: "new", missing: [],
    })]);
    const job = (await engine.getJob(captured.listings[0]!.jobId!))!;
    expect(job.reading.state).toBe("read");
    expect(job.postingText).toContain("Threat-model new features with product teams");
    expect(job.postingText).not.toContain("Home");
  });

  it("says a captured job breaks a dealbreaker, with the reason, and the preview says so afterwards", async () => {
    const { engine } = createTestEngine({ extractor: fakeExtractor({ "Application Security Engineer": sixYears }) });

    const captured = await engine.capturePage(linkedinJob);

    expect(captured.listings[0]).toMatchObject({ status: "hidden", hiddenBecause: [expect.stringMatching(/6\+ years/)] });
    expect(captured.counts).toEqual({ new: 0, inFeed: 0, hidden: 1, unreadable: 0 });
    expect((await engine.queryFeed({ view: "hidden" })).jobs.map((j) => j.title)).toEqual(["Application Security Engineer"]);

    const again = await engine.previewCapture(linkedinJob);
    expect(again.listings[0]).toMatchObject({ status: "hidden", hiddenBecause: [expect.stringMatching(/6\+ years/)] });
  });

  it("reads a jobs.bg job page, with its description from the page's description frame", async () => {
    const { engine } = createTestEngine();

    const captured = await engine.capturePage({
      url: "https://www.jobs.bg/job/8123456",
      html: loadFixture("capture-jobsbg-job.html"),
      frames: [{ id: "customJobIframe", html: loadFixture("capture-jobsbg-job-frame.html") }],
    });

    expect(captured).toMatchObject({ kind: "job", site: "jobs.bg", source: "Captured · jobs.bg" });
    expect(captured.listings[0]).toMatchObject({
      title: "IT Security Specialist", company: "Ostrava Bank", location: "София · Hybrid", url: "https://www.jobs.bg/job/8123456", status: "new",
    });
    const job = (await engine.getJob(captured.listings[0]!.jobId!))!;
    expect(job.postingText).toContain("Минимум 2 години опит в информационната сигурност");
  });

  it("says when a page shows no job, and adds nothing", async () => {
    const { engine } = createTestEngine();

    const captured = await engine.capturePage({ url: "https://www.linkedin.com/feed/", html: "<html><body><main><h2>Your feed</h2></main></body></html>" });

    expect(captured).toMatchObject({ kind: "none", source: null, listings: [], message: expect.stringMatching(/couldn't find a job/) });
    expect((await engine.queryFeed({ view: "new" })).firstRun).toBe(true);
  });
});

const day = 24 * 60 * 60_000;

describe("keeping captured jobs honest", () => {
  it("marks a captured job no job system lists 'unverified' after 30 days, and keeps it", async () => {
    const { engine, clock } = createTestEngine();
    await engine.capturePage(linkedinJob);
    const jobId = (await engine.queryFeed({ view: "new" })).jobs[0]!.id;

    await clock.advance(29 * day);
    expect((await engine.queryFeed({ view: "new" })).jobs[0]!.unverified).toBeUndefined();

    await clock.advance(2 * day);
    const { jobs } = await engine.queryFeed({ view: "new" });
    expect(jobs.map((j) => j.id)).toEqual([jobId]);
    expect(jobs[0]!.unverified).toEqual({ since: "2026-11-11T07:30:00.000Z" });
    expect((await engine.getJob(jobId))!.unverified).toEqual({ since: "2026-11-11T07:30:00.000Z" });

    // Capturing it again shows it's still listed.
    await engine.capturePage(linkedinJob);
    expect((await engine.queryFeed({ view: "new" })).jobs[0]!.unverified).toBeUndefined();
  });

  it("re-checks a captured job on the company's own job system: never unverified while listed, closed once it isn't", async () => {
    let board = loadFixture("greenhouse-kestrel.json");
    const kestrel = () => new Response(board);
    const { engine, clock } = createTestEngine({ fetch: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== kestrelBoard) throw new Error(`no fixture for ${url}`);
      return kestrel();
    } });
    await engine.addSource({ kind: "greenhouse", config: "kestrel" });
    await engine.capturePage(linkedinSearch);
    await engine.checkAll();
    const security = () => engine.queryFeed({ view: "open" }).then((f) => f.jobs.find((j) => j.title === "Security Engineer"));

    for (let i = 0; i < 4; i++) {
      await clock.advance(10 * day);
      await engine.checkAll();
    }
    expect(await security()).toMatchObject({ postingCount: 2 });
    expect((await security())!.unverified).toBeUndefined();

    const listed = JSON.parse(board) as { jobs: { id: number }[] };
    board = JSON.stringify({ ...listed, jobs: listed.jobs.filter((j) => j.id !== 7001) });
    await clock.advance(day);
    await engine.checkAll();

    expect(await security()).toBeUndefined();
    const closed = (await engine.queryFeed({ view: "passed" })).jobs.find((j) => j.title === "Security Engineer");
    expect(closed?.closed?.how).toMatch(/No longer listed by/);
  });
});

describe("capturing a jobs.bg search results page", () => {
  it("lists every card, and a card without a link to its job can't be read", async () => {
    const { engine } = createTestEngine();

    const captured = await engine.capturePage({ url: "https://www.jobs.bg/front_job_search.php?keywords%5B%5D=security", html: loadFixture("capture-jobsbg-search.html") });

    expect(captured.listings.map((l) => [l.title, l.company, l.location, l.url, l.status])).toEqual([
      ["IT Security Specialist", "Ostrava Bank", "София · Hybrid", "https://www.jobs.bg/job/8123456", "new"],
      ["Системен администратор", "Тракия Логистик ЕООД", "Пловдив", "https://www.jobs.bg/job/8123457", "new"],
      ["SOC Analyst", "Halden Energy", "София", null, "unreadable"],
    ]);
    expect(captured.listings[1]).toMatchObject({ salary: "2 400 - 3 000 BGN (Бруто)" });
    expect(captured.listings[2]!.problem).toMatch(/link/);
  });

  it("merges a listing captured on the search page with the same job's page captured later", async () => {
    const { engine } = createTestEngine();
    const fromSearch = await engine.capturePage({ url: "https://www.jobs.bg/front_job_search.php", html: loadFixture("capture-jobsbg-search.html") });

    const fromPage = await engine.capturePage({
      url: "https://www.jobs.bg/job/8123456",
      html: loadFixture("capture-jobsbg-job.html"),
      frames: [{ id: "customJobIframe", html: loadFixture("capture-jobsbg-job-frame.html") }],
    });

    expect(fromPage.listings[0]).toMatchObject({ status: "in-feed", jobId: fromSearch.listings[0]!.jobId });
    const job = (await engine.getJob(fromSearch.listings[0]!.jobId!))!;
    expect(job.postingCount).toBe(1);
    expect(job.postingText).toContain("ISO 27001");
  });
});
