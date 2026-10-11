import { describe, expect, it } from "vitest";
import { cannedFacts, createTestEngine, fakeExtractor, loadFixture } from "./harness.ts";
import { routedFetch, type Answer } from "./http.ts";

const orbitlyJob = "https://careers.orbitly.example/jobs/4417-backend-engineer-go";

/** An engine whose fetch answers only the given pages (anything else fails like an unknown host). */
function withPages(pages: Record<string, Answer>, extractor = fakeExtractor()) {
  const http = routedFetch((r) => pages[r.url]);
  return { ...createTestEngine({ fetch: http.fetch, extractor }), requests: http.requests, extractor };
}

const html = (fixture: string) => new Response(loadFixture(fixture), { headers: { "content-type": "text/html; charset=utf-8" } });

describe("pasting a job link", () => {
  it("turns a pasted job page into a Job in the Feed, with its facts once read and a Fit", async () => {
    const extractor = fakeExtractor({
      "Backend Engineer (Go)": cannedFacts({
        years: [{ min: 3, max: null, about: "backend services in Go", kind: "required", source: { quote: "3+ years building backend services in Go", translation: null }, confidence: 0.95 }],
      }),
    });
    const { engine } = withPages({ [orbitlyJob]: html("page-orbitly-backend.html") }, extractor);

    const added = await engine.addJobLink(orbitlyJob);
    expect(added).toMatchObject({ outcome: "added" });
    if (added.outcome !== "added") return;

    const { jobs } = await engine.queryFeed({ view: "new" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: added.jobId,
      title: "Backend Engineer (Go)",
      company: "Orbitly Ltd",
      location: "Sofia, Bulgaria",
      salary: "EUR 3,500–4,500 / month",
      postedAt: "2026-10-09T00:00:00.000Z",
      url: orbitlyJob,
    });

    const job = await engine.readJob(added.jobId);
    expect(job.reading.state).toBe("read");
    expect(job.postingText).toContain("3+ years building backend services in Go");
    expect(job.keyFacts.find((f) => f.key === "years:0")).toMatchObject({ value: "3+ years in backend services in Go", source: { quote: "3+ years building backend services in Go" } });
    expect(job.fit.value).toBeGreaterThan(0);
    expect(job.fit.provisional).toBe(false);
    expect(job.postings[0]!.source).toMatchObject({ category: "capture", label: "Pasted link" });
  });

  it("reads a careers page without structured data from its heading and main text", async () => {
    const link = "https://www.nimbusworks.example/careers/ux-designer";
    const page = `<!doctype html><html><head><title>UX Designer | Nimbus Works</title><meta property="og:site_name" content="Nimbus Works"></head>
      <body><nav><a href="/">Home</a><a href="/careers">Careers</a></nav><main><h1>UX Designer</h1>
      <p>Nimbus Works makes scheduling software for clinics in Bulgaria and Romania. We are looking for a UX designer to join our product team in Sofia.</p>
      <h2>What you will do</h2><ul><li>Run research with clinic staff and patients</li><li>Design flows and prototypes in Figma</li><li>Work with engineers to ship and measure what you designed</li></ul>
      <h2>What you bring</h2><ul><li>2+ years designing web products</li><li>A portfolio with research-led work</li><li>English; Bulgarian is a plus</li></ul>
      <p>Hybrid in Sofia, three days a week in the office.</p></main><footer>Nimbus Works OOD</footer></body></html>`;
    const { engine } = withPages({ [link]: new Response(page) });

    const added = await engine.addJobLink(link);

    expect(added).toMatchObject({ outcome: "added", via: "page" });
    if (added.outcome !== "added") return;
    const job = (await engine.getJob(added.jobId))!;
    expect(job).toMatchObject({ title: "UX Designer", company: "Nimbus Works", url: link });
    expect(job.postingText).toContain("• 2+ years designing web products");
    expect(job.postingText).not.toContain("Careers");
  });
});

const kestrelBoard = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs?content=true";

