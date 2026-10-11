import { describe, expect, it } from "vitest";
import { createTestEngine } from "./harness.ts";
import { routedFetch } from "./http.ts";

// Payhawk's own Greenhouse board (the recorded fixture) plus the same jobs as dev.bg and Jooble list
// them, written in each Source's real format (dev.bg cards, Jooble's search JSON).
const greenhouseBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";
const devbgPage = "https://dev.bg/company/jobs/product-management/";
const joobleApi = "https://jooble.org/api/test-jooble-key";

interface Card { id: string; slug: string; company: string; title: string; place: string }

function devbgCards(cards: Card[]): string {
  return `<!doctype html><html lang="bg"><body><div class="job-list">${cards.map((c) => `
    <div class="job-list-item" data-job-id="${c.id}">
      <a href="https://dev.bg/company/jobads/${c.slug}/" class="overlay-link ab-trigger"></a>
      <span class="company-name hide-for-small">${c.company}</span>
      <h6 class="job-title ab-title-placeholder"> ${c.title} </h6>
      <span class="badge"><img src="pin.png" alt="${c.place}" /> ${c.place} </span>
    </div>`).join("")}</div></body></html>`;
}

interface JoobleJob { id: string; title: string; company: string; location: string; salary?: string }

function joobleJobs(jobs: JoobleJob[]) {
  return {
    totalCount: jobs.length,
    jobs: jobs.map((j) => ({
      title: j.title, location: j.location, snippet: "", salary: j.salary ?? "", source: "example-board.bg", type: "Full-time",
      link: `https://jooble.org/desc/${j.id}?ckey=product`, company: j.company, updated: "2026-10-08T00:00:00.0000000",
    })),
  };
}

const apmCard: Card = { id: "570001", slug: "payhawk-associate-product-manager", company: "Payhawk", title: "Associate Product Manager", place: "София" };
const apmJooble: JoobleJob = { id: "3333333333333333333", title: "Associate Product Manager", company: "Payhawk EOOD", location: "Sofia, Bulgaria", salary: "3000 - 4000 BGN" };

/** An engine with Payhawk's Greenhouse board, a dev.bg category and a Jooble search, answering with these. */
function threeSources(devbg: Card[], jooble: JoobleJob[]) {
  const http = routedFetch((r) => {
    if (r.url === greenhouseBoard) return { fixture: "greenhouse-payhawkio.json" };
    if (r.url === devbgPage) return new Response(devbgCards(devbg));
    if (r.url === joobleApi) return { json: joobleJobs(jooble) };
    return undefined;
  });
  const t = createTestEngine({ fetch: http.fetch, settings: { get: (n) => (n === "JOOBLE_API_KEY" ? "test-jooble-key" : undefined) } });
  return {
    ...t,
    async addAll() {
      await t.engine.addSource({ kind: "greenhouse", config: "payhawkio" });
      await t.engine.addSource({ kind: "devbg", config: "product-management" });
      await t.engine.addSource({ kind: "jooble", config: "product|Bulgaria" });
    },
  };
}

describe("merging postings into jobs", () => {
  it("the same job from three Sources becomes one Job with three Postings", async () => {
    const { engine, addAll } = threeSources([apmCard], [apmJooble]);
    await addAll();

    await engine.checkAll();

    const feed = await engine.queryFeed({ view: "new" });
    const apm = feed.jobs.filter((j) => j.title.startsWith("Associate Product Manager"));
    expect(apm).toHaveLength(1);
    expect(apm[0]).toMatchObject({ company: "Payhawk", postingCount: 3, siteCount: 3 });
    expect(feed.counts.new).toBe(3);
  });
});
