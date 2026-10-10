import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseRef,
  fetchReed,
  fetchRemotive,
  fetchJobicy,
  fetchThemuse,
  fetchFindwork,
  fetchEures,
} from "@/lib/discovery/sources/jobapis";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.REED_API_KEY;
  delete process.env.FINDWORK_API_KEY;
});

function stubFetch(json: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => json })),
  );
}

// The Muse paginates; serve results once then empty so the loop terminates.
function stubFetchOnce(json: unknown) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => (call++ === 0 ? json : { results: [] }) })),
  );
}

describe("parseRef", () => {
  it("splits 'keywords|location'", () => {
    expect(parseRef("cyber security|Manchester")).toEqual({
      keywords: "cyber security",
      location: "Manchester",
    });
    expect(parseRef("security")).toEqual({ keywords: "security", location: undefined });
    expect(parseRef("")).toEqual({ keywords: "", location: undefined });
  });
});

describe("reed", () => {
  it("throws without REED_API_KEY", async () => {
    await expect(fetchReed("security|Manchester")).rejects.toThrow(/REED_API_KEY/);
  });

  it("maps reed results", async () => {
    process.env.REED_API_KEY = "k";
    stubFetch({
      results: [
        {
          jobId: 1,
          jobTitle: "Security Engineer",
          employerName: "Acme",
          locationName: "Manchester",
          jobUrl: "https://reed/1",
          minimumSalary: 50000,
          maximumSalary: 70000,
          currency: "GBP",
          jobDescription: "<b>do</b> security",
          date: "01/05/2026",
        },
      ],
    });
    const out = await fetchReed("cyber security|Manchester");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: { kind: "jobapi", provider: "reed", query: "cyber security|Manchester" },
      title: "Security Engineer",
      company: "Acme",
      location: "Manchester",
      salary: "GBP 50000–70000",
      url: "https://reed/1",
      description: "do security",
    });
  });
});

describe("remotive", () => {
  it("maps remotive jobs", async () => {
    stubFetch({
      jobs: [
        {
          title: "Remote Security Analyst",
          company_name: "Foo",
          url: "https://remotive/1",
          candidate_required_location: "Europe",
          salary: "$100k",
          description: "<p>secure things</p>",
          publication_date: "2026-05-01T00:00:00",
        },
      ],
    });
    const out = await fetchRemotive("security");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: { kind: "jobapi", provider: "remotive", query: "security" },
      title: "Remote Security Analyst",
      company: "Foo",
      location: "Europe",
      salary: "$100k",
    });
  });
});

describe("jobicy", () => {
  it("filters the feed by keyword", async () => {
    stubFetch({
      jobs: [
        {
          jobTitle: "Security Engineer",
          companyName: "Bar",
          url: "https://jobicy/1",
          jobGeo: "Anywhere",
          jobExcerpt: "blue team",
          pubDate: "2026-05-01T00:00:00",
        },
        { jobTitle: "Sales Rep", companyName: "Baz", url: "https://jobicy/2", jobExcerpt: "quota" },
      ],
    });
    const out = await fetchJobicy("security");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: { kind: "jobapi", provider: "jobicy", query: "security" },
      title: "Security Engineer",
      company: "Bar",
      location: "Anywhere",
    });
  });
});

describe("themuse", () => {
  it("filters by keyword and location", async () => {
    stubFetchOnce({
      results: [
        {
          name: "Security Engineer",
          company: { name: "Qux" },
          refs: { landing_page: "https://muse/1" },
          locations: [{ name: "Manchester, England" }],
          contents: "<p>defend</p>",
          publication_date: "2026-05-01T00:00:00",
        },
        {
          name: "Barista",
          company: { name: "Cafe" },
          refs: { landing_page: "https://muse/2" },
          locations: [{ name: "London" }],
          contents: "coffee",
        },
      ],
    });
    const out = await fetchThemuse("security|Manchester");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: { kind: "jobapi", provider: "themuse", query: "security|Manchester" },
      title: "Security Engineer",
      company: "Qux",
      url: "https://muse/1",
      location: "Manchester, England",
    });
  });
});

describe("eures", () => {
  it("maps EURES vacancies, prefers English translation, builds detail URL", async () => {
    stubFetch({
      numberRecords: 1,
      jvs: [
        {
          id: "MjA0NzgyMSA0",
          title: "Инженер по сигурността",
          description: "описание",
          creationDate: 1773702006444,
          locationMap: { BG: ["BG411"] },
          employer: { name: "Acme EOOD" },
          translations: {
            en: { title: "Security Engineer", description: "<p>defend the network</p>" },
            bg: { title: "Инженер по сигурността", description: "описание" },
          },
        },
      ],
    });
    const out = await fetchEures("security engineer|bg");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: { kind: "jobapi", provider: "eures", query: "security engineer|bg" },
      title: "Security Engineer",
      company: "Acme EOOD",
      location: "BG",
      description: "defend the network",
      postedAt: 1773702006444,
    });
    expect(out[0].url).toBe(
      "https://europa.eu/eures/portal/jv-se/jv-details/MjA0NzgyMSA0?lang=en",
    );
  });

  it("switches cyber refs to ESCO occupation filtering", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ jvs: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchEures("cyber security");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.keywords).toEqual([]);
    expect(body.occupationUris.length).toBeGreaterThan(0);
    expect(body.occupationUris[0]).toMatch(/esco\/occupation\//);
  });
});

describe("findwork", () => {
  it("throws without FINDWORK_API_KEY", async () => {
    await expect(fetchFindwork("security")).rejects.toThrow(/FINDWORK_API_KEY/);
  });

  it("maps findwork results and flags remote", async () => {
    process.env.FINDWORK_API_KEY = "k";
    stubFetch({
      results: [
        {
          role: "Security Engineer",
          company_name: "Zed",
          url: "https://findwork/1",
          remote: true,
          location: "Berlin",
          text: "<i>secure</i>",
          date_posted: "2026-05-01T00:00:00",
        },
      ],
    });
    const out = await fetchFindwork("security");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: { kind: "jobapi", provider: "findwork", query: "security" },
      title: "Security Engineer",
      company: "Zed",
      location: "Remote",
    });
  });
});