describe("pasting a link already in the Feed", () => {
  it("opens the existing Job instead of adding a duplicate, without fetching anything", async () => {
    const t = withPages({ [kestrelBoard]: { fixture: "greenhouse-kestrel.json" } });
    await t.engine.addSource({ kind: "greenhouse", config: "kestrel" });
    await t.engine.checkAll();
    const before = await t.engine.queryFeed({ view: "new" });
    const security = before.jobs.find((j) => j.title === "Security Engineer")!;
    const requestsBefore = t.requests.length;

    // As copied from a browser: another scheme, a trailing slash, tracking parameters and a fragment.
    const added = await t.engine.addJobLink("http://job-boards.eu.greenhouse.io/kestrel/jobs/7001/?gh_src=linkedin&utm_source=x#apply");

    expect(added).toEqual({ outcome: "existing", jobId: security.id });
    expect(t.requests.length).toBe(requestsBefore);
    expect((await t.engine.queryFeed({ view: "new" })).jobs).toHaveLength(before.jobs.length);
  });

  it("pasting the same link twice keeps one Job", async () => {
    const { engine, requests } = withPages({ [orbitlyJob]: html("page-orbitly-backend.html") });

    const first = await engine.addJobLink(orbitlyJob);
    const second = await engine.addJobLink(`${orbitlyJob}?utm_campaign=autumn`);

    expect(second).toEqual({ outcome: "existing", jobId: first.outcome === "added" ? first.jobId : "" });
    expect(requests.filter((r) => r.url === orbitlyJob)).toHaveLength(1);
    expect((await engine.queryFeed({ view: "new" })).jobs).toHaveLength(1);
  });

  it("finds a Job passed earlier too, so it isn't duplicated", async () => {
    const { engine } = withPages({ [orbitlyJob]: html("page-orbitly-backend.html") });
    const first = await engine.addJobLink(orbitlyJob);
    const jobId = first.outcome === "added" ? first.jobId : "";
    await engine.pass([jobId]);

    expect(await engine.addJobLink(orbitlyJob)).toEqual({ outcome: "existing", jobId });
  });

  it("a page describing a Job the Feed already has from another Source joins that Job", async () => {
    // Kestrel's own careers page for the Security Engineer job its Greenhouse board lists.
    const kestrelPage = "https://kestrel.example/careers/security-engineer";
    const page = `<!doctype html><html><head><title>Security Engineer</title><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "JobPosting", title: "Security Engineer",
      hiringOrganization: { "@type": "Organization", name: "Kestrel Payments" },
      jobLocation: { "@type": "Place", address: { addressLocality: "Sofia", addressCountry: "Bulgaria" } },
      description: "<p>Protect payments for 2 million merchants.</p>",
    })}</script></head><body><h1>Security Engineer</h1></body></html>`;
    const t = withPages({ [kestrelBoard]: { fixture: "greenhouse-kestrel.json" }, [kestrelPage]: new Response(page) });
    await t.engine.addSource({ kind: "greenhouse", config: "kestrel" });
    await t.engine.checkAll();
    const security = (await t.engine.queryFeed({ view: "new" })).jobs.find((j) => j.title === "Security Engineer")!;
    await t.clock.advance(60 * 60_000);

    const added = await t.engine.addJobLink(kestrelPage);

    expect(added).toEqual({ outcome: "merged", jobId: security.id });
    const job = (await t.engine.getJob(security.id))!;
    expect(job.postings.map((p) => [p.source.label, p.url])).toEqual([
      ["Greenhouse", "https://job-boards.eu.greenhouse.io/kestrel/jobs/7001"],
      ["Pasted link", kestrelPage],
    ]);
    // The company's own job system stays the target posting.
    expect(job.url).toBe("https://job-boards.eu.greenhouse.io/kestrel/jobs/7001");

    // The pasted link still covers the Job: removing the board doesn't close it.
    await t.engine.removeSource("greenhouse:kestrel");
    expect((await t.engine.getJob(security.id))!.state).toBe("new");
  });
});

describe("pages that can't be read", () => {
  const link = "https://careers.orbitly.example/jobs/4418-platform-engineer";

  it("a missing page gives a clear error, keeps the link and adds nothing", async () => {
    const { engine } = withPages({ [link]: new Response("<h1>Not found</h1>", { status: 404 }) });

    const added = await engine.addJobLink(`${link}?utm_source=newsletter`);

    expect(added).toEqual({
      outcome: "unreadable", link, problem: "not-found", pageTitle: null, alertSender: null,
      message: "careers.orbitly.example says this page doesn't exist (404). The job may have closed, or the link may be cut short.",
    });
    expect((await engine.queryFeed({ view: "new" })).jobs).toHaveLength(0);
  });

  it("a site that doesn't answer gives a clear error", async () => {
    const { engine } = withPages({});

    expect(await engine.addJobLink(link)).toMatchObject({
      outcome: "unreadable", link, problem: "error",
      message: "Couldn't reach careers.orbitly.example. Check the link, or paste the job's text.",
    });
  });

  it("a site that is too slow counts as timed out", async () => {
    const slow: typeof fetch = async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    const { engine } = createTestEngine({ fetch: slow });

    expect(await engine.addJobLink(link)).toMatchObject({
      problem: "timeout", message: "careers.orbitly.example didn't answer in time. Try again later, or paste the job's text.",
    });
  });

  it("a page that isn't one job posting (a careers index) is not added", async () => {
    const index = `<!doctype html><html><head><title>Jobs at Orbitly</title></head><body><main><h1>Open roles</h1>
      <ul><li><a href="/jobs/4417">Backend Engineer</a></li><li><a href="/jobs/4418">Platform Engineer</a></li></ul></main></body></html>`;
    const { engine } = withPages({ [link]: new Response(index) });

    expect(await engine.addJobLink(link)).toEqual({
      outcome: "unreadable", link, problem: "no-posting", pageTitle: "Jobs at Orbitly", alertSender: null,
      message: "This page doesn't look like one job posting. Check it's the job's own page, or paste the job's text.",
    });
    expect((await engine.queryFeed({ view: "new" })).jobs).toHaveLength(0);
  });

  it("text that isn't a link is refused", async () => {
    const { engine } = withPages({});

    expect(await engine.addJobLink("backend engineer sofia")).toEqual({
      outcome: "invalid", message: "That isn't a web link. Paste the job's address, starting with https://",
    });
  });
});

