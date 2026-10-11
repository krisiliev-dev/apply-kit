import { describe, expect, it } from "vitest";
import { createTestEngine } from "./harness.ts";
import { routedFetch } from "./http.ts";

// Synthetic test keys: never real ones.
const settings = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
const joobleKey = "test-jooble-key";
const reedKey = "test-reed-key";

describe("Jooble source", () => {
  const jooble = () => routedFetch((r) => {
    if (r.url !== `https://jooble.org/api/${joobleKey}` || r.method !== "POST") return undefined;
    expect(r.json).toEqual({ keywords: "security", location: "Bulgaria", page: "1" });
    return { fixture: "jooble-security-bulgaria.json" };
  });

  it("lists Jooble's jobs for a search, using the key from settings", async () => {
    const { engine } = createTestEngine({ fetch: jooble().fetch, settings: settings({ JOOBLE_API_KEY: joobleKey }) });
    const source = await engine.addSource({ kind: "jooble", config: "security|Bulgaria" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(source).toEqual({ id: "jooble:security|bulgaria", kind: "jooble", name: "Jooble · security · Bulgaria" });
    expect(check.sources[0]).toMatchObject({ ok: true, found: 2, newPostings: 2 });
    expect(feed.jobs).toEqual([
      // The id comes from the link exactly: as a JSON number it's too big to survive parsing.
      { id: "job:jooble:security|bulgaria:-1111111111111111111", title: "Security Operations Analyst", company: "Synthetic Systems", location: "Sofia, Bulgaria", salary: "4000 - 5500 BGN", postedAt: "2026-10-09T00:00:00.000Z", postingCount: 1, state: "new", url: expect.stringContaining("https://jooble.org/desc/-1111111111111111111"), reading: "unread", requirements: [], needsYou: 0, titleTranslation: null, language: null, fit: expect.any(Object) },
      { id: "job:jooble:security|bulgaria:2222222222222222222", title: "Penetration Tester", company: "Company not stated", location: "Bulgaria", salary: null, postedAt: "2026-10-07T14:30:00.000Z", postingCount: 1, state: "new", url: expect.stringContaining("https://jooble.org/desc/2222222222222222222"), reading: "unread", requirements: [], needsYou: 0, titleTranslation: null, language: null, fit: expect.any(Object) },
    ]);
  });

  it("shows a missing JOOBLE_API_KEY as a clear source status and makes no request", async () => {
    const http = jooble();
    const { engine } = createTestEngine({ fetch: http.fetch });
    await engine.addSource({ kind: "jooble", config: "security|Bulgaria" });

    const check = await engine.checkAll();
    const health = await engine.sourceHealth();

    expect(check.sources[0]).toMatchObject({ ok: false, outcome: "error", error: "Jooble needs the JOOBLE_API_KEY setting. Add it to .env and restart apply-kit" });
    expect(health.sources[0]).toMatchObject({ label: "Jooble", category: "aggregator", status: "failing" });
    expect(http.requests).toEqual([]);
  });

  it("names the setting, never the key, when Jooble rejects it", async () => {
    const { engine } = createTestEngine({ fetch: async () => new Response("Forbidden", { status: 403 }), settings: settings({ JOOBLE_API_KEY: joobleKey }) });
    await engine.addSource({ kind: "jooble", config: "security|Bulgaria" });

    const [result] = (await engine.checkAll()).sources;

    expect(result).toMatchObject({ ok: false, error: "Jooble rejected the JOOBLE_API_KEY setting (403)" });
    expect(JSON.stringify(await engine.sourceHealth())).not.toContain(joobleKey);
  });
});

describe("Reed source", () => {
  const search = "https://www.reed.co.uk/api/1.0/search?keywords=security&locationName=London&resultsToTake=100&resultsToSkip=0";
  const reed = () => routedFetch((r) => {
    if (r.url !== search) return undefined;
    // Basic auth with the key as the user name and an empty password.
    if (r.headers.get("authorization") !== `Basic ${btoa(`${reedKey}:`)}`) return new Response("Unauthorized", { status: 401 });
    return { fixture: "reed-security-london.json" };
  });

  it("lists Reed's jobs with salary ranges, using the key from settings", async () => {
    const { engine } = createTestEngine({ fetch: reed().fetch, settings: settings({ REED_API_KEY: reedKey }) });
    await engine.addSource({ kind: "reed", config: { keywords: "security", location: "London" } });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(check.sources[0]).toMatchObject({ sourceId: "reed:security|london", name: "Reed · security · London", ok: true, found: 2 });
    expect(feed.jobs.map((j) => [j.title, j.company, j.location, j.salary, j.postedAt, j.url])).toEqual([
      ["Security Engineer", "Synthetic Bank", "London", "GBP 65,000–80,000", "2026-10-08T00:00:00.000Z", "https://www.reed.co.uk/jobs/security-engineer/55500001"],
      ["SOC Analyst", "Synthetic Recruitment", "City of London", null, "2026-10-01T00:00:00.000Z", "https://www.reed.co.uk/jobs/soc-analyst/55500002"],
    ]);
  });

  it("shows a missing REED_API_KEY as a clear source status and makes no request", async () => {
    const http = reed();
    const { engine } = createTestEngine({ fetch: http.fetch, settings: settings({ REED_API_KEY: "  " }) });
    await engine.addSource({ kind: "reed", config: "security|London" });

    const check = await engine.checkAll();

    expect(check.sources[0]).toMatchObject({ ok: false, error: "Reed needs the REED_API_KEY setting. Add it to .env and restart apply-kit" });
    expect((await engine.sourceHealth()).sources[0]).toMatchObject({ label: "Reed", category: "api", status: "failing" });
    expect(http.requests).toEqual([]);
  });
});

describe("EURES source", () => {
  const search = "https://europa.eu/eures/api/jv-searchengine/public/jv-search/search";
  // ESCO occupations for cyber roles (ICT security technician, consultant, manager, CISO,
  // digital forensics expert, ethical hacker), from esco.ec.europa.eu.
  const cyberOccupations = [
    "http://data.europa.eu/esco/occupation/a44a1dc5-be08-4840-8bd5-770c4ac1ca6d",
    "http://data.europa.eu/esco/occupation/0ce5a9f4-e00a-4bbe-b255-3c63407167a4",
    "http://data.europa.eu/esco/occupation/7754d570-9519-48c2-b1c9-8e165f8bca0f",
    "http://data.europa.eu/esco/occupation/276ba420-ef09-4a0e-b215-2c2e2f80ad28",
    "http://data.europa.eu/esco/occupation/0c448a27-10ec-43ba-b880-d9938bade424",
    "http://data.europa.eu/esco/occupation/76ef0a87-6afe-4560-b5d0-9a086abe45c5",
  ];

  it("searches cyber roles by ESCO occupation instead of free text", async () => {
    const http = routedFetch((r) => (r.url === search && r.method === "POST" ? { fixture: "eures-ict-security.json" } : undefined));
    const { engine } = createTestEngine({ fetch: http.fetch });
    const source = await engine.addSource({ kind: "eures", config: "cybersecurity|BE" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(source).toEqual({ id: "eures:cyber|be", kind: "eures", name: "EURES · cyber roles · BE" });
    expect(http.requests[0]!.json).toMatchObject({ occupationUris: cyberOccupations, keywords: [], locationCodes: ["be"], requestLanguage: "en", sortSearch: "MOST_RECENT" });
    expect(check.sources[0]).toMatchObject({ ok: true, found: 3 });
    expect(feed.jobs.map((j) => [j.title, j.company, j.location, j.postedAt, j.url])).toEqual([
      ["Service Engineer", "Actief Interim Turnhout", "Belgium", "2026-10-02T18:15:10.962Z", "https://europa.eu/eures/portal/jv-se/jv-details/MTM1Y2M5N2UtOGJiZC00YWY5LTkwNjItMzNmZDUxZjM3ZmY2IDM?lang=en"],
      ["Randstad Digital - Support Engineer", "Randstad Digital", "Belgium", "2026-09-23T13:15:50.797Z", "https://europa.eu/eures/portal/jv-se/jv-details/MjJlNGM4ZWEtYmNmMi00YmEwLWE0OGMtMzc5NzUyMGM0OWU2IDM?lang=en"],
      ["Information Security & Compliance Manager", "Employer not stated", "Netherlands", "2026-09-16T01:11:50.700Z", "https://europa.eu/eures/portal/jv-se/jv-details/NWI5MWU0MTYtZTIyNC1kYzM3LWUwNjMtNjg5M2IyMGFkZTUwIDQy?lang=en"],
    ]);
    expect((await engine.sourceHealth()).sources[0]).toMatchObject({ label: "EURES", category: "api" });
  });

  it("uses free text for other roles, prefers the English translation and names Sofia from its region code", async () => {
    const http = routedFetch((r) => (r.url === search ? {
      json: {
        numberRecords: 1,
        jvs: [{
          id: "QkcxMjM0NTY3OCAx", title: "Разработчик на софтуер", description: "<p>Описание</p>", creationDate: 1791000000000,
          locationMap: { BG: ["BG411"] }, employer: { name: "Synthetic OOD" },
          translations: { bg: { title: "Разработчик на софтуер", description: "<p>Описание</p>" }, en: { title: "Software Developer", description: "<p>Description</p>" } },
        }],
      },
    } : undefined));
    const { engine } = createTestEngine({ fetch: http.fetch });
    await engine.addSource({ kind: "eures", config: { keywords: "software developer", country: "bg" } });

    await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new", sort: "newest" });

    expect(http.requests[0]!.json).toMatchObject({ occupationUris: [], keywords: [{ keyword: "software developer", specificSearchCode: "EVERYWHERE" }], locationCodes: ["bg"] });
    expect(feed.jobs).toMatchObject([{ title: "Software Developer", company: "Synthetic OOD", location: "Sofia, Bulgaria" }]);
  });
});