describe("sites the app must not read", () => {
  it("never fetches a LinkedIn job and asks for the text instead", async () => {
    const { engine, requests } = withPages({});

    const added = await engine.addJobLink("https://www.linkedin.com/jobs/view/backend-engineer-at-orbitly-4012345678?trk=public_jobs&refId=abc");

    expect(added).toEqual({
      outcome: "unreadable", link: "https://www.linkedin.com/jobs/view/4012345678/", problem: "protected", pageTitle: null, alertSender: "linkedin",
      message: "LinkedIn doesn't allow apps to read its pages, so apply-kit won't open this link. Paste the job's text, or let its job alert emails bring it in.",
    });
    expect(requests).toEqual([]);
  });

  it("a LinkedIn search link with the job open finds the Job already in the Feed", async () => {
    const { engine, requests } = withPages({});
    const pasted = await engine.addJobLink("https://www.linkedin.com/jobs/view/4012345678/", {
      title: "Backend Engineer", company: "Orbitly", text: "Build Go services.\n3+ years of Go.",
    });
    const jobId = pasted.outcome === "added" ? pasted.jobId : "";

    expect(await engine.addJobLink("https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=go")).toEqual({ outcome: "existing", jobId });
    expect(requests).toEqual([]);
  });

  it("respects robots.txt: a disallowed page is not fetched", async () => {
    const link = "https://jobs.example-bank.bg/vacancies/1201";
    const { engine, requests } = withPages({
      "https://jobs.example-bank.bg/robots.txt": new Response("User-agent: *\nDisallow: /vacancies/\nAllow: /about\n"),
    });

    expect(await engine.addJobLink(link)).toMatchObject({
      outcome: "unreadable", problem: "robots", message: "jobs.example-bank.bg asks apps not to read this page (its robots.txt). Paste the job's text instead.",
    });
    expect(requests.map((r) => r.url)).toEqual(["https://jobs.example-bank.bg/robots.txt"]);
  });

  it("stops at bot protection instead of trying to get past it", async () => {
    const link = "https://careers.protected.example/job/77";
    const challenge = new Response("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>", {
      status: 403, headers: { "cf-mitigated": "challenge" },
    });
    const { engine, requests } = withPages({ [link]: challenge });

    expect(await engine.addJobLink(link)).toMatchObject({
      outcome: "unreadable", problem: "blocked", message: "careers.protected.example blocks apps from reading its pages. Paste the job's text instead.",
    });
    expect(requests.filter((r) => r.url === link)).toHaveLength(1);
  });
});

describe("pasting the job's text with the link", () => {
  it("adds the Job from the text, keeps the link, and reads it like any other posting", async () => {
    const extractor = fakeExtractor({
      "Backend Engineer": cannedFacts({
        languages: [{ language: "English", level: "fluent", kind: "required", source: { quote: "Fluent English", translation: null }, confidence: 0.9 }],
      }),
    });
    const { engine, requests } = withPages({}, extractor);
    const link = "https://www.linkedin.com/jobs/view/4012345678/";

    const added = await engine.addJobLink(link, {
      title: "Backend Engineer", company: "Orbitly", location: "Sofia, Bulgaria",
      text: "Build Go services for fleet tracking.\n\n3+ years of Go\nFluent English <required>",
    });

    expect(added).toMatchObject({ outcome: "added", via: "text" });
    if (added.outcome !== "added") return;
    expect(requests).toEqual([]);
    const job = await engine.readJob(added.jobId);
    expect(job).toMatchObject({ title: "Backend Engineer", company: "Orbitly", location: "Sofia, Bulgaria", url: link });
    expect(job.postingText).toBe("Build Go services for fleet tracking.\n3+ years of Go\nFluent English <required>");
    expect(job.keyFacts.find((f) => f.key === "languages:0")).toMatchObject({ value: "English, fluent", source: { line: 3 } });
  });
});

describe("pasted links and Sources", () => {
  it("are not a Source to check or watch, and a pasted job ends the Feed's first run", async () => {
    const { engine } = withPages({ [orbitlyJob]: html("page-orbitly-backend.html") });
    await engine.addJobLink(orbitlyJob);

    const check = await engine.checkAll();
    const health = await engine.sourceHealth();
    const feed = await engine.queryFeed({ view: "new" });

    expect(check.sources).toEqual([]);
    expect(health.sources).toEqual([]);
    expect(feed.health.state).toBe("no-sources");
    expect(feed.firstRun).toBe(false);
    expect(feed.jobs).toHaveLength(1);
  });
});
